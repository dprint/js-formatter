import { build, emptyDir } from "@deno/dnt";

const wasmFileLocations = [
  "npm/script/test",
  "npm/esm/test",
];

await emptyDir("npm");

await build({
  entryPoints: ["mod.ts"],
  test: true,
  outDir: "./npm",
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
    lib: ["ESNext", "DOM"],
  },
  postBuild: () => {
    for (const location of wasmFileLocations) {
      Deno.mkdirSync(location, { recursive: true });
      Deno.copyFileSync("test/test_plugin_v4.wasm", location + "/test_plugin_v4.wasm");
    }
  },
  filterDiagnostic(diagnostic) {
    // not sure what's up here... just ignore it
    return !diagnostic.file?.fileName.includes("_dnt.test_polyfills.ts");
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
    devDependencies: {
      "@types/node": "^25",
    },
  },
});

Deno.copyFileSync("LICENSE", "npm/LICENSE");
Deno.copyFileSync("README.md", "npm/README.md");

for (const location of wasmFileLocations) {
  Deno.removeSync(location + "/test_plugin_v4.wasm");
}
