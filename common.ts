export interface FormatRequest {
  /** The file path to format. */
  filePath: string;
  /** File text to format. */
  fileText: string;
  /** Byte range to format. Note this is BYTE range and NOT character range. */
  bytesRange?: readonly [number, number];
  /** Configuration to set for a single format. */
  overrideConfig?: Record<string, unknown>;
}

/** Options for creating a formatter. */
export interface FormatterOptions {
  /**
   * Called with the text a plugin writes to stdout or stderr. Control characters
   * other than newlines and tabs are replaced in the text.
   * @remarks When not provided, the text is written to stderr in runtimes that have
   * a `process` global (ex. Node.js and Deno) and is otherwise discarded.
   */
  onOutput?: (text: string) => void;
}

export interface Host {
  setInstance(wasmInstance: WebAssembly.Instance): void;
  setHostFormatter(formatWithHost: ((request: FormatRequest) => string) | undefined): void;
  /**
   * Creates the imports to instantiate the plugin with.
   * @param wasmModule - Module of the plugin, which allows providing the WASI functions it imports.
   */
  createImportObject(wasmModule?: WebAssembly.Module): WebAssembly.Imports;
}

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
   * Gets what files the plugin matches based on the current configuration.
   */
  getFileMatchingInfo(): FileMatchingInfo;
  /**
   * Gets the license text of the plugin.
   */
  getLicenseText(): string;
  /**
   * Sets the host formatter for formatting embedded code.
   * @param formatWithHost - A function that formats embedded code blocks.
   */
  setHostFormatter(formatWithHost: ((request: FormatRequest) => string) | undefined): void;
  /**
   * Formats the specified file text.
   * @param request - Data to format.
   * @returns The formatted text.
   * @throws If there is an error formatting.
   */
  formatText(request: FormatRequest): string;
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
  helpUrl: string;
  configSchemaUrl: string;
  updateUrl?: string;
}

/** Information about how the current config matches files. */
export interface FileMatchingInfo {
  fileExtensions: string[];
  fileNames: string[];
}
