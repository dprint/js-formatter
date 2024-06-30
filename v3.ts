import type { FormatRequest, Formatter, GlobalConfiguration, Host, PluginInfo } from "./common.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Creates host for host formatting.
 */
export function createHost(): Host {
  let instance: WebAssembly.Instance;
  let hostFormatter: ((request: FormatRequest) => string) | undefined = undefined;

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
      let sharedBuffer = new Uint8Array(0);
      let sharedBufferIndex = 0;

      const resetSharedBuffer = (length: number) => {
        sharedBuffer = new Uint8Array(length);
        sharedBufferIndex = 0;
      };

      return {
        dprint: {
          "host_clear_bytes": (length: number) => {
            resetSharedBuffer(length);
          },
          "host_read_buffer": (pointer: number, length: number) => {
            sharedBuffer.set(getWasmBufferAtPointer(instance, pointer, length), sharedBufferIndex);
            sharedBufferIndex += length;
          },
          "host_write_buffer": (pointer: number, index: number, length: number) => {
            getWasmBufferAtPointer(instance, pointer, length).set(sharedBuffer.slice(index, index + length));
          },
          "host_take_file_path": () => {
            filePath = decoder.decode(sharedBuffer);
            resetSharedBuffer(0);
          },
          "host_take_override_config": () => {
            overrideConfig = JSON.parse(decoder.decode(sharedBuffer));
            resetSharedBuffer(0);
          },
          "host_format": () => {
            const fileText = decoder.decode(sharedBuffer);
            try {
              formattedText = hostFormatter?.({
                filePath,
                fileText,
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
            sharedBufferIndex = 0;
            return sharedBuffer.length;
          },
          "host_get_error_text": () => {
            sharedBuffer = encoder.encode(errorText);
            sharedBufferIndex = 0;
            return sharedBuffer.length;
          },
        },
      };
    },
  };
}

export function createFromInstance(
  wasmInstance: WebAssembly.Instance,
  host: Host,
): Formatter {
  host.setInstance(wasmInstance);

  // deno-lint-ignore no-explicit-any
  const wasmExports = wasmInstance.exports as any;
  const {
    get_plugin_schema_version,
    set_file_path,
    set_override_config,
    get_formatted_text,
    format,
    get_error_text,
    get_plugin_info,
    get_resolved_config,
    get_config_diagnostics,
    set_global_config,
    set_plugin_config,
    get_license_text,
    reset_config,
  } = wasmExports;

  const pluginSchemaVersion = get_plugin_schema_version();
  const expectedPluginSchemaVersion = 3;
  if (
    pluginSchemaVersion !== 2
    && pluginSchemaVersion !== expectedPluginSchemaVersion
  ) {
    throw new Error(
      `Not compatible plugin. `
        + `Expected schema ${expectedPluginSchemaVersion}, `
        + `but plugin had ${pluginSchemaVersion}.`,
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
    formatText(request, formatWithHost) {
      if (request.bytesRange != null) {
        // not supported for v3
        return request.fileText;
      }
      host.setHostFormatter(formatWithHost);

      setConfigIfNotSet();
      if (request.overrideConfig != null) {
        if (pluginSchemaVersion === 2) {
          throw new Error(
            "Cannot set the override configuration for this old plugin.",
          );
        }
        sendString(wasmInstance, JSON.stringify(request.overrideConfig));
        set_override_config();
      }
      sendString(wasmInstance, request.filePath);
      set_file_path();

      sendString(wasmInstance, request.fileText);
      const responseCode = format();
      switch (responseCode) {
        case 0: // no change
          return request.fileText;
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

  const encodedText = encoder.encode(text);
  const length = encodedText.length;
  const memoryBufferSize = exports.get_wasm_memory_buffer_size();
  const memoryBufferPointer = getWasmMemoryBufferPointer(wasmInstance);

  exports.clear_shared_bytes(length);

  let index = 0;
  while (index < length) {
    const writeCount = Math.min(length - index, memoryBufferSize);
    const wasmBuffer = getWasmBufferAtPointer(wasmInstance, memoryBufferPointer, writeCount);
    wasmBuffer.set(encodedText.slice(index, index + writeCount));
    exports.add_to_shared_bytes_from_buffer(writeCount);
    index += writeCount;
  }

  return length;
}

function receiveString(wasmInstance: WebAssembly.Instance, length: number) {
  // deno-lint-ignore no-explicit-any
  const exports = wasmInstance.exports as any;
  const memoryBufferSize = exports.get_wasm_memory_buffer_size();
  const memoryBufferPointer = getWasmMemoryBufferPointer(wasmInstance);

  const buffer = new Uint8Array(length);
  let index = 0;
  while (index < length) {
    const readCount = Math.min(length - index, memoryBufferSize);
    exports.set_buffer_with_shared_bytes(index, readCount);
    const wasmBuffer = getWasmBufferAtPointer(wasmInstance, memoryBufferPointer, readCount);
    buffer.set(wasmBuffer, index);
    index += readCount;
  }
  return decoder.decode(buffer);
}

function getWasmMemoryBufferPointer(wasmInstance: WebAssembly.Instance): number {
  // deno-lint-ignore no-explicit-any
  return (wasmInstance.exports as any).get_wasm_memory_buffer();
}

function getWasmBufferAtPointer(wasmInstance: WebAssembly.Instance, pointer: number, length: number) {
  return new Uint8Array(
    // deno-lint-ignore no-explicit-any
    (wasmInstance.exports.memory as any).buffer,
    pointer,
    length,
  );
}
