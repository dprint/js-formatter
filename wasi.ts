/** Name of the module that the WASI preview 1 functions are imported from. */
export const WASI_MODULE_NAME = "wasi_snapshot_preview1";

/** What the WASI functions need from the host. */
export interface WasiHost {
  /** Gets the memory of the plugin, which isn't available while it's being instantiated. */
  getMemory(): WebAssembly.Memory | undefined;
  /** Writes the text a plugin wrote to stdout or stderr. */
  writeOutput(text: string): void;
}

// deno-lint-ignore no-explicit-any
type WasiFunction = (...args: any[]) => number | void;

/**
 * Creates a sandboxed subset of WASI preview 1 so that plugins compiled with
 * a toolchain that needs a WASI libc (ex. .NET, Go) can be instantiated.
 *
 * This provides the same as the dprint CLI. Nothing here gives a plugin a way
 * to change anything on the host. The only things provided are the clocks,
 * sleeping, random bytes, and writing text to stdout/stderr. There are no
 * environment variables, arguments, or preopened directories, so every file
 * system function fails.
 */
export function createWasiImports(host: WasiHost): Record<string, WasiFunction> {
  const memory = new PluginMemory(host);

  return mapValues({
    // capabilities
    clock_res_get(clockId: number, resolutionPtr: number) {
      if (clockNowNanos(clockId) == null) {
        return ERRNO_INVAL;
      }
      memory.writeU64(resolutionPtr, CLOCK_RESOLUTION_NANOS);
      return ERRNO_SUCCESS;
    },
    clock_time_get(clockId: number, _precision: bigint, timePtr: number) {
      const nanos = clockNowNanos(clockId);
      if (nanos == null) {
        return ERRNO_INVAL;
      }
      memory.writeU64(timePtr, nanos);
      return ERRNO_SUCCESS;
    },
    poll_oneoff(subscriptionsPtr: number, eventsPtr: number, subscriptionsLen: number, eventsLenPtr: number) {
      const result = readSubscriptions(memory, subscriptionsPtr, subscriptionsLen);
      if (typeof result === "number") {
        return result;
      }
      // ensure the events can be written before sleeping
      memory.getBytes(eventsPtr, result.events.length * EVENT_SIZE);
      memory.getBytes(eventsLenPtr, 4);
      if (result.sleepNanos != null) {
        sleep(result.sleepNanos);
      }

      result.events.forEach((event, i) => memory.getBytes((eventsPtr >>> 0) + i * EVENT_SIZE, EVENT_SIZE).set(event));
      memory.writeU32(eventsLenPtr, result.events.length);
      return ERRNO_SUCCESS;
    },
    random_get(bufPtr: number, bufLen: number) {
      const buf = memory.getBytes(bufPtr, bufLen);
      // only this many bytes can be requested at a time
      const maxLength = 65536;
      for (let i = 0; i < buf.length; i += maxLength) {
        // the memory may be shared, which this doesn't accept
        const bytes = new Uint8Array(Math.min(maxLength, buf.length - i));
        crypto.getRandomValues(bytes);
        buf.set(bytes, i);
      }
      return ERRNO_SUCCESS;
    },
    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
      if (fd !== 1 && fd !== 2) {
        return ERRNO_BADF;
      }
      const output = readOutput(memory, iovsPtr, iovsLen);
      if (typeof output === "number") {
        return output;
      }
      memory.getBytes(nwrittenPtr, 4);
      if (output.text.length > 0) {
        host.writeOutput(output.text);
      }
      memory.writeU32(nwrittenPtr, output.written);
      return ERRNO_SUCCESS;
    },
    sched_yield: () => ERRNO_SUCCESS,
    proc_exit(code: number) {
      // exiting the process isn't allowed, so trap instead
      throw new Error(`The plugin attempted to exit with code ${code}.`);
    },

    // empty environment
    args_sizes_get: writeTwoZeros,
    args_get: () => ERRNO_SUCCESS,
    environ_sizes_get: writeTwoZeros,
    environ_get: () => ERRNO_SUCCESS,

    // standard streams
    fd_fdstat_get(fd: number, fdstatPtr: number) {
      if (!isStdStream(fd)) {
        return ERRNO_BADF;
      }
      // filetype: u8, flags: u16, rights_base: u64, rights_inheriting: u64
      const fdstat = memory.getBytes(fdstatPtr, 24);
      fdstat.fill(0);
      fdstat[0] = FILETYPE_CHARACTER_DEVICE;
      memory.writeU64((fdstatPtr >>> 0) + 8, fd === 0 ? RIGHTS_FD_READ : RIGHTS_FD_WRITE);
      return ERRNO_SUCCESS;
    },
    fd_filestat_get(fd: number, filestatPtr: number) {
      if (!isStdStream(fd)) {
        return ERRNO_BADF;
      }
      // dev: u64, ino: u64, filetype: u8, nlink: u64, size: u64, atim: u64, mtim: u64, ctim: u64
      const filestat = memory.getBytes(filestatPtr, 64);
      filestat.fill(0);
      filestat[16] = FILETYPE_CHARACTER_DEVICE;
      return ERRNO_SUCCESS;
    },
    fd_read(fd: number, _iovsPtr: number, _iovsLen: number, nreadPtr: number) {
      if (fd !== 0) {
        return ERRNO_BADF;
      }
      // stdin is always at the end of the file
      memory.writeU32(nreadPtr, 0);
      return ERRNO_SUCCESS;
    },
    fd_seek: (fd: number) => isStdStream(fd) ? ERRNO_SPIPE : ERRNO_BADF,
    fd_close: (fd: number) => isStdStream(fd) ? ERRNO_SUCCESS : ERRNO_BADF,

    // no file system. Returning "bad file descriptor" from `fd_prestat_get` tells
    // the libc that there are no preopened directories.
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_advise: () => ERRNO_BADF,
    fd_pread: () => ERRNO_BADF,
    fd_readdir: () => ERRNO_BADF,
    path_filestat_get: () => ERRNO_BADF,
    path_open: () => ERRNO_BADF,
    path_readlink: () => ERRNO_BADF,
    path_unlink_file: () => ERRNO_BADF,
  }, failOnInvalidMemoryAccess);

  function writeTwoZeros(firstPtr: number, secondPtr: number) {
    memory.writeU32(firstPtr, 0);
    memory.writeU32(secondPtr, 0);
    return ERRNO_SUCCESS;
  }
}

