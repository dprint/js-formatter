// Builds test/test_wasi.wasm, which is a module that imports the WASI functions
// and exports a function for each one in order to call them in the tests.
import wabt from "wabt";

/** The functions that get imported and their parameters. Everything returns an i32 unless specified. */
const functions: { name: string; params: string; noResult?: true }[] = [
  { name: "fd_write", params: "i32 i32 i32 i32" },
  { name: "fd_read", params: "i32 i32 i32 i32" },
  { name: "fd_close", params: "i32" },
  { name: "fd_seek", params: "i32 i64 i32 i32" },
  { name: "fd_fdstat_get", params: "i32 i32" },
  { name: "fd_filestat_get", params: "i32 i32" },
  { name: "fd_prestat_get", params: "i32 i32" },
  { name: "clock_time_get", params: "i32 i64 i32" },
  { name: "clock_res_get", params: "i32 i32" },
  { name: "random_get", params: "i32 i32" },
  { name: "poll_oneoff", params: "i32 i32 i32 i32" },
  { name: "sched_yield", params: "" },
  { name: "proc_exit", params: "i32", noResult: true },
  { name: "args_sizes_get", params: "i32 i32" },
  { name: "environ_sizes_get", params: "i32 i32" },
  { name: "path_open", params: "i32 i32 i32 i32 i32 i64 i64 i32 i32" },
  { name: "path_unlink_file", params: "i32 i32 i32" },
  // not supported
  { name: "sock_send", params: "i32 i32 i32 i32 i32" },
  { name: "path_create_directory", params: "i32 i32 i32" },
];

const wat = `(module
${functions.map(getImportText).join("\n")}
  (memory (export "memory") 1)
  (global $initialize_count (mut i32) (i32.const 0))
  (func (export "dprint_plugin_version_4") (result i32) (i32.const 4))
  (func (export "_initialize") (global.set $initialize_count (i32.add (global.get $initialize_count) (i32.const 1))))
  (func (export "get_plugin_info") (result i32) (global.get $initialize_count))
${functions.map(getExportText).join("\n")}
)`;

const wasmModule = (await wabt()).parseWat("test_wasi.wat", wat);
const outputPath = new URL("../test/test_wasi.wasm", import.meta.url);
Deno.writeFileSync(outputPath, wasmModule.toBinary({}).buffer);

function getImportText(func: typeof functions[number]) {
  return `  (import "wasi_snapshot_preview1" "${func.name}" (func $${func.name}${getSignatureText(func)}))`;
}

function getExportText(func: typeof functions[number]) {
  const paramCount = func.params.split(" ").filter((p) => p.length > 0).length;
  const locals = Array.from({ length: paramCount }, (_, i) => ` (local.get ${i})`).join("");
  return `  (func (export "${func.name}")${getSignatureText(func)} (call $${func.name}${locals}))`;
}

function getSignatureText(func: typeof functions[number]) {
  const params = func.params.length > 0 ? ` (param ${func.params})` : "";
  return params + (func.noResult ? "" : " (result i32)");
}
