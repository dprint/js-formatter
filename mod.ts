import type { ConfigurationDiagnostic, FormatRequest, Formatter, GlobalConfiguration } from "./common.ts";
import * as v3 from "./v3.ts";
import * as v4 from "./v4.ts";

export type {
  ConfigurationDiagnostic,
  FileMatchingInfo,
  FormatRequest,
  Formatter,
  GlobalConfiguration,
  Host,
  PluginInfo,
} from "./common.ts";

/** A registered plugin with its configuration. */
interface RegisteredPlugin {
  formatter: Formatter;
  pluginConfig: Record<string, unknown>;
  fileExtensions: Set<string>;
  fileNames: Set<string>;
}

/** A formatter returned from adding a plugin to a context. */
export interface ContextFormatter {
  /** Formats the specified file text using this plugin. */
  formatText(request: FormatRequest): string;
  /** Gets the resolved configuration for this plugin. */
  getResolvedConfig(): Record<string, unknown>;
  /** Gets the configuration diagnostics for this plugin. */
  getConfigDiagnostics(): ConfigurationDiagnostic[];
}

/** A context for managing multiple formatters with shared configuration. */
export interface FormatterContext {
  /**
   * Adds a plugin to the context.
   * @param source - The buffer or Wasm module of the plugin (e.g., from `@dprint/json` getBuffer()).
   * @param param - Plugin config.
   * @returns A formatter for directly formatting with this plugin.
   */
  addPlugin(
    source: BufferSource | WebAssembly.Module,
    pluginConfig?: Record<string, unknown>,
  ): ContextFormatter;

  /**
   * Adds a plugin to the context.
   * @param source - Source response object.
   * @param pluginConfig - Plugin config.
   * @returns A formatter for directly formatting with this plugin.
   */
  addPluginStreaming(
    source: ResponseLike,
    pluginConfig?: Record<string, unknown>,
  ): Promise<ContextFormatter>;

  /**
   * Formats the specified file text, automatically selecting the appropriate plugin.
   * @param request - Data to format.
   * @returns The formatted text.
   * @throws If no plugin matches the file or there is an error formatting.
   */
  formatText(request: FormatRequest): string;

  /**
   * Gets all configuration diagnostics from all plugins.
   */
  getConfigDiagnostics(): ConfigurationDiagnostic[];
}

/**
 * Creates a formatter context for managing multiple plugins with shared configuration.
 * @param globalConfig - Global configuration shared across all plugins.
 */
export function createContext(globalConfig: GlobalConfiguration = {}): FormatterContext {
  const plugins: RegisteredPlugin[] = [];

  function findPluginForFile(filePath: string): RegisteredPlugin | undefined {
    const fileName = getFileName(filePath);
    const ext = getFileExtension(filePath);

    // First try to match by exact file name
    for (const plugin of plugins) {
      if (plugin.fileNames.has(fileName)) {
        return plugin;
      }
    }

    // Then try to match by extension
    if (ext) {
      for (const plugin of plugins) {
        if (plugin.fileExtensions.has(ext)) {
          return plugin;
        }
      }
    }

    return undefined;
  }

  function createHostFormatter(
    currentPlugin: RegisteredPlugin,
  ): (request: FormatRequest) => string {
    return (request: FormatRequest) => {
      const plugin = findPluginForFile(request.filePath);
      if (plugin && plugin !== currentPlugin) {
        return plugin.formatter.formatText(request);
      }
      // Return unchanged if no other plugin matches
      return request.fileText;
    };
  }

  return {
    async addPluginStreaming(source: ResponseLike, pluginConfig?: Record<string, unknown>) {
      const wasmModule = await createWasmModuleFromStreaming(source);
      return this.addPlugin(wasmModule, pluginConfig);
    },
    addPlugin(
      source: BufferSource | WebAssembly.Module,
      pluginConfig: Record<string, unknown> = {},
    ): ContextFormatter {
      const formatter = source instanceof WebAssembly.Module
        ? createFromWasmModule(source)
        : createFromBuffer(source);

      // Set configuration
      formatter.setConfig(globalConfig, pluginConfig);

      // Get file matching info
      const matchingInfo = formatter.getFileMatchingInfo();
      const fileExtensions = new Set(
        matchingInfo.fileExtensions.map((ext) => ext.toLowerCase()),
      );
      const fileNames = new Set(
        matchingInfo.fileNames.map((name) => name.toLowerCase()),
      );

      const registered: RegisteredPlugin = {
        formatter,
        pluginConfig,
        fileExtensions,
        fileNames,
      };

      plugins.push(registered);

      // Set up host formatter for this plugin
      formatter.setHostFormatter(createHostFormatter(registered));

      // Return a context-aware formatter
      return {
        formatText(request: FormatRequest): string {
          return formatter.formatText(request);
        },
        getResolvedConfig(): Record<string, unknown> {
          return formatter.getResolvedConfig();
        },
        getConfigDiagnostics(): ConfigurationDiagnostic[] {
          return formatter.getConfigDiagnostics();
        },
      };
    },

    formatText(request: FormatRequest): string {
      const plugin = findPluginForFile(request.filePath);
      if (!plugin) {
        throw new Error(
          `No plugin found for file: ${request.filePath}. `
            + `Registered plugins handle: ${
              plugins
                .map((p) => [...p.fileExtensions].join(", "))
                .join("; ")
            }`,
        );
      }
      return plugin.formatter.formatText(request);
    },

    getConfigDiagnostics(): ConfigurationDiagnostic[] {
      return plugins.flatMap((p) => p.formatter.getConfigDiagnostics());
    },
  };
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  return (lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath)
    .toLowerCase();
}

