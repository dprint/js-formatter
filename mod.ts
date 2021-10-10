// Copyright 2020-2021 by David Sherret. All rights reserved.
// This work is licensed under the terms of the MIT license.
// For a copy, see <https://opensource.org/licenses/MIT>.

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
   * @returns The formatted text.
   * @throws If there is an error formatting.
   */
  formatText(
    filePath: string,
    fileText: string,
    overrideConfig?: Record<string, unknown>,
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

/**
 * Creates the WebAssembly import object, if necessary.
 */
export function createImportObject(): WebAssembly.Imports {
  // for now, use an identity object
  return {
    dprint: {
      "host_clear_bytes": () => {},
      "host_read_buffer": () => {},
      "host_write_buffer": () => {},
      "host_take_file_path": () => {},
      "host_take_override_config": () => {},
      "host_format": () => 0, // no change
      "host_get_formatted_text": () => 0, // zero length
      "host_get_error_text": () => 0, // zero length
    },
  };
}

/**
 * Creates a formatter from the specified streaming source.
 * @remarks This is the most efficient way to create a formatter.
 * @param response - The streaming source to create the formatter from.
 */
export function createStreaming(
  response: Promise<Response>,
): Promise<Formatter> {
  // instantiateStreaming is not working in Deno (issue #309) and in newer versions
  // it no longer exists on the `WebAssembly` object, so use an `any` type here.
  if (
    // deno-lint-ignore no-explicit-any
    (WebAssembly as any).instantiateStreaming == null
    // deno-shim-ignore
    || typeof globalThis?.Deno != null
  ) {
    return getArrayBuffer()
      .then((buffer) => createFromBuffer(buffer));
  } else {
    // deno-lint-ignore no-explicit-any
    return (WebAssembly as any)
      .instantiateStreaming(
        response,
        createImportObject(),
      )
      .then((
        // deno-lint-ignore no-explicit-any
        obj: any,
      ) => createFromInstance(obj.instance));
  }

  function getArrayBuffer() {
    if (isResponse(response)) {
      return response.arrayBuffer();
    } else {
      return response.then((response) => response.arrayBuffer());
    }

    function isResponse(response: unknown): response is Response {
      return (response as Response).arrayBuffer != null;
    }
  }
}

/**
 * Creates a formatter from the specified wasm module bytes.
 * @param wasmModuleBuffer - The buffer of the wasm module.
 */
export function createFromBuffer(wasmModuleBuffer: BufferSource): Formatter {
  const wasmModule = new WebAssembly.Module(wasmModuleBuffer);
  const wasmInstance = new WebAssembly.Instance(
    wasmModule,
    createImportObject(),
  );
  return createFromInstance(wasmInstance);
}

/**
 * Creates a formatter from the specified wasm instance.
 * @param wasmInstance - The WebAssembly instance.
 */
export function createFromInstance(
  wasmInstance: WebAssembly.Instance,
): Formatter {
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
    get_wasm_memory_buffer,
    // deno-lint-ignore camelcase
    get_wasm_memory_buffer_size,
    // deno-lint-ignore camelcase
    add_to_shared_bytes_from_buffer,
    // deno-lint-ignore camelcase
    set_buffer_with_shared_bytes,
    // deno-lint-ignore camelcase
    clear_shared_bytes,
    // deno-lint-ignore camelcase
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

  const bufferSize = get_wasm_memory_buffer_size();
  let configSet = false;

  return {
    setConfig(globalConfig, pluginConfig) {
      setConfig(globalConfig, pluginConfig);
    },
    getConfigDiagnostics() {
      setConfigIfNotSet();
      const length = get_config_diagnostics();
      return JSON.parse(receiveString(length));
    },
    getResolvedConfig() {
      setConfigIfNotSet();
      const length = get_resolved_config();
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
    formatText(filePath, fileText, overrideConfig) {
      setConfigIfNotSet();
      if (overrideConfig != null) {
        if (pluginSchemaVersion === 2) {
          throw new Error(
            "Cannot set the override configuration for this old plugin.",
          );
        }
        sendString(JSON.stringify(overrideConfig));
        set_override_config();
      }
      sendString(filePath);
      set_file_path();

      sendString(fileText);
      const responseCode = format();
      switch (responseCode) {
        case 0: // no change
          return fileText;
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
    if (reset_config != null) {
      reset_config();
    }
    sendString(JSON.stringify(globalConfig));
    set_global_config();
    sendString(JSON.stringify(pluginConfig));
    set_plugin_config();
    configSet = true;
  }

  function sendString(text: string) {
    const encoder = new TextEncoder();
    const encodedText = encoder.encode(text);
    const length = encodedText.length;

    clear_shared_bytes(length);

    let index = 0;
    while (index < length) {
      const writeCount = Math.min(length - index, bufferSize);
      const wasmBuffer = getWasmBuffer(writeCount);
      for (let i = 0; i < writeCount; i++) {
        wasmBuffer[i] = encodedText[index + i];
      }
      add_to_shared_bytes_from_buffer(writeCount);
      index += writeCount;
    }
  }

  function receiveString(length: number) {
    const buffer = new Uint8Array(length);
    let index = 0;
    while (index < length) {
      const readCount = Math.min(length - index, bufferSize);
      set_buffer_with_shared_bytes(index, readCount);
      const wasmBuffer = getWasmBuffer(readCount);
      for (let i = 0; i < readCount; i++) {
        buffer[index + i] = wasmBuffer[i];
      }
      index += readCount;
    }
    const decoder = new TextDecoder();
    return decoder.decode(buffer);
  }

  function getWasmBuffer(length: number) {
    const pointer = get_wasm_memory_buffer();
    return new Uint8Array(
      // deno-lint-ignore no-explicit-any
      (wasmInstance.exports.memory as any).buffer,
      pointer,
      length,
    );
  }
}
