import { assert, assertEquals, assertThrows } from "@std/assert";
import * as fs from "node:fs";
import { createFromBuffer, type Host } from "./mod.ts";
import * as v4 from "./v4.ts";
import { addUnsupportedWasiImports, createWasiImports, WASI_MODULE_NAME } from "./wasi.ts";

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_FAULT = 21;
const ERRNO_INVAL = 28;
const ERRNO_NOSYS = 52;
const ERRNO_SPIPE = 70;

const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;
const NANOS_PER_MILLI = 1_000_000n;
const MEMORY_SIZE = 65536;

// built by scripts/build_test_wasm.ts
const testWasm = new Uint8Array(fs.readFileSync(new URL("./test/test_wasi.wasm", import.meta.url)));

Deno.test("wasi - should instantiate and initialize a plugin importing wasi functions", () => {
  const host = v4.createHost();
  const wasmModule = new WebAssembly.Module(testWasm);
  const instance = new WebAssembly.Instance(wasmModule, host.createImportObject(wasmModule));
  v4.createFromInstance(instance, host);
  // the test plugin returns the number of times it was initialized
  // deno-lint-ignore no-explicit-any
  assertEquals((instance.exports as any).get_plugin_info(), 1);

  // ensure the public api can create it
  createFromBuffer(testWasm);
});

Deno.test("wasi - should provide the output of a plugin to the onOutput option", () => {
  const output: string[] = [];
  const exports = instantiateWithHost(v4.createHost({ onOutput: (text) => output.push(text) }));
  writeHello(exports);
  assertEquals(output, ["hello\n"]);
});

Deno.test("wasi - should write the output of a plugin to stderr by default", () => {
  // deno-lint-ignore no-explicit-any
  const stderr = (globalThis as any).process.stderr;
  const originalWrite = stderr.write;
  const output: unknown[] = [];
  stderr.write = (text: unknown) => {
    output.push(text);
    return true;
  };
  try {
    writeHello(instantiateWithHost(v4.createHost()));
  } finally {
    stderr.write = originalWrite;
  }
  assertEquals(output, ["hello\n"]);
});

Deno.test("wasi - should fail for a wasi command", () => {
  // (module (func (export "dprint_plugin_version_4") (result i32) (i32.const 4)) (func (export "_start")))
  // deno-fmt-ignore
  const commandWasm = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    0x01,
    0x08,
    0x02,
    0x60,
    0x00,
    0x01,
    0x7f,
    0x60,
    0x00,
    0x00,
    0x03,
    0x03,
    0x02,
    0x00,
    0x01,
    0x07,
    0x24,
    0x02,
    0x17,
    0x64,
    0x70,
    0x72,
    0x69,
    0x6e,
    0x74,
    0x5f,
    0x70,
    0x6c,
    0x75,
    0x67,
    0x69,
    0x6e,
    0x5f,
    0x76,
    0x65,
    0x72,
    0x73,
    0x69,
    0x6f,
    0x6e,
    0x5f,
    0x34,
    0x00,
    0x00,
    0x06,
    0x5f,
    0x73,
    0x74,
    0x61,
    0x72,
    0x74,
    0x00,
    0x01,
    0x0a,
    0x09,
    0x02,
    0x04,
    0x00,
    0x41,
    0x04,
    0x0b,
    0x02,
    0x00,
    0x0b,
  ]);
  assertThrows(
    () => createFromBuffer(commandWasm),
    Error,
    "The plugin was built as a WASI command (it exports _start), but it must be built as a WASI reactor (exporting _initialize).",
  );
});

Deno.test("wasi - should fail without memory", () => {
  const imports = createWasiImports({ getMemory: () => undefined, writeOutput: () => {} });
  assertEquals(imports.clock_time_get(CLOCK_REALTIME, 0n, 0), ERRNO_FAULT);
  assertEquals(imports.random_get(0, 16), ERRNO_FAULT);
  assertEquals(imports.fd_write(1, 0, 1, 0), ERRNO_FAULT);
  assertEquals(imports.args_sizes_get(0, 4), ERRNO_FAULT);
  assertEquals(imports.fd_fdstat_get(1, 0), ERRNO_FAULT);
});

