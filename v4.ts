import type { FormatRequest, Formatter, FormatterOptions, GlobalConfiguration, Host, PluginInfo } from "./common.ts";
import type { FileMatchingInfo } from "./mod.ts";
import { addUnsupportedWasiImports, createWasiImports, WASI_MODULE_NAME } from "./wasi.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Creates host for host formatting.
 */
export function createHost(options: FormatterOptions = {}): Host {
  const writeOutput = options.onOutput ?? writeStderr;
  let instance: WebAssembly.Instance;
  let hostFormatter: ((request: FormatRequest) => string) | undefined = undefined;
  let formattedText = "";
  let errorText = "";

  return {
    setInstance(wasmInstance: WebAssembly.Instance) {
      instance = wasmInstance;
    },
    setHostFormatter(formatWithHost) {
      hostFormatter = formatWithHost;
    },
    createImportObject(wasmModule?: WebAssembly.Module): WebAssembly.Imports {
      let sharedBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
      const wasiImports = createWasiImports({
        // the instance isn't set while the module is being instantiated
        getMemory: () =>
          (instance as WebAssembly.Instance | undefined)?.exports.memory as WebAssembly.Memory | undefined,
        // stdout and stderr are both written to the same place
        writeOutput,
      });
      if (wasmModule != null) {
        addUnsupportedWasiImports(wasiImports, wasmModule);
      }

      return {
        env: {
          "fd_write": wasiImports.fd_write,
        },
        [WASI_MODULE_NAME]: wasiImports,
        dprint: {
          "host_has_cancelled": () => 0,
          "host_write_buffer": (pointer: number) => {
            getWasmBufferAtPointer(instance, pointer, sharedBuffer.length).set(sharedBuffer);
          },
          "host_format": (
            filePathPtr: number,
            filePathLen: number,
            rangeStart: number,
            rangeEnd: number,
            overrideConfigPtr: number,
            overrideConfigLen: number,
            fileBytesPtr: number,
            fileBytesLen: number,
          ) => {
            const filePath = receiveString(filePathPtr, filePathLen);
            const overrideConfigRaw = receiveString(overrideConfigPtr, overrideConfigLen);

            const overrideConfig = overrideConfigRaw === "" ? {} : JSON.parse(overrideConfigRaw);
            const fileText = receiveString(fileBytesPtr, fileBytesLen);
            const bytesRange = rangeStart === 0 && rangeEnd === fileBytesLen
              ? undefined
              : [rangeStart, rangeEnd] as const;
            try {
              formattedText = hostFormatter?.({
                filePath,
                fileText,
                bytesRange,
                overrideConfig,
              }) ?? fileText;
              return fileText === formattedText ? 0 : 1;
            } catch (error) {
              errorText = String(error);
              return 2;
            }
          },
          "host_get_formatted_text": () => {
            sharedBuffer = encoder.encode(formattedText);
            return sharedBuffer.length;
          },
          "host_get_error_text": () => {
            sharedBuffer = encoder.encode(errorText);
            return sharedBuffer.length;
          },
        },
      };
    },
  };

  function receiveString(ptr: number, length: number) {
    return decoder.decode(getWasmBufferAtPointer(instance, ptr, length));
  }
}

export function createFromInstance(
  wasmInstance: WebAssembly.Instance,
  host: Host,
): Formatter {
  host.setInstance(wasmInstance);

  // only a single config is supported in here atm
  const configId = 1;
  // deno-lint-ignore no-explicit-any
  const wasmExports = wasmInstance.exports as any;
  initializeWasiReactor(wasmExports);
  const {
    get_shared_bytes_ptr,
    set_file_path,
    set_override_config,
    clear_shared_bytes,
    get_formatted_text,
    format,
    format_range,
    get_error_text,
    get_plugin_info,
    get_config_file_matching,
    get_resolved_config,
    get_config_diagnostics,
    get_license_text,
    register_config,
    release_config,
  } = wasmExports;

  let configSet = false;

  return {
    setConfig(globalConfig, pluginConfig) {
      setConfig(globalConfig, pluginConfig);
    },
    getConfigDiagnostics() {
      setConfigIfNotSet();
      const length = get_config_diagnostics(configId);
      return JSON.parse(receiveString(length));
    },
    getResolvedConfig() {
      setConfigIfNotSet();
      const length = get_resolved_config(configId);
      return JSON.parse(receiveString(length));
    },
    getFileMatchingInfo() {
      const length = get_config_file_matching(configId);
      return JSON.parse(receiveString(length)) as FileMatchingInfo;
    },
    getPluginInfo() {
      const length = get_plugin_info();
      return JSON.parse(receiveString(length)) as PluginInfo;
    },
    getLicenseText() {
      const length = get_license_text();
      return receiveString(length);
    },
    setHostFormatter(formatWithHost) {
      host.setHostFormatter(formatWithHost);
    },
    formatText(request) {
      if (request.bytesRange != null && format_range == null) {
        // plugin doesn't support range formatting
        return request.fileText;
      }

      setConfigIfNotSet();
      if (request.overrideConfig != null) {
        sendString(JSON.stringify(request.overrideConfig));
        set_override_config();
      }
      sendString(request.filePath);
      set_file_path();

      sendString(request.fileText);
      const responseCode = request.bytesRange != null
        ? format_range(configId, request.bytesRange[0], request.bytesRange[1])
        : format(configId);
      switch (responseCode) {
        case 0: // no change
          return request.fileText;
        case 1: // change
          return receiveString(get_formatted_text());
        case 2: // error
          throw new Error(receiveString(get_error_text()));
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
    release_config(configId);
    sendString(JSON.stringify({
      global: globalConfig,
      plugin: pluginConfig,
    }));
    register_config(configId);
    configSet = true;
  }

  function sendString(value: string) {
    const bytes = encoder.encode(value);
    const ptr = clear_shared_bytes(bytes.length);
    getWasmBufferAtPointer(wasmInstance, ptr, bytes.length).set(bytes);
  }

  function receiveString(length: number) {
    const ptr = get_shared_bytes_ptr();
    return decoder.decode(getWasmBufferAtPointer(wasmInstance, ptr, length));
  }
}

function writeStderr(text: string) {
  try {
    // deno-lint-ignore no-explicit-any
    (globalThis as any).process?.stderr.write(text);
  } catch {
    // ignore
  }
}

/**
 * Plugins linked against a WASI libc are "reactors", which need to be
 * initialized before any of their other exports are called.
 */
// deno-lint-ignore no-explicit-any
function initializeWasiReactor(wasmExports: any) {
  if (typeof wasmExports._initialize === "function") {
    wasmExports._initialize();
  } else if (wasmExports._start != null) {
    // a WASI "command" only initializes its libc when running its main function,
    // which leaves nothing initialized for the plugin's other exports
    throw new Error(
      "The plugin was built as a WASI command (it exports _start), but it must be built as a WASI reactor (exporting _initialize).",
    );
  }
}

function getWasmBufferAtPointer(wasmInstance: WebAssembly.Instance, pointer: number, length: number) {
  return new Uint8Array(
    // deno-lint-ignore no-explicit-any
    (wasmInstance.exports.memory as any).buffer,
    pointer,
    length,
  );
}
