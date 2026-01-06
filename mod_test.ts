import * as json from "@dprint/json";
import * as markdown from "@dprint/markdown";
import * as typescript from "@dprint/typescript";
import { assertEquals, assertThrows } from "@std/assert";
import * as fs from "node:fs";
import {
  createContext,
  createFromBuffer,
  createStreaming,
  type Formatter,
  type GlobalConfiguration,
  type ResponseLike,
} from "./mod.ts";

/** Creates a fake Response object from a buffer for testing createStreaming */
function createFakeResponse(buffer: BufferSource): ResponseLike {
  return {
    status: 200,
    arrayBuffer: () => Promise.resolve(buffer),
    text: () => Promise.resolve(""),
    headers: {
      get: () => null, // Not application/wasm, so it will use arrayBuffer fallback
    },
  };
}

const plugins = {
  json: fs.readFileSync(json.getPath()),
  markdown: fs.readFileSync(markdown.getPath()),
  typescript: fs.readFileSync(typescript.getPath()),
};

Deno.test("it should create streaming", async () => {
  const formatter = await createStreaming(createFakeResponse(plugins.json));
  runGeneralJsonFormatterTests(formatter);
});

Deno.test("it should create from buffer", () => {
  const formatter = createFromBuffer(plugins.json);
  runGeneralJsonFormatterTests(formatter);
});

Deno.test("it should support host format", () => {
  const jsonFormatter = createFromBuffer(plugins.json);
  const markdownFormatter = createFromBuffer(plugins.markdown);

  markdownFormatter.setHostFormatter((request) => {
    return request.filePath.endsWith(".json")
      ? jsonFormatter.formatText(request)
      : request.fileText;
  });
  const formatted = markdownFormatter.formatText({
    filePath: "file.md",
    fileText: `# heading1
\`\`\`json
{"a":[1,2,3]}
\`\`\`

\`\`\`ts
console . log ( value )
\`\`\`
`,
  });
  assertEquals(
    formatted,
    `# heading1

\`\`\`json
{ "a": [1, 2, 3] }
\`\`\`

\`\`\`ts
console . log ( value )
\`\`\`
`,
  );
});

function runGeneralJsonFormatterTests(formatter: Formatter) {
  const globalConfig: GlobalConfiguration = {
    indentWidth: 4,
    lineWidth: 30,
  };
  formatter.setConfig(globalConfig, {
    preferSingleLine: true,
  });
  assertEquals(formatter.getConfigDiagnostics().length, 0);
  assertEquals(formatter.getLicenseText().includes("MIT"), true);
  const pluginInfo = formatter.getPluginInfo();
  assertEquals(pluginInfo.name, "dprint-plugin-json");
  assertEquals(pluginInfo.configKey, "json");
  assertEquals(formatter.getFileMatchingInfo(), {
    fileExtensions: ["json", "jsonc"],
    fileNames: [],
  });
  const resolvedConfig = formatter.getResolvedConfig();
  assertEquals(resolvedConfig["array.preferSingleLine"], true);
  assertEquals(resolvedConfig["object.preferSingleLine"], true);
  assertEquals(resolvedConfig.indentWidth, 4);
  assertEquals(resolvedConfig.lineWidth, 30);
  assertEquals(
    formatter.formatText({
      filePath: "file.json",
      fileText: "{\ntest: [ \n1, \n2] }",
    }),
    `{ "test": [1, 2] }\n`,
  );
  assertEquals(
    formatter.formatText({
      filePath: "file.json",
      fileText: "{\ntest: [ \n1, \n2] }",
      overrideConfig: {
        "object.preferSingleLine": false,
      },
    }),
    `{\n    "test": [1, 2]\n}\n`,
  );
}