Deno.test("wasi - should fail for out of bounds pointers", () => {
  const module = new TestModule();
  for (const [ptr, len] of [[65530, 10], [-1, -1], [-1, 1], [65536, 1], [0, 65537], [0, -1]]) {
    assertEquals(module.exports.random_get(ptr, len), ERRNO_FAULT, `${ptr} ${len}`);
  }
  for (const [ptr, len] of [[65536, 0], [0, 65536], [65535, 1]]) {
    assertEquals(module.exports.random_get(ptr, len), ERRNO_SUCCESS, `${ptr} ${len}`);
  }
  for (const ptr of [65529, 65535, 65536, -1, -8, -2147483648]) {
    assertEquals(module.exports.clock_time_get(CLOCK_MONOTONIC, 0n, ptr), ERRNO_FAULT, `${ptr}`);
    assertEquals(module.exports.clock_res_get(CLOCK_MONOTONIC, ptr), ERRNO_FAULT, `${ptr}`);
  }
  assertEquals(module.exports.args_sizes_get(0, 65534), ERRNO_FAULT);
  assertEquals(module.exports.environ_sizes_get(65534, 0), ERRNO_FAULT);
  assertEquals(module.exports.fd_fdstat_get(1, 65520), ERRNO_FAULT);
  assertEquals(module.exports.fd_filestat_get(1, 65520), ERRNO_FAULT);
  assertEquals(module.exports.fd_read(0, 0, 1, 65534), ERRNO_FAULT);
  // nwritten out of bounds
  assertEquals(module.exports.fd_write(1, 0, 0, 65534), ERRNO_FAULT);
  // iovec out of bounds
  assertEquals(module.exports.fd_write(1, 65532, 1, 0), ERRNO_FAULT);
  assertEquals(module.exports.fd_write(1, -8, 2, 0), ERRNO_FAULT);
  // buffer out of bounds
  module.writeIovec(0, 65530, 10);
  assertEquals(module.exports.fd_write(1, 0, 1, 100), ERRNO_FAULT);
  assertEquals(module.output, []);
});

Deno.test("wasi - should get the time from the clocks", () => {
  const module = new TestModule();
  assertEquals(module.exports.clock_res_get(CLOCK_REALTIME, 0), ERRNO_SUCCESS);
  assertEquals(module.view.getBigUint64(0, true), NANOS_PER_MILLI);
  assertEquals(module.exports.clock_res_get(2, 0), ERRNO_INVAL);

  const now = BigInt(Date.now()) * NANOS_PER_MILLI;
  assertEquals(module.exports.clock_time_get(CLOCK_REALTIME, 0n, 8), ERRNO_SUCCESS);
  const time = module.view.getBigUint64(8, true);
  assert(time >= now && time < now + 60_000n * NANOS_PER_MILLI, `${time} ${now}`);
  assertEquals(time % NANOS_PER_MILLI, 0n);

  assertEquals(module.exports.clock_time_get(CLOCK_MONOTONIC, 0n, 16), ERRNO_SUCCESS);
  const first = module.view.getBigUint64(16, true);
  assertEquals(module.exports.clock_time_get(CLOCK_MONOTONIC, 0n, 16), ERRNO_SUCCESS);
  assert(module.view.getBigUint64(16, true) >= first);
  assertEquals(first % NANOS_PER_MILLI, 0n);
  assertEquals(module.exports.clock_time_get(2, 0n, 16), ERRNO_INVAL);
});

