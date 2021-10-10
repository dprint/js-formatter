import { build } from "https://deno.land/x/dnt@0.0.9/mod.ts";

await build({
  entryPoint: "mod.ts",
  typeCheck: true,
  outDir: "./npm",
  package: {
    name: "@dprint/formatter",
    version: Deno.args[0],
    description: "Wasm formatter for dprint plugins.",
    repository: {
      type: "git",
      url: "git+https://github.com/dprint/js-formatter.git",
    },
    keywords: [
      "dprint",
      "formatter",
      "wasm",
    ],
    author: "David Sherret",
    license: "MIT",
    bugs: {
      url: "https://github.com/dprint/js-formatter/issues",
    },
    homepage: "https://github.com/dprint/js-formatter#readme",
  },
});

Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");
