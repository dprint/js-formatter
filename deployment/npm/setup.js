// @ts-check
import * as path from "https://deno.land/std@0.98.0/path/mod.ts";
import { Project, ScriptTarget } from "https://deno.land/x/ts_morph@11.0.1/mod.ts";

const version = Deno.args.slice(2)[0];

// Update the version in package.json
const packageJsonFilePath = path.join(dirname(), "package.json");
const packageJson = JSON.parse(
  Deno.readTextFileSync(packageJsonFilePath),
);
packageJson.version = version;
Deno.writeTextFileSync(
  packageJsonFilePath,
  JSON.stringify(packageJson, undefined, 2),
);

// emit mod.ts as index.js in this folder
const project = new Project({
    compilerOptions: {
        target: ScriptTarget.ES2015,
        declaration: true,
        outDir: dirname(),
    },
});
const sourceFile = project.addSourceFileAtPath(path.join(dirname(), "../../mod.ts"));
const diagnostics = project.getPreEmitDiagnostics();
if (diagnostics.length > 0) {
    console.error(project.formatDiagnosticsWithColorAndContext(diagnostics));
    throw new Error("Had diagnostics.");
}
await sourceFile.emit();

function dirname() {
    const result = new URL(".", import.meta.url).pathname;
    return Deno.build.os === "windows" ? result.substring(1) : result;
}