Deno.test("wasi - should sleep when polling clocks", () => {
  const module = new TestModule();
  // two relative timeouts on the monotonic clock where the second is sooner
  module.writeClockSubscription(0, { userData: 1n, clockId: CLOCK_MONOTONIC, timeout: 60_000n * NANOS_PER_MILLI });
  module.writeClockSubscription(48, { userData: 2n, clockId: CLOCK_MONOTONIC, timeout: 30n * NANOS_PER_MILLI });
  const start = performance.now();
  assertEquals(module.exports.poll_oneoff(0, 200, 2, 300), ERRNO_SUCCESS);
  const elapsed = performance.now() - start;
  assert(elapsed >= 29 && elapsed < 30_000, `${elapsed}`);
  assertEquals(module.view.getUint32(300, true), 1);
  assertEquals(module.readEvent(200), { userData: 2n, errno: ERRNO_SUCCESS, eventType: 0 });

  // doesn't sleep when the events can't be written
  module.writeClockSubscription(0, { userData: 1n, clockId: CLOCK_MONOTONIC, timeout: 2n ** 64n - 1n });
  assertEquals(module.exports.poll_oneoff(0, 65530, 1, 300), ERRNO_FAULT);
  assertEquals(module.exports.poll_oneoff(0, 200, 1, 65534), ERRNO_FAULT);
  assertEquals(module.exports.poll_oneoff(65500, 200, 1, 300), ERRNO_FAULT);
  assertEquals(module.exports.poll_oneoff(0, 200, 0, 300), ERRNO_INVAL);
  assertEquals(module.exports.poll_oneoff(0, 200, -1, 300), ERRNO_INVAL);
});

Deno.test("wasi - should not wait when polling an absolute time in the past or an unknown clock", () => {
  const module = new TestModule();
  module.writeClockSubscription(0, { userData: 1n, clockId: CLOCK_REALTIME, timeout: 1n, flags: 1 });
  assertEquals(module.exports.poll_oneoff(0, 200, 1, 300), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(300, true), 1);
  assertEquals(module.readEvent(200), { userData: 1n, errno: ERRNO_SUCCESS, eventType: 0 });

  module.writeClockSubscription(0, { userData: 3n, clockId: 2, timeout: 2n ** 64n - 1n });
  assertEquals(module.exports.poll_oneoff(0, 200, 1, 300), ERRNO_SUCCESS);
  assertEquals(module.readEvent(200), { userData: 3n, errno: ERRNO_INVAL, eventType: 0 });
});

Deno.test("wasi - should always have the standard streams ready when polling", () => {
  const module = new TestModule();
  module.writeClockSubscription(0, { userData: 1n, clockId: CLOCK_MONOTONIC, timeout: 2n ** 64n - 1n });
  const subscriptions = [
    { userData: 2n, eventType: 1, fd: 0 },
    { userData: 3n, eventType: 2, fd: 1 },
    { userData: 4n, eventType: 2, fd: 3 },
    { userData: 5n, eventType: 1, fd: 1 },
  ];
  subscriptions.forEach((subscription, i) => {
    const ptr = 48 * (i + 1);
    module.bytes.fill(0, ptr, ptr + 48);
    module.view.setBigUint64(ptr, subscription.userData, true);
    module.view.setUint8(ptr + 8, subscription.eventType);
    module.view.setUint32(ptr + 16, subscription.fd, true);
  });
  assertEquals(module.exports.poll_oneoff(0, 1000, 5, 2000), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(2000, true), 4);
  assertEquals(module.readEvent(1000), { userData: 2n, errno: ERRNO_SUCCESS, eventType: 1 });
  assertEquals(module.readEvent(1032), { userData: 3n, errno: ERRNO_SUCCESS, eventType: 2 });
  assertEquals(module.readEvent(1064), { userData: 4n, errno: ERRNO_BADF, eventType: 2 });
  assertEquals(module.readEvent(1096), { userData: 5n, errno: ERRNO_BADF, eventType: 1 });

  // unknown event type
  module.view.setUint8(8, 3);
  assertEquals(module.exports.poll_oneoff(0, 1000, 1, 2000), ERRNO_INVAL);
});

Deno.test("wasi - should get random bytes", () => {
  const module = new TestModule();
  // more than can be requested from the host at one time
  assertEquals(module.exports.random_get(100, 65536 - 100), ERRNO_SUCCESS);
  assert(module.bytes.subarray(100, 200).some((b) => b !== 0));
  assert(module.bytes.subarray(65536 - 100).some((b) => b !== 0));
  assert(module.bytes.subarray(0, 100).every((b) => b === 0));
});

