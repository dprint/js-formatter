import { build } from "@deno/dnt";

await build({
  entryPoints: ["mod.ts"],
  test: true,
  outDir: "./npm",
  importMap: "./deno.json",
  shims: {
    deno: {
      test: "dev",
    },
    customDev: [{
      globalNames: ["fetch"],
      package: {
        name: "undici",
        version: "^4.12.1",
      },
    }],
  },
  compilerOptions: {
    lib: ["ES2021", "DOM"],
  },
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