function getFileExtension(filePath: string): string | undefined {
  const fileName = getFileName(filePath);
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot > 0) {
    return fileName.slice(lastDot + 1);
  }
  return undefined;
}

export interface ResponseLike {
  status: number;
  arrayBuffer(): Promise<BufferSource>;
  text(): Promise<string>;
  headers: {
    get(name: string): string | null;
  };
}

/**
 * Creates a formatter from the specified streaming source.
 * @remarks This is the most efficient way to create a formatter.
 * @param response - The streaming source to create the formatter from.
 */
export async function createStreaming(
  responsePromise: Promise<ResponseLike> | ResponseLike,
): Promise<Formatter> {
  const wasmModule = await createWasmModuleFromStreaming(responsePromise);
  return createFromWasmModule(wasmModule);
}

async function createWasmModuleFromStreaming(responsePromise: Promise<ResponseLike> | ResponseLike) {
  const response = await responsePromise;
  if (response.status !== 200) {
    throw new Error(
      `Unexpected status code: ${response.status}\n${await response.text()}`,
    );
  }
  if (
    typeof WebAssembly.instantiateStreaming === "function"
    && response.headers.get("content-type") === "application/wasm"
  ) {
    // deno-lint-ignore no-explicit-any
    return await WebAssembly.compileStreaming(response as any);
  } else {
    // fallback for node.js or when the content type isn't application/wasm
    return response.arrayBuffer()
      .then((buffer) => new WebAssembly.Module(buffer));
  }
}

/**
 * Creates a formatter from the specified wasm module bytes.
 * @param wasmModuleBuffer - The buffer of the wasm module.
 */
export function createFromBuffer(wasmModuleBuffer: BufferSource): Formatter {
  const wasmModule = new WebAssembly.Module(wasmModuleBuffer);
  return createFromWasmModule(wasmModule);
}

export function createFromWasmModule(wasmModule: WebAssembly.Module): Formatter {
  const version = getModuleVersionOrThrow(wasmModule);
  if (version === 3) {
    const host = v3.createHost();
    const wasmInstance = new WebAssembly.Instance(
      wasmModule,
      host.createImportObject(),
    );
    return v3.createFromInstance(wasmInstance, host);
  } else {
    const _assert4: 4 = version;
    const host = v4.createHost();
    const wasmInstance = new WebAssembly.Instance(
      wasmModule,
      host.createImportObject(),
    );
    return v4.createFromInstance(wasmInstance, host);
  }
}

function getModuleVersionOrThrow(module: WebAssembly.Module): 3 | 4 {
  const version = getModuleVersion(module);
  if (version == null) {
    throw new Error("Couldn't determine dprint plugin version. Maybe the js-formatter version is too old?");
  } else if (version === 3 || version === 4) {
    return version;
  } else if (version > 4) {
    throw new Error(`Unsupported new dprint plugin version '${version}'. Maybe the js-formatter version is too old?`);
  } else {
    throw new Error(`Unsupported old dprint plugin version '${version}'. Please upgrade the plugin.`);
  }
}

function getModuleVersion(module: WebAssembly.Module) {
  function getVersionFromExport(name: string) {
    if (name === "get_plugin_schema_version") {
      return 3;
    }
    const prefix = "dprint_plugin_version_";
    if (name.startsWith(prefix)) {
      const value = parseInt(name.substring(prefix.length), 10);
      if (!isNaN(value)) {
        return value;
      }
    }
    return undefined;
  }

  const exports = WebAssembly.Module.exports(module);
  for (const e of exports) {
    const maybeVersion = getVersionFromExport(e.name);
    if (maybeVersion != null) {
      return maybeVersion;
    }
  }
  return undefined;
}