Deno.test("wasi - should write stdout and stderr to the host", () => {
  const module = new TestModule();
  module.writeText(100, "hello ");
  module.writeText(200, "wor\x1b[31mld\r\n\tend\0");
  module.writeIovec(0, 100, 6);
  module.writeIovec(8, 200, 17);
  assertEquals(module.exports.fd_write(1, 0, 2, 16), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(16, true), 23);
  assertEquals(module.exports.fd_write(2, 0, 1, 16), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(16, true), 6);
  // control characters other than a newline or tab are replaced
  assertEquals(module.output, ["hello wor�[31mld\n\tend�", "hello "]);

  // nothing is written for an empty write
  assertEquals(module.exports.fd_write(1, 0, 0, 16), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(16, true), 0);
  assertEquals(module.output.length, 2);

  // only the standard output streams can be written to
  for (const fd of [0, 3, 4, -1]) {
    assertEquals(module.exports.fd_write(fd, 0, 1, 16), ERRNO_BADF, `${fd}`);
  }
  assertEquals(module.exports.fd_write(1, 0, 1025, 16), ERRNO_INVAL);
  assertEquals(module.output.length, 2);
});

Deno.test("wasi - should limit the size of a write", () => {
  const module = new TestModule();
  const maxWriteBytes = 64 * 1024;
  module.bytes.fill("a".charCodeAt(0), 100, 60_100);
  module.writeIovec(0, 100, 60_000);
  module.writeIovec(8, 100, 60_000);
  module.writeIovec(16, 100, 60_000);
  assertEquals(module.exports.fd_write(1, 0, 3, 32), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(32, true), maxWriteBytes);
  assertEquals(module.output, ["a".repeat(maxWriteBytes)]);
});

Deno.test("wasi - should only have the standard streams", () => {
  const module = new TestModule();
  for (const fd of [0, 1, 2]) {
    module.bytes.fill(0xff, 0, 64);
    assertEquals(module.exports.fd_fdstat_get(fd, 0), ERRNO_SUCCESS);
    // a character device that can only be read or written
    assertEquals(module.bytes[0], 2);
    assertEquals(module.view.getBigUint64(8, true), fd === 0 ? 2n : 64n);
    assertEquals(module.view.getBigUint64(16, true), 0n);
    module.bytes.fill(0xff, 0, 64);
    assertEquals(module.exports.fd_filestat_get(fd, 0), ERRNO_SUCCESS);
    assertEquals(module.bytes[16], 2);
    assertEquals(module.view.getBigUint64(32, true), 0n);
    assertEquals(module.exports.fd_seek(fd, 0n, 0, 0), ERRNO_SPIPE);
    assertEquals(module.exports.fd_close(fd), ERRNO_SUCCESS);
  }
  for (const fd of [3, 4, -1]) {
    assertEquals(module.exports.fd_fdstat_get(fd, 0), ERRNO_BADF);
    assertEquals(module.exports.fd_filestat_get(fd, 0), ERRNO_BADF);
    assertEquals(module.exports.fd_seek(fd, 0n, 0, 0), ERRNO_BADF);
    assertEquals(module.exports.fd_close(fd), ERRNO_BADF);
    assertEquals(module.exports.fd_read(fd, 0, 1, 16), ERRNO_BADF);
    // no preopened directories
    assertEquals(module.exports.fd_prestat_get(fd, 0), ERRNO_BADF);
  }

  // stdin is always at the end of the file
  module.view.setUint32(16, 5, true);
  assertEquals(module.exports.fd_read(0, 0, 1, 16), ERRNO_SUCCESS);
  assertEquals(module.view.getUint32(16, true), 0);
  assertEquals(module.exports.fd_read(1, 0, 1, 16), ERRNO_BADF);
});

