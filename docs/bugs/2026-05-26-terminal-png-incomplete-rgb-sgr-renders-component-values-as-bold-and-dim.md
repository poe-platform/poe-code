---
name: "Terminal PNG incomplete RGB SGR renders component values as bold and dim"
---

# Terminal PNG incomplete RGB SGR renders component values as bold and dim

## Summary

`terminal-png` misinterprets an incomplete semicolon-form ANSI truecolor sequence as unrelated styling instructions. Input containing `CSI 38;2;1;2 m` lacks the required blue component and therefore cannot represent an RGB foreground color, but the renderer applies SGR `1` and `2` from the unfinished color payload as bold and dim styling to subsequent text.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("incomplete ANSI RGB color", () => {
  it("interprets RGB component bytes as standalone styles after an incomplete color", () => {
    const runs = parseAnsi("\u001b[38;2;1;2mX");
    const svg = renderSvg(runs, { window: false, padding: 0 });
    console.log(JSON.stringify({
      runs,
      svgHasBold: svg.includes('font-weight="bold"'),
      svgHasDim: svg.includes('opacity="0.7"')
    }));

    expect(runs[0]).toMatchObject({ text: "X", bold: true, dim: true, fg: null });
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('opacity="0.7"');
  });
});
EOF
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"runs":[{"text":"X","fg":null,"bg":null,"bold":true,"italic":false,"underline":false,"strikethrough":false,"dim":true}],"svgHasBold":true,"svgHasDim":true}
```

## Observed Behavior

The invalid/incomplete foreground-color input `\u001b[38;2;1;2mX` produces a styled text run with no foreground color but with `bold: true` and `dim: true`. The resulting SVG includes both `font-weight="bold"` and `opacity="0.7"`, visibly altering `X` even though the input attempted only to declare a color.

`applyExtendedColor()` in `packages/terminal-png/src/ansi-parser.ts:141` returns `null` for RGB mode `2` when any of the three channel values is absent. In `applySgr()` at `packages/terminal-png/src/ansi-parser.ts:189`, processing then continues through the same parameter array because the failed extended-color branch at `packages/terminal-png/src/ansi-parser.ts:273` does not consume or reject the incomplete payload. The following values `1` and `2` are consequently handled as SGR bold and dim commands at `packages/terminal-png/src/ansi-parser.ts:197` and `packages/terminal-png/src/ansi-parser.ts:202`. `renderRun()` faithfully exposes those accidentally parsed states as SVG attributes at `packages/terminal-png/src/svg-renderer.ts:208` and `packages/terminal-png/src/svg-renderer.ts:228`.

## Expected Behavior

An incomplete extended-color SGR instruction should be ignored as a malformed color sequence or otherwise rejected consistently; its channel payload must not be reinterpreted as separate style controls. `CSI 38;2;1;2 m` should not turn following output bold or dim.

## Impact

Generated terminal screenshots can falsely highlight, fade, underline, or otherwise style adjacent text when upstream programs emit a truncated or malformed color escape sequence. This makes visual captures misleading during diagnostics and UI reviews: malformed color output can masquerade as emphasis or severity styling that was never present in the source terminal intent.