/**
 * Defines the WASI preview 1 functions the module imports that aren't in the
 * provided imports as functions that fail with "not implemented".
 *
 * A toolchain's runtime may import functions that a plugin never ends up
 * calling, so this allows the module to be instantiated without giving it
 * any capabilities.
 */
export function addUnsupportedWasiImports(wasiImports: Record<string, WasiFunction>, wasmModule: WebAssembly.Module) {
  for (const moduleImport of WebAssembly.Module.imports(wasmModule)) {
    if (
      moduleImport.module === WASI_MODULE_NAME && moduleImport.kind === "function"
      && !Object.hasOwn(wasiImports, moduleImport.name)
    ) {
      wasiImports[moduleImport.name] = () => ERRNO_NOSYS;
    }
  }
}

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_FAULT = 21;
const ERRNO_INVAL = 28;
const ERRNO_NOSYS = 52;
const ERRNO_SPIPE = 70;

const CLOCK_REALTIME = 0;
const CLOCK_MONOTONIC = 1;
const NANOS_PER_MILLI = 1_000_000n;
/**
 * The clocks are only precise to a millisecond in order to not hand plugins
 * a high resolution timer.
 */
const CLOCK_RESOLUTION_NANOS = NANOS_PER_MILLI;

const EVENTTYPE_CLOCK = 0;
const EVENTTYPE_FD_READ = 1;
const EVENTTYPE_FD_WRITE = 2;
const SUBCLOCKFLAGS_ABSTIME = 1;
const SUBSCRIPTION_SIZE = 48;
const EVENT_SIZE = 32;
/** Maximum number of subscriptions a plugin may provide in a single poll. */
const MAX_SUBSCRIPTIONS = 1024;