Deno.test("wasi - should have no arguments, environment variables, or file system", () => {
  const module = new TestModule();
  for (const name of ["args_sizes_get", "environ_sizes_get"]) {
    module.view.setUint32(0, 5, true);
    module.view.setUint32(4, 5, true);
    assertEquals(module.exports[name](0, 4), ERRNO_SUCCESS);
    assertEquals(module.view.getUint32(0, true), 0);
    assertEquals(module.view.getUint32(4, true), 0);
  }
  module.writeText(100, "file.txt");
  for (const fd of [0, 1, 2, 3, 4]) {
    assertEquals(module.exports.path_open(fd, 0, 100, 8, 0, 0n, 0n, 0, 200), ERRNO_BADF);
    assertEquals(module.exports.path_unlink_file(fd, 100, 8), ERRNO_BADF);
  }
  assertEquals(module.exports.sched_yield(), ERRNO_SUCCESS);
});

Deno.test("wasi - should not allow exiting", () => {
  const module = new TestModule();
  assertThrows(() => module.exports.proc_exit(1), Error, "The plugin attempted to exit with code 1.");
});

Deno.test("wasi - should fail for unsupported functions", () => {
  const module = new TestModule();
  assertEquals(module.exports.sock_send(0, 0, 0, 0, 0), ERRNO_NOSYS);
  assertEquals(module.exports.path_create_directory(3, 0, 0), ERRNO_NOSYS);
});

Deno.test("wasi - should not define unsupported functions the module doesn't import", () => {
  const imports = createWasiImports({ getMemory: () => undefined, writeOutput: () => {} });
  const names = Object.keys(imports);
  addUnsupportedWasiImports(imports, new WebAssembly.Module(testWasm));
  assertEquals(Object.keys(imports), [...names, "sock_send", "path_create_directory"]);
});

// deno-lint-ignore no-explicit-any
function instantiateWithHost(host: Host): any {
  const wasmModule = new WebAssembly.Module(testWasm);
  const instance = new WebAssembly.Instance(wasmModule, host.createImportObject(wasmModule));
  host.setInstance(instance);
  return instance.exports;
}

/** Writes "hello" followed by a newline to stdout. */
// deno-lint-ignore no-explicit-any
function writeHello(exports: any) {
  const bytes = new Uint8Array(exports.memory.buffer);
  const view = new DataView(exports.memory.buffer);
  bytes.set(new TextEncoder().encode("hello\n"), 100);
  view.setUint32(0, 100, true);
  view.setUint32(4, 6, true);
  assertEquals(exports.fd_write(1, 0, 1, 16), 0);
}

/** An instance of the test module, which has a single page of memory. */
class TestModule {
  readonly output: string[] = [];
  // deno-lint-ignore no-explicit-any
  readonly exports: any;

  constructor() {
    const wasmModule = new WebAssembly.Module(testWasm);
    const imports = createWasiImports({
      getMemory: () => this.exports?.memory,
      writeOutput: (text) => this.output.push(text),
    });
    addUnsupportedWasiImports(imports, wasmModule);
    this.exports = new WebAssembly.Instance(wasmModule, { [WASI_MODULE_NAME]: imports }).exports;
    assertEquals(this.bytes.length, MEMORY_SIZE);
  }

  get bytes() {
    return new Uint8Array(this.exports.memory.buffer);
  }

  get view() {
    return new DataView(this.exports.memory.buffer);
  }

  writeText(ptr: number, text: string) {
    this.bytes.set(new TextEncoder().encode(text), ptr);
  }

  writeIovec(ptr: number, bufPtr: number, bufLen: number) {
    this.view.setUint32(ptr, bufPtr, true);
    this.view.setUint32(ptr + 4, bufLen, true);
  }

  writeClockSubscription(ptr: number, opts: { userData: bigint; clockId: number; timeout: bigint; flags?: number }) {
    this.bytes.fill(0, ptr, ptr + 48);
    this.view.setBigUint64(ptr, opts.userData, true);
    this.view.setUint32(ptr + 16, opts.clockId, true);
    this.view.setBigUint64(ptr + 24, opts.timeout, true);
    this.view.setUint16(ptr + 40, opts.flags ?? 0, true);
  }

  readEvent(ptr: number) {
    return {
      userData: this.view.getBigUint64(ptr, true),
      errno: this.view.getUint16(ptr + 8, true),
      eventType: this.view.getUint8(ptr + 10),
    };
  }
}
