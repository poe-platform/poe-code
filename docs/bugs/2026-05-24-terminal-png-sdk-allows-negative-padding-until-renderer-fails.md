# Terminal PNG SDK allows negative padding until renderer fails

## Summary

The `terminal-png` CLI rejects negative `--padding` values as invalid input, but the public `renderTerminalPng()` SDK accepts the same negative numeric option without validation. It constructs SVG output with negative dimensions and fails only inside the PNG renderer with a lower-level invalid-size error.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { renderTerminalPng } from "./index.js";
import { renderSvg } from "./svg-renderer.js";
import { parseAnsi } from "./ansi-parser.js";

describe("public padding validation", () => {
  it("passes negative SDK padding through to invalid image geometry", async () => {
    const svg = renderSvg(parseAnsi("x"), { padding: -100, window: false });
    const geometry = svg.match(/width="([^"]+)" height="([^"]+)"/)?.slice(1);
    let error = "";
    try {
      await renderTerminalPng("x", { padding: -100, window: false });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    console.log(JSON.stringify({ geometry, error }));
    expect(geometry).toEqual(["-191.59", "-171.60"]);
    expect(error).toBe("SVG has an invalid size");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"geometry":["-191.59","-171.60"],"error":"SVG has an invalid size"}
✓ packages/terminal-png/src/__probe__.test.ts > public padding validation > passes negative SDK padding through to invalid image geometry
```

## Observed Behavior

The CLI enforces a non-negative integer padding constraint in `packages/terminal-png/src/cli.ts:19` through `packages/terminal-png/src/cli.ts:27`, and its tests assert that `--padding -1` is rejected in `packages/terminal-png/src/cli.test.ts`. In contrast, the exported SDK function in `packages/terminal-png/src/index.ts` forwards `options.padding` directly to `renderSvg()`. `renderSvg()` uses the value in its width and height arithmetic in `packages/terminal-png/src/svg-renderer.ts:78` through `packages/terminal-png/src/svg-renderer.ts:103`, creating dimensions such as `-191.59` by `-171.60` before `renderPng()` throws `SVG has an invalid size`.

## Expected Behavior

Public SDK and MCP callers should receive the same padding validation guarantee as CLI callers. `renderTerminalPng()` should reject negative or otherwise invalid padding at its input boundary with a clear validation error, before generating invalid SVG geometry or invoking the rasterizer.

## Impact

Consumers using the documented SDK API, and MCP requests forwarded through it, can provide values that the CLI declares invalid and receive implementation-specific rendering failures instead of stable input errors. This breaks interface parity and turns routine invalid input into downstream rendering faults that are harder to diagnose and handle consistently.