Deno.test("should support v4", () => {
  // this plugin file's code is here: https://github.com/dprint/dprint/blob/main/crates/test-plugin/src/lib.rs
  const formatter = createFromBuffer(
    new Uint8Array(fs.readFileSync(new URL("./test/test_plugin_v4.wasm", import.meta.url))),
  );

  formatter.setConfig({}, { "ending": "formatted_wasm" });
  {
    const result = formatter.formatText({
      filePath: "test.txt",
      fileText: `test`,
    });
    assertEquals(result, `test_formatted_wasm`);
  }
  formatter.setConfig({}, { "ending": "other" });
  {
    const result = formatter.formatText({
      filePath: "test.txt",
      fileText: `test`,
    });
    assertEquals(result, `test_other`);
  }
  // these will trigger fd_write
  {
    const result = formatter.formatText({
      filePath: "test.txt",
      fileText: `stderr: hi on stderr`,
    });
    assertEquals(result, `stderr: hi on stderr_other`);
  }
  {
    const result = formatter.formatText({
      filePath: "test.txt",
      fileText: `stdout: hi on stdout`,
    });
    assertEquals(result, `stdout: hi on stdout_other`);
  }

  assertEquals(formatter.getPluginInfo(), {
    name: "test-plugin",
    version: "0.2.0",
    configKey: "test-plugin",
    helpUrl: "https://dprint.dev/plugins/test",
    configSchemaUrl: "https://plugins.dprint.dev/test/schema.json",
    updateUrl: "https://plugins.dprint.dev/dprint/test-plugin/latest.json",
  });
  assertEquals(formatter.getFileMatchingInfo(), {
    fileExtensions: ["txt"],
    fileNames: [],
  });

  // some special config in this plugin
  formatter.setConfig({}, { "file_extensions": ["asdf"], "file_names": ["some_name"] });
  assertEquals(formatter.getFileMatchingInfo(), {
    fileExtensions: ["asdf"],
    fileNames: ["some_name"],
  });

  assertEquals(formatter.getLicenseText().substring(0, 15), "The MIT License");

  // test out host formatting
  {
    formatter.setHostFormatter((request) => {
      return request.fileText + "_host";
    });
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin: text",
    });
    assertEquals(result, "plugin: text_host_formatted");
  }
  // test host formatting with plugin config
  {
    formatter.setHostFormatter((request) => {
      assertEquals(request.overrideConfig, { "ending": "custom_config" });
      return request.fileText + "_host";
    });
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin-config: text",
    });
    assertEquals(result, "plugin-config: text_host_formatted");
  }
  // now try range formatting with host formatting
  {
    formatter.setHostFormatter((request) => {
      assertEquals(request.bytesRange, [0, 5]);
      return request.fileText + "_host";
    });
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin-range: text",
      bytesRange: [0, 5],
    });
    assertEquals(result, "plugin-range: text_host_formatted");
  }
});

// Context API tests

Deno.test("createContext - should format with added plugin", () => {
  const context = createContext({
    indentWidth: 2,
    lineWidth: 80,
  });

  const jsonFormatter = context.addPlugin(plugins.json, {
    preferSingleLine: true,
  });

  // Format using the returned formatter
  const result = jsonFormatter.formatText({
    filePath: "file.json",
    fileText: "{\"a\":1,\"b\":2}",
  });
  assertEquals(result, "{ \"a\": 1, \"b\": 2 }\n");
});

Deno.test("createContext - should auto-select plugin by file extension", () => {
  const context = createContext({});

  context.addPlugin(plugins.json);

  // Format using context.formatText (auto-selects plugin)
  const result = context.formatText({
    filePath: "config.json",
    fileText: "{\"a\":1}",
  });
  assertEquals(result, "{ \"a\": 1 }\n");

  // Should also work with .jsonc
  const result2 = context.formatText({
    filePath: "settings.jsonc",
    fileText: "{\"b\":2}",
  });
  assertEquals(result2, "{ \"b\": 2 }\n");
});

Deno.test("createContext - should throw when no plugin matches", () => {
  const context = createContext({});

  context.addPlugin(plugins.json);

  assertThrows(
    () => {
      context.formatText({
        filePath: "file.ts",
        fileText: "const x = 1;",
      });
    },
    Error,
    "No plugin found for file: file.ts",
  );
});

Deno.test("createContext - should support multiple plugins", () => {
  const context = createContext({});

  context.addPlugin(plugins.json);
  context.addPlugin(plugins.markdown);

  // Format JSON
  const jsonResult = context.formatText({
    filePath: "data.json",
    fileText: "{\"key\":\"value\"}",
  });
  assertEquals(jsonResult, "{ \"key\": \"value\" }\n");

  // Format Markdown
  const mdResult = context.formatText({
    filePath: "README.md",
    fileText: "#  Title\nsome   text",
  });
  assertEquals(mdResult, "# Title\n\nsome text\n");
});

Deno.test("createContext - should support host formatting between plugins", () => {
  const context = createContext({});

  context.addPlugin(plugins.json);
  context.addPlugin(plugins.markdown);

  // Markdown with embedded JSON should format both
  const result = context.formatText({
    filePath: "file.md",
    fileText: `# heading1
\`\`\`json
{"a":[1,2,3]}
\`\`\`
`,
  });

  assertEquals(
    result,
    `# heading1

\`\`\`json
{ "a": [1, 2, 3] }
\`\`\`
`,
  );
});

Deno.test("createContext - addPluginStreaming should work", async () => {
  const context = createContext({});

  const jsonFormatter = await context.addPluginStreaming(createFakeResponse(plugins.json));

  const result = jsonFormatter.formatText({
    filePath: "file.json",
    fileText: "{\"a\":1}",
  });
  assertEquals(result, "{ \"a\": 1 }\n");
});

Deno.test("createContext - getConfigDiagnostics should aggregate from all plugins", () => {
  const context = createContext({});

  context.addPlugin(plugins.json, {
    invalidOption: true,
  });

  const diagnostics = context.getConfigDiagnostics();
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].propertyName, "invalidOption");
});
