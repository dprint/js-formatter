import { assertEquals } from "@std/assert";
import * as fs from "node:fs";
import {
  createFromBuffer,
  createStreaming,
  type Formatter,
  type GlobalConfiguration,
} from "./mod.ts";

Deno.test("it should create streaming", async () => {
  const formatter = await createStreaming(
    fetch("https://plugins.dprint.dev/json-0.13.0.wasm"),
  );
  runGeneralJsonFormatterTests(formatter);
});

Deno.test("it should create from buffer", async () => {
  const buffer = await fetch("https://plugins.dprint.dev/json-0.13.0.wasm")
    .then((r) => r.arrayBuffer());
  const formatter = createFromBuffer(buffer);
  runGeneralJsonFormatterTests(formatter);
});

Deno.test("it should support host format", async () => {
  const jsonFormatter = await createStreaming(
    fetch("https://plugins.dprint.dev/json-0.13.0.wasm"),
  );

  const markdownFormatter = await createStreaming(
    fetch("https://plugins.dprint.dev/markdown-0.16.3.wasm"),
  );
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
  }, (request) => {
    return request.filePath.endsWith(".json")
      ? jsonFormatter.formatText(request)
      : request.fileText;
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
  assertEquals(formatter.getPluginInfo(), {
    name: "dprint-plugin-json",
    version: "0.13.0",
    configKey: "json",
    helpUrl: "https://dprint.dev/plugins/json",
    configSchemaUrl: "https://plugins.dprint.dev/schemas/json-0.13.0.json",
  });
  assertEquals(formatter.getFileMatchingInfo(), {
    fileExtensions: ["json", "jsonc"],
    fileNames: [],
  });
  assertEquals(formatter.getResolvedConfig(), {
    "array.preferSingleLine": true,
    "commentLine.forceSpaceAfterSlashes": true,
    ignoreNodeCommentText: "dprint-ignore",
    indentWidth: 4,
    lineWidth: 30,
    newLineKind: "lf",
    "object.preferSingleLine": true,
    useTabs: false,
  });
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
    fs.readFileSync(new URL("./test/test_plugin_v4.wasm", import.meta.url)),
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
  formatter.setConfig({}, {
    "file_extensions": ["asdf"],
    "file_names": ["some_name"],
  });
  assertEquals(formatter.getFileMatchingInfo(), {
    fileExtensions: ["asdf"],
    fileNames: ["some_name"],
  });

  assertEquals(formatter.getLicenseText().substring(0, 15), "The MIT License");

  // test out host formatting
  {
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin: text",
    }, (request) => {
      return request.fileText + "_host";
    });
    assertEquals(result, "plugin: text_host_formatted");
  }
  // test host formatting with plugin config
  {
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin-config: text",
    }, (request) => {
      assertEquals(request.overrideConfig, { "ending": "custom_config" });
      return request.fileText + "_host";
    });
    assertEquals(result, "plugin-config: text_host_formatted");
  }
  // now try range formatting with host formatting
  {
    const result = formatter.formatText({
      filePath: "file.txt",
      fileText: "plugin-range: text",
      bytesRange: [0, 5],
    }, (request) => {
      assertEquals(request.bytesRange, [0, 5]);
      return request.fileText + "_host";
    });
    assertEquals(result, "plugin-range: text_host_formatted");
  }
});
