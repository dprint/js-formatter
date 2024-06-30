import type { FormatRequest, Formatter, GlobalConfiguration, Host, PluginInfo } from "./common.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Creates host for host formatting.
 */
export function createHost(): Host {
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
    createImportObject(): WebAssembly.Imports {
      let sharedBuffer = new Uint8Array(0);

      const resetSharedBuffer = (length: number) => {
        sharedBuffer = new Uint8Array(length);
      };

      return {
        dprint: {
          "host_has_cancelled": () => 0,
          "host_clear_bytes": (length: number) => {
            resetSharedBuffer(length);
          },
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
    getPluginInfo() {
      const length = get_plugin_info();
      const pluginInfo = JSON.parse(receiveString(length)) as PluginInfo;
      pluginInfo.fileNames = pluginInfo.fileNames ?? [];
      return pluginInfo;
    },
    getLicenseText() {
      const length = get_license_text();
      return receiveString(length);
    },
    formatText(request, formatWithHost) {
      if (request.bytesRange != null && format_range == null) {
        // plugin doesn't support range formatting
        return request.fileText;
      }

      host.setHostFormatter(formatWithHost);

      setConfigIfNotSet();
      if (request.overrideConfig != null) {
        sendString(JSON.stringify(request.overrideConfig));
        set_override_config();
      }
      sendString(request.filePath);
      set_file_path();

      sendString(request.fileText);
      const responseCode = request.bytesRange != null
        ? format_range(request.bytesRange[0], request.bytesRange[1])
        : format();
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

function getWasmBufferAtPointer(wasmInstance: WebAssembly.Instance, pointer: number, length: number) {
  return new Uint8Array(
    // deno-lint-ignore no-explicit-any
    (wasmInstance.exports.memory as any).buffer,
    pointer,
    length,
  );
}
