# dprint - JS Formatter

[![CI](https://github.com/dprint/js-formatter/workflows/CI/badge.svg)](https://github.com/dprint/js-formatter/actions?query=workflow%3ACI)
[![npm version](https://badge.fury.io/js/%40dprint%2Fformatter.svg)](https://badge.fury.io/js/%40dprint%2Fformatter)
[![deno doc](https://doc.deno.land/badge.svg)](https://doc.deno.land/https/deno.land/x/dprint/mod.ts)

JS formatter for dprint Wasm plugins.

## Deno

```ts
import {
  createStreaming,
  GlobalConfiguration,
} from "https://deno.land/x/dprint/mod.ts";

const globalConfig: GlobalConfiguration = {
  indentWidth: 2,
  lineWidth: 80,
};
const tsFormatter = await createStreaming(
  // check https://plugins.dprint.dev/ for latest plugin versions
  fetch("https://plugins.dprint.dev/typescript-0.57.0.wasm"),
);

tsFormatter.setConfig(globalConfig, {
  semiColons: "asi",
});

// outputs: "const t = 5\n"
console.log(tsFormatter.formatText("file.ts", "const   t    = 5;"));
```

## Node.js

```ts
import { createFromBuffer } from "@dprint/formatter";
import { getBuffer } from "@dprint/json";

// or provide something like fs.readFileSync("./json.wasm")
const formatter = createFromBuffer(getBuffer());

console.log(formatter.formatText("test.json", "{test: 5}"));
```

### Plugin NPM Packages

- [@dprint/json](https://www.npmjs.com/package/@dprint/json)
- [@dprint/typescript](https://www.npmjs.com/package/@dprint/typescript)
- [@dprint/markdown](https://www.npmjs.com/package/@dprint/markdown)
- [@dprint/toml](https://www.npmjs.com/package/@dprint/toml)
- [@dprint/dockerfile](https://www.npmjs.com/package/@dprint/dockerfile)
