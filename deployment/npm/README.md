# @dprint/formatter

[![CI](https://github.com/dprint/js-formatter/workflows/CI/badge.svg)](https://github.com/dprint/js-formatter/actions?query=workflow%3ACI)
[![npm version](https://badge.fury.io/js/%40dprint%2Fformatter.svg)](https://badge.fury.io/js/%40dprint%2Fformatter)
[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/dprint/mod.ts)

JS formatter for dprint Wasm plugins.

```ts
import { createFromBuffer } from "@dprint/formatter";

const formatter = createFromBuffer(fs.readFileSync("./json.wasm"));

console.log(formatter.formatText("test.json", "{test: 5}"));
```

## Plugins

- [@dprint/json](https://www.npmjs.com/package/@dprint/json)
- [@dprint/typescript](https://www.npmjs.com/package/@dprint/typescript)
- [@dprint/markdown](https://www.npmjs.com/package/@dprint/markdown)
- [@dprint/toml](https://www.npmjs.com/package/@dprint/toml)
- [@dprint/dockerfile](https://www.npmjs.com/package/@dprint/dockerfile)