const FILETYPE_CHARACTER_DEVICE = 2;
const RIGHTS_FD_READ = 1n << 1n;
const RIGHTS_FD_WRITE = 1n << 6n;

/** Maximum number of buffers a plugin may provide in a single write. */
const MAX_IOVS = 1024;
/**
 * Maximum number of bytes written for a single write. Anything past this is
 * reported back to the plugin as not written.
 */
const MAX_WRITE_BYTES = 64 * 1024;

const decoder = new TextDecoder();
const monotonicStartMillis = performance.now();

/** Thrown when a plugin provides a pointer that's outside its memory. */
class InvalidMemoryAccessError extends Error {}

/** Bounds checked access to the memory of the plugin. */
class PluginMemory {
  readonly #host: WasiHost;

  constructor(host: WasiHost) {
    this.#host = host;
  }

  /** Gets a view of the bytes in the memory, where the pointer and length are unsigned 32 bit integers. */
  getBytes(ptr: number, length: number): Uint8Array {
    const buffer = this.#host.getMemory()?.buffer;
    const start = ptr >>> 0;
    const end = start + (length >>> 0);
    if (buffer == null || end > buffer.byteLength) {
      throw new InvalidMemoryAccessError();
    }
    return new Uint8Array(buffer, start, end - start);
  }

  readU16(ptr: number) {
    return this.#getView(ptr, 2).getUint16(0, true);
  }

  readU32(ptr: number) {
    return this.#getView(ptr, 4).getUint32(0, true);
  }

  readU64(ptr: number) {
    return this.#getView(ptr, 8).getBigUint64(0, true);
  }

  writeU32(ptr: number, value: number) {
    this.#getView(ptr, 4).setUint32(0, value, true);
  }

  writeU64(ptr: number, value: bigint) {
    this.#getView(ptr, 8).setBigUint64(0, value, true);
  }

  #getView(ptr: number, length: number) {
    const bytes = this.getBytes(ptr, length);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}

/** Makes the function fail with "bad address" when it accesses memory the plugin doesn't have. */
function failOnInvalidMemoryAccess(func: WasiFunction): WasiFunction {
  return (...args) => {
    try {
      return func(...args);
    } catch (err) {
      if (err instanceof InvalidMemoryAccessError) {
        return ERRNO_FAULT;
      }
      throw err;
    }
  };
}

function isStdStream(fd: number) {
  return fd >= 0 && fd <= 2;
}

function clockNowNanos(clockId: number): bigint | undefined {
  switch (clockId) {
    case CLOCK_REALTIME:
      return BigInt(Date.now()) * NANOS_PER_MILLI;
    case CLOCK_MONOTONIC:
      return BigInt(Math.floor(performance.now() - monotonicStartMillis)) * NANOS_PER_MILLI;
    default:
      return undefined;
  }
}

/** Blocks for the provided amount of time, which is how plugins sleep. */
function sleep(nanos: bigint) {
  const maxMillis = 2 ** 31 - 1;
  const millis = Number((nanos + NANOS_PER_MILLI - 1n) / NANOS_PER_MILLI);
  if (millis <= 0) {
    return;
  }
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(millis, maxMillis));
  } catch {
    // blocking isn't possible in this environment (ex. the main thread of
    // a browser), so act as though the time has elapsed
  }
}

interface Subscriptions {
  /** The events that occur. */
  events: Uint8Array[];
  /** How long to wait until the events occur. */
  sleepNanos: bigint | undefined;
}

/**
 * Reads the subscriptions of a poll returning the events that occur along
 * with how long to wait until they do or an error number.
 *
 * Subscriptions for reading stdin or writing to stdout/stderr are always
 * ready, so only a poll with nothing but clock subscriptions waits.
 */
