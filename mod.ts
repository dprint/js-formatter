/** Formats code. */
export interface Formatter {
  /**
   * Sets the configuration.
   * @param globalConfig - Global configuration for use across plugins.
   * @param pluginConfig - Plugin specific configuration.
   */
  setConfig(
    globalConfig: GlobalConfiguration,
    pluginConfig: Record<string, unknown>,
  ): void;
  /**
   * Gets the configuration diagnostics.
   */
  getConfigDiagnostics(): ConfigurationDiagnostic[];
  /**
   * Gets the resolved configuration.
   * @returns An object containing the resolved configuration.
   */
  getResolvedConfig(): Record<string, unknown>;
  /**
   * Gets the plugin info.
   */
  getPluginInfo(): PluginInfo;
  /**
   * Gets the license text of the plugin.
   */
  getLicenseText(): string;
  /**
   * Formats the specified file text.
   * @param filePath - The file path to format.
   * @param fileText - File text to format.
   * @param overrideConfig - Configuration to set for a single format.
   * @param formatWithHost - Host formatter.
   * @returns The formatted text.
   * @throws If there is an error formatting.
   */
  formatText(
    filePath: string,
    fileText: string,
    overrideConfig?: Record<string, unknown>,
    formatWithHost?: (
      filePath: string,
      fileText: string,
      overrideConfig: Record<string, unknown>,
    ) => string,
  ): string;
}

/** Configuration specified for use across plugins. */
export interface GlobalConfiguration {
  lineWidth?: number;
  indentWidth?: number;
  useTabs?: boolean;
  newLineKind?: "auto" | "lf" | "crlf" | "system";
}

/** A diagnostic indicating a problem with the specified configuration. */
export interface ConfigurationDiagnostic {
  propertyName: string;
  message: string;
}

/** Information about a plugin. */
export interface PluginInfo {
  name: string;
  version: string;
  configKey: string;
  fileExtensions: string[];
  fileNames: string[];
  helpUrl: string;
  configSchemaUrl: string;
}

export interface Host {
  setInstance(wasmInstance: WebAssembly.Instance): void;
  setHostFormatter(
    formatWithHost: (
      filePath: string,
      fileText: string,
      overrideConfig: Record<string, unknown>,
    ) => string,
  ): void;
  createImportObject(): WebAssembly.Imports;
}

/**
 * Creates host for host formatting.
 */
export function createHost(): Host {
  let instance: WebAssembly.Instance;
  let hostFormatter = (
    _filePath: string,
    fileText: string,
    _overrideConfig: Record<string, unknown>,
  ): string => fileText;

  let receivedString = "";

  let overrideConfig = {};
  let filePath = "";
  let formattedText = "";
  let errorText = "";

  return {
    setInstance(wasmInstance: WebAssembly.Instance) {
      instance = wasmInstance;
    },
    setHostFormatter(formatWithHost) {
      hostFormatter = formatWithHost;
    },
    createImportObject(): WebAssembly.Imports {
      return {
        dprint: {
          "host_clear_bytes": () => {},
          "host_read_buffer": (_pointer: number, length: number) => {
            receivedString = receiveString(instance, length);
          },
          "host_write_buffer": () => {},
          "host_take_file_path": () => {
            filePath = receivedString;
            receivedString = "";
          },
          "host_take_override_config": () => {
            overrideConfig = JSON.parse(receivedString);
            receivedString = "";
          },
          "host_format": () => {
            const fileText = receivedString;
            receivedString = "";
            try {
              formattedText = hostFormatter(
                filePath,
                fileText,
                overrideConfig,
              );
              return fileText === formattedText ? 0 : 1;
            } catch (error) {
              errorText = String(error);
              return 2;
            }
          },
          "host_get_formatted_text": () => {
            return sendString(instance, formattedText);
          },
          "host_get_error_text": () => {
            return sendString(instance, errorText);
          },
        },
      };
    },
  };
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
  const response = await responsePromise;
  if (response.status !== 200) {
    throw new Error(
      `Unexpected status code: ${response.status}\n${await response.text()}`,
    );
  }
  if (
    typeof WebAssembly.instantiateStreaming === "function" &&
    response.headers.get("content-type") === "application/wasm"
  ) {
    const host = createHost();
    const { instance } = await WebAssembly
      // deno-lint-ignore no-explicit-any
      .instantiateStreaming(response as any, host.createImportObject());
    return createFromInstance(instance, host);
  } else {
    // fallback for node.js or when the content type isn't application/wasm
    return response.arrayBuffer()
      .then((buffer) => createFromBuffer(buffer));
  }
}

/**
 * Creates a formatter from the specified wasm module bytes.
 * @param wasmModuleBuffer - The buffer of the wasm module.
 */
export function createFromBuffer(wasmModuleBuffer: BufferSource): Formatter {
  const host = createHost();
  const wasmModule = new WebAssembly.Module(wasmModuleBuffer);
  const wasmInstance = new WebAssembly.Instance(
    wasmModule,
    host.createImportObject(),
  );
  return createFromInstance(wasmInstance, host);
}

/**
 * Creates a formatter from the specified wasm instance.
 * @param wasmInstance - The WebAssembly instance.
 * @param host- Formatting host.
 */
