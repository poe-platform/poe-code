# Tokenfill tokenizer truncate corrupts Unicode and misses requested token count

## Summary

The exported `tokenfill` tokenizer utility claims and tests that `truncate(text, tokenCount)` truncates text to an exact token count, but it decodes an arbitrary prefix of token bytes with a default `TextDecoder`. When the token prefix terminates inside the UTF-8 bytes of a Unicode grapheme, the method emits a replacement character and the returned string no longer re-encodes to the requested number of tokens. For the family emoji string, truncating to two `cl100k_base` tokens returns `�`, which counts as only one token.

## Reproduction

From the repository root, run a disposable Vitest probe that tests a small set of Unicode inputs and stops on the first truncated output whose re-encoded token count differs from the requested count:

```sh
cat > packages/tokenfill/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { createTokenizer } from "./tokenizer.js";

describe("tokenizer Unicode truncation", () => {
  it("does not always return text that re-encodes to the requested token count", () => {
    const tokenizer = createTokenizer();
    try {
      const samples = ["😀", "👨‍👩‍👧‍👦", "今天天气很好，我们去公园散步吧。", "éclair", "café ☕"];
      let mismatch: { sample: string; requested: number; truncated: string; recounted: number } | undefined;
      for (const sample of samples) {
        for (let requested = 1; requested < tokenizer.count(sample); requested += 1) {
          const truncated = tokenizer.truncate(sample, requested);
          const recounted = tokenizer.count(truncated);
          if (recounted !== requested) {
            mismatch = { sample, requested, truncated, recounted };
            break;
          }
        }
        if (mismatch) break;
      }
      console.log(JSON.stringify(mismatch));
      expect(mismatch).toBeDefined();
    } finally {
      tokenizer.free();
    }
  });
});
EOF
trap 'rm -f packages/tokenfill/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tokenfill/src/__probe__.test.ts --reporter verbose
nl -ba packages/tokenfill/src/tokenizer.ts
nl -ba packages/tokenfill/src/corpus-tokenizer.test.ts | sed -n '45,78p'
nl -ba packages/tokenfill/README.md | sed -n '1,7p;75,93p'
```

## Observed Behavior

The first reproduced Unicode boundary yields a replacement character and a one-token output from a requested two-token truncation:

```text
{"sample":"👨‍👩‍👧‍👦","requested":2,"truncated":"�","recounted":1}
✓ packages/tokenfill/src/__probe__.test.ts > tokenizer Unicode truncation > does not always return text that re-encodes to the requested token count
```

`createTokenizer()` instantiates a default `TextDecoder` and implements `truncate()` as `decode(tokens.slice(0, tokenCount))` in `packages/tokenfill/src/tokenizer.ts:18` through `packages/tokenfill/src/tokenizer.ts:52`. A partial token prefix can decode to Unicode replacement output rather than a valid prefix of the source text. The package's existing test explicitly describes truncation as exact and checks re-encoding equality for an ASCII input in `packages/tokenfill/src/corpus-tokenizer.test.ts:70` through `packages/tokenfill/src/corpus-tokenizer.test.ts:76`, while the public README introduces the package as generating exact token counts and exposes `truncate()` in `packages/tokenfill/README.md:1` through `packages/tokenfill/README.md:7` and `packages/tokenfill/README.md:75` through `packages/tokenfill/README.md:93`.

## Expected Behavior

`truncate(text, tokenCount)` should return valid text whose re-encoded token count equals the requested count whenever the input contains at least that many tokens, or clearly document and signal that arbitrary Unicode token prefixes cannot be decoded without loss. It should not silently replace part of the original Unicode text and report an inexact result through an API tested as exact.

## Impact

SDK callers truncating multilingual text, emoji-rich prompts, or copied terminal output can receive corrupted replacement characters and fewer tokens than requested. This breaks deterministic prompt sizing assumptions, damages user-visible content, and can cause higher-level token budgeting logic to allocate space inaccurately while believing truncation was exact.
