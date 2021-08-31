import { assertEquals } from "https://deno.land/std@0.98.0/testing/asserts.ts";
import { createFromBuffer, createStreaming, Formatter, GlobalConfiguration } from "./mod.ts";

Deno.test("it should create streaming", async () => {
  const formatter = await createStreaming(
    fetch("https://plugins.dprint.dev/json-0.12.0.wasm"),
  );
  runGeneralJsonFormatterTests(formatter);
});

Deno.test("it should create from buffer", async () => {
  const buffer = await fetch("https://plugins.dprint.dev/json-0.12.0.wasm")
    .then((r) => r.arrayBuffer());
  const formatter = createFromBuffer(buffer);
  runGeneralJsonFormatterTests(formatter);
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
    version: "0.12.0",
    configKey: "json",
    fileExtensions: ["json", "jsonc"],
    fileNames: [],
    helpUrl: "https://dprint.dev/plugins/json",
    configSchemaUrl: "",
  });
  assertEquals(formatter.getResolvedConfig(), {
    // todo(dsherret): this is incorrect in the plugin (should be "array.preferSingleLine")
    arrayPreferSingleLine: true,
    "commentLine.forceSpaceAfterSlashes": true,
    ignoreNodeCommentText: "dprint-ignore",
    indentWidth: 4,
    lineWidth: 30,
    newLineKind: "lf",
    // todo(dsherret): this is incorrect in the plugin
    objectPreferSingleLine: true,
    useTabs: false,
  });
  assertEquals(
    formatter.formatText("file.json", "{\ntest: [ \n1, \n2] }"),
    `{ "test": [1, 2] }\n`,
  );
  assertEquals(
    formatter.formatText("file.json", "{\ntest: [ \n1, \n2] }", {
      "object.preferSingleLine": false,
    }),
    `{\n    "test": [1, 2]\n}\n`,
  );
}
