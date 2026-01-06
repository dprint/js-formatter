# dprint - JS Formatter

[![CI](https://github.com/dprint/js-formatter/workflows/CI/badge.svg)](https://github.com/dprint/js-formatter/actions?query=workflow%3ACI)
[![npm version](https://badge.fury.io/js/%40dprint%2Fformatter.svg)](https://badge.fury.io/js/%40dprint%2Fformatter)
[![JSR](https://jsr.io/badges/@dprint/formatter)](https://jsr.io/@dprint/formatter)

JS formatter for dprint Wasm plugins.

## Setup

Deno:

```sh
deno add npm:@dprint/formatter
```

Node.js:

```sh
npm i @dprint/formatter
```

### Use

The context API allows you to manage multiple plugins with shared configuration and automatic plugin selection based on file type:

```ts
import { createContext } from "@dprint/formatter";
import * as json from "@dprint/json";
import * as typescript from "@dprint/typescript";
import fs from "node:fs";

const context = createContext({
  // global config
  indentWidth: 2,
  lineWidth: 80,
});
// note: some plugins might have a getBuffer() export instead
context.addPlugin(fs.readFileSync(typescript.getPath()), {
  semiColons: "asi",
});
context.addPlugin(fs.readFileSync(json.getPath()));

console.log(context.formatText({
  filePath: "config.json",
  fileText: "{\"a\":1}",
}));

console.log(context.formatText({
  filePath: "app.ts",
  fileText: "const x=1",
}));
```

The context also handles host formatting automatically, so embedded code blocks (like JSON in Markdown) will be formatted by the appropriate plugin.

### Plugin NPM Packages

Note: In the future I will ensure plugins are published to JSR as well.

- [@dprint/json](https://www.npmjs.com/package/@dprint/json)
- [@dprint/typescript](https://www.npmjs.com/package/@dprint/typescript)
- [@dprint/markdown](https://www.npmjs.com/package/@dprint/markdown)
- [@dprint/toml](https://www.npmjs.com/package/@dprint/toml)
- [@dprint/dockerfile](https://www.npmjs.com/package/@dprint/dockerfile)
- [@dprint/biome](https://www.npmjs.com/package/@dprint/biome)
- [@dprint/oxc](https://www.npmjs.com/package/@dprint/oxc)
- [@dprint/mago](https://www.npmjs.com/package/@dprint/mago)
- [@dprint/ruff](https://www.npmjs.com/package/@dprint/ruff)
