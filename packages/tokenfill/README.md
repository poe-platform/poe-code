# tokenfill

Generate deterministic filler text with exact token counts.

`tokenfill` is available as:

- A CLI: `tokenfill <count>`
- A library: `tokenfill(count, options)`
- A tokenizer utility wrapper: `createTokenizer(options)`

## Install

```bash
bun add tokenfill
```

Run with `npx`:

```bash
npx tokenfill 256
```

## CLI

```bash
tokenfill <count> [--json] [--tokenizer <encoding>]
```

Examples:

```bash
tokenfill 512 > sample.txt
tokenfill 128 --json
tokenfill 256 --tokenizer o200k_base --json
```

Behavior:

- `<count>` must be a non-negative integer.
- Default tokenizer encoding is `cl100k_base`.
- Without `--json`, generated text is written to `stdout` and stats to `stderr`.
- With `--json`, output is:

```json
{
  "text": "…",
  "stats": {
    "requestedTokens": 128,
    "actualTokens": 128,
    "encoding": "cl100k_base"
  }
}
```

## Library Usage

```ts
import { tokenfill } from "tokenfill";

const result = tokenfill(1024);

console.log(result.actualTokens); // 1024
console.log(result.text.length > 0); // true
```

With an explicit encoding:

```ts
import { tokenfill } from "tokenfill";

const result = tokenfill(256, { encoding: "o200k_base" });
```

## Tokenizer Utility

```ts
import { createTokenizer } from "tokenfill";

const tokenizer = createTokenizer({ encoding: "cl100k_base" });

const tokens = tokenizer.encode("hello world");
const text = tokenizer.decode(tokens);
const count = tokenizer.count(text);
const truncated = tokenizer.truncate(text, 1);

tokenizer.free();
```

## Notes

- Output is deterministic for the same token count and encoding.
- Requests larger than the built-in corpus size throw an error.