export function createFromInstance(
  wasmInstance: WebAssembly.Instance,
  host: Host,
): Formatter {
  host.setInstance(wasmInstance);

  // deno-lint-ignore no-explicit-any
  const wasmExports = wasmInstance.exports as any;
  const {
    // deno-lint-ignore camelcase
    get_plugin_schema_version,
    // deno-lint-ignore camelcase
    set_file_path,
    // deno-lint-ignore camelcase
    set_override_config,
    // deno-lint-ignore camelcase
    get_formatted_text,
    format,
    // deno-lint-ignore camelcase
    get_error_text,
    // deno-lint-ignore camelcase
    get_plugin_info,
    // deno-lint-ignore camelcase
    get_resolved_config,
    // deno-lint-ignore camelcase
    get_config_diagnostics,
    // deno-lint-ignore camelcase
    set_global_config,
    // deno-lint-ignore camelcase
    set_plugin_config,
    // deno-lint-ignore camelcase
    get_license_text,
    // deno-lint-ignore camelcase
    reset_config,
  } = wasmExports;

  const pluginSchemaVersion = get_plugin_schema_version();
  const expectedPluginSchemaVersion = 3;
  if (
    pluginSchemaVersion !== 2 &&
    pluginSchemaVersion !== expectedPluginSchemaVersion
  ) {
    throw new Error(
      `Not compatible plugin. ` +
        `Expected schema ${expectedPluginSchemaVersion}, ` +
        `but plugin had ${pluginSchemaVersion}.`,
    );
  }

  let configSet = false;

  return {
    setConfig(globalConfig, pluginConfig) {
      setConfig(globalConfig, pluginConfig);
    },
    getConfigDiagnostics() {
      setConfigIfNotSet();
      const length = get_config_diagnostics();
      return JSON.parse(receiveString(wasmInstance, length));
    },
    getResolvedConfig() {
      setConfigIfNotSet();
      const length = get_resolved_config();
      return JSON.parse(receiveString(wasmInstance, length));
    },
    getPluginInfo() {
      const length = get_plugin_info();
      const pluginInfo = JSON.parse(
        receiveString(wasmInstance, length),
      ) as PluginInfo;
      pluginInfo.fileNames = pluginInfo.fileNames ?? [];
      return pluginInfo;
    },
    getLicenseText() {
      const length = get_license_text();
      return receiveString(wasmInstance, length);
    },
    formatText(filePath, fileText, overrideConfig, formatWithHost) {
      if (formatWithHost) {
        host.setHostFormatter(formatWithHost);
      }

      setConfigIfNotSet();
      if (overrideConfig != null) {
        if (pluginSchemaVersion === 2) {
          throw new Error(
            "Cannot set the override configuration for this old plugin.",
          );
        }
        sendString(wasmInstance, JSON.stringify(overrideConfig));
        set_override_config();
      }
      sendString(wasmInstance, filePath);
      set_file_path();

      sendString(wasmInstance, fileText);
      const responseCode = format();
      switch (responseCode) {
        case 0: // no change
          return fileText;
        case 1: // change
          return receiveString(wasmInstance, get_formatted_text());
        case 2: // error
          throw new Error(receiveString(wasmInstance, get_error_text()));
        default:
          throw new Error(`Unexpected response code: ${responseCode}`);
      }
    },
  };

  function setConfigIfNotSet() {
    if (!configSet) {
      setConfig({}, {});
    }
  }

  function setConfig(
    globalConfig: GlobalConfiguration,
    pluginConfig: Record<string, unknown>,
  ) {
    if (reset_config != null) {
      reset_config();
    }
    sendString(wasmInstance, JSON.stringify(globalConfig));
    set_global_config();
    sendString(wasmInstance, JSON.stringify(pluginConfig));
    set_plugin_config();
    configSet = true;
  }
}

function sendString(wasmInstance: WebAssembly.Instance, text: string) {
  // deno-lint-ignore no-explicit-any
  const exports = wasmInstance.exports as any;

  const encoder = new TextEncoder();
  const encodedText = encoder.encode(text);
  const length = encodedText.length;

  exports.clear_shared_bytes(length);

  let index = 0;
  while (index < length) {
    const writeCount = Math.min(
      length - index,
      exports.get_wasm_memory_buffer_size(),
    );
    const wasmBuffer = getWasmBuffer(wasmInstance, writeCount);
    for (let i = 0; i < writeCount; i++) {
      wasmBuffer[i] = encodedText[index + i];
    }
    exports.add_to_shared_bytes_from_buffer(writeCount);
    index += writeCount;
  }

  return length;
}

function receiveString(wasmInstance: WebAssembly.Instance, length: number) {
  // deno-lint-ignore no-explicit-any
  const exports = wasmInstance.exports as any;

  const buffer = new Uint8Array(length);
  let index = 0;
  while (index < length) {
    const readCount = Math.min(
      length - index,
      exports.get_wasm_memory_buffer_size(),
    );
    exports.set_buffer_with_shared_bytes(index, readCount);
    const wasmBuffer = getWasmBuffer(wasmInstance, readCount);
    for (let i = 0; i < readCount; i++) {
      buffer[index + i] = wasmBuffer[i];
    }
    index += readCount;
  }
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

function getWasmBuffer(wasmInstance: WebAssembly.Instance, length: number) {
  // deno-lint-ignore no-explicit-any
  const pointer = (wasmInstance.exports as any).get_wasm_memory_buffer();
  return new Uint8Array(
    // deno-lint-ignore no-explicit-any
    (wasmInstance.exports.memory as any).buffer,
    pointer,
    length,
  );
}
