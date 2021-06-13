# dprint - JS Formatter

JS formatter for dprint Wasm plugins.

## Deno

```ts
import {
  createStreaming,
  GlobalConfiguration,
} from "https://deno.land/x/dprint@x.x.x/mod.ts";

const globalConfig: GlobalConfiguration = {
  indentWidth: 2,
  lineWidth: 80,
};
const tsFormatter = await createStreaming(
  // check https://plugins.dprint.dev/ for latest plugin versions
  fetch("https://plugins.dprint.dev/typescript-0.46.0.wasm"),
);

tsFormatter.setConfig(globalConfig, {
  semiColons: "asi",
});

// outputs: "const t = 5\n"
console.log(tsFormatter.formatText("file.ts", "const   t    = 5;"));
```

## Node.js

```ts
import { createFromBuffer } from "@dprint/wasm-formatter";

const formatter = createFromBuffer(fs.readFileSync("./json.wasm"));

console.log(formatter.formatText("test.json", "{test: 5}"));
```