function readSubscriptions(
  memory: PluginMemory,
  subscriptionsPtr: number,
  subscriptionsLen: number,
): Subscriptions | number {
  subscriptionsLen >>>= 0;
  if (subscriptionsLen === 0 || subscriptionsLen > MAX_SUBSCRIPTIONS) {
    return ERRNO_INVAL;
  }

  const readyEvents: Uint8Array[] = [];
  const timeouts: { userData: Uint8Array; timeout: bigint }[] = [];
  for (let i = 0; i < subscriptionsLen; i++) {
    // userdata: u64, type: u8, then for a clock (id: u32, timeout: u64, precision: u64, flags: u16)
    // at an offset of 16 bytes and for the others (fd: u32)
    const subscriptionPtr = (subscriptionsPtr >>> 0) + i * SUBSCRIPTION_SIZE;
    const subscription = memory.getBytes(subscriptionPtr, SUBSCRIPTION_SIZE);
    const userData = subscription.slice(0, 8);
    const eventType = subscription[8];
    const id = memory.readU32(subscriptionPtr + 16);
    if (eventType === EVENTTYPE_CLOCK) {
      const timeout = memory.readU64(subscriptionPtr + 24);
      const flags = memory.readU16(subscriptionPtr + 40);
      const now = clockNowNanos(id);
      if (now == null) {
        readyEvents.push(createEvent(userData, ERRNO_INVAL, eventType));
      } else if ((flags & SUBCLOCKFLAGS_ABSTIME) !== 0) {
        timeouts.push({ userData, timeout: timeout > now ? timeout - now : 0n });
      } else {
        timeouts.push({ userData, timeout });
      }
    } else if (eventType === EVENTTYPE_FD_READ || eventType === EVENTTYPE_FD_WRITE) {
      const isValidFd = eventType === EVENTTYPE_FD_READ ? id === 0 : id === 1 || id === 2;
      readyEvents.push(createEvent(userData, isValidFd ? ERRNO_SUCCESS : ERRNO_BADF, eventType));
    } else {
      return ERRNO_INVAL;
    }
  }

  if (readyEvents.length > 0) {
    // the clocks that don't need to wait have also occurred
    const elapsedTimeouts = timeouts.filter((t) => t.timeout === 0n);
    return {
      events: [...readyEvents, ...elapsedTimeouts.map((t) => createEvent(t.userData, ERRNO_SUCCESS, EVENTTYPE_CLOCK))],
      sleepNanos: undefined,
    };
  }
  const timeout = timeouts.reduce((min, t) => t.timeout < min ? t.timeout : min, timeouts[0].timeout);
  return {
    events: timeouts
      .filter((t) => t.timeout === timeout)
      .map((t) => createEvent(t.userData, ERRNO_SUCCESS, EVENTTYPE_CLOCK)),
    sleepNanos: timeout,
  };
}

function createEvent(userData: Uint8Array, errno: number, eventType: number) {
  // userdata: u64, error: u16, type: u8, fd_readwrite: (nbytes: u64, flags: u16)
  const event = new Uint8Array(EVENT_SIZE);
  event.set(userData, 0);
  new DataView(event.buffer).setUint16(8, errno, true);
  event[10] = eventType;
  return event;
}

/**
 * Reads the text of a write along with the number of bytes that were
 * consumed from the provided buffers or an error number.
 */
function readOutput(
  memory: PluginMemory,
  iovsPtr: number,
  iovsLen: number,
): { text: string; written: number } | number {
  iovsLen >>>= 0;
  if (iovsLen > MAX_IOVS) {
    return ERRNO_INVAL;
  }

  const bytes = new Uint8Array(MAX_WRITE_BYTES);
  let written = 0;
  for (let i = 0; i < iovsLen && written < MAX_WRITE_BYTES; i++) {
    const iovecPtr = (iovsPtr >>> 0) + i * 8;
    const buf = memory.getBytes(memory.readU32(iovecPtr), memory.readU32(iovecPtr + 4));
    const length = Math.min(buf.length, MAX_WRITE_BYTES - written);
    bytes.set(buf.subarray(0, length), written);
    written += length;
  }
  return { text: sanitizeOutput(bytes.subarray(0, written)), written };
}

/**
 * Replaces the control characters in a plugin's output so that a plugin
 * can't send escape sequences to the terminal.
 */
function sanitizeOutput(bytes: Uint8Array) {
  return decoder.decode(bytes)
    .replaceAll("\r", "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "�");
}

function mapValues<T, R>(object: Record<string, T>, map: (value: T) => R): Record<string, R> {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, map(value)]));
}
