import type { Formatter } from "./common.ts";
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
    // deno-lint-ignore no-explicit-any
    const module = await WebAssembly.compileStreaming(response as any);
    return createFromWasmModule(module);
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
  const wasmModule = new WebAssembly.Module(wasmModuleBuffer);
  return createFromWasmModule(wasmModule);
}

export function createFromWasmModule(
  wasmModule: WebAssembly.Module,
): Formatter {
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
    throw new Error(
      "Couldn't determine dprint plugin version. Maybe the js-formatter version is too old?",
    );
  } else if (version === 3 || version === 4) {
    return version;
  } else if (version > 4) {
    throw new Error(
      `Unsupported new dprint plugin version '${version}'. Maybe the js-formatter version is too old?`,
    );
  } else {
    throw new Error(
      `Unsupported old dprint plugin version '${version}'. Please upgrade the plugin.`,
    );
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
