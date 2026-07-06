# tokenfill

Generate deterministic filler text with exact token counts.

`tokenfill` is available as:

- A CLI: `tokenfill <count>`
- A library: `tokenfill(count, options)`
- A tokenizer utility wrapper: `createTokenizer(options)`

## Install

```bash
npm install tokenfill
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

## Token Estimation

```ts
import { estimateTokens } from "tokenfill";

const tokens = estimateTokens(largeText);
```

`estimateTokens` counts exactly (default encoding) for texts up to 8 192 characters and extrapolates from head/middle/tail samples above that, so it stays fast on multi-megabyte inputs.

## Notes

- Output is deterministic for the same token count and encoding.
- Requests larger than the built-in corpus size throw an error.

## Configuration Options

- CLI: `--json`, `--tokenizer <encoding>`.
- Library: `tokenfill(count, { encoding? })`.
- Tokenizer utility: `createTokenizer({ encoding })`.

## Environment Variables

This package does not read public environment variables.
