# Design system terminal ACP inherited tool kind erases event content

## Summary

The public `@poe-code/design-system` ACP terminal renderers treat a tool kind such as `"toString"` as a color-rendering function inherited from `Object.prototype` rather than as an ordinary unrecognized kind. As a result, both tool start and completion events render as `[object Undefined]`, losing the supplied kind and start-event title entirely.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/acp/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withOutputFormat } from "../internal/output-format.js";
import { renderToolComplete, renderToolStart } from "./components.js";
import { withAcpWriter } from "./writer.js";

describe("ACP inherited tool kind names", () => {
  it("renders Object prototype methods instead of the supplied tool kind", async () => {
    const lines: string[] = [];

    await withAcpWriter((line) => lines.push(line), async () => {
      withOutputFormat("terminal", () => {
        renderToolStart("toString", "read config");
        renderToolComplete("toString");
      });
    });

    expect(lines).toEqual(["[object Undefined]", "[object Undefined]"]);
    expect(lines.join("\n")).not.toContain("toString");
    expect(lines.join("\n")).not.toContain("read config");
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/acp/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/acp/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/acp/__probe__.test.ts > ACP inherited tool kind names > renders Object prototype methods instead of the supplied tool kind
```

## Observed Behavior

Calling `renderToolStart("toString", "read config")` and `renderToolComplete("toString")` under terminal output produces two lines equal to `[object Undefined]`. The output does not contain either the accepted tool kind `toString` or the title `read config`.

`packages/design-system/src/index.ts:27` exposes the ACP namespace, and `packages/design-system/src/acp/index.ts:1` through `packages/design-system/src/acp/index.ts:8` export the affected renderers. In `packages/design-system/src/acp/components.ts:12` through `packages/design-system/src/acp/components.ts:23`, `KIND_COLORS` is an ordinary object and `colorForKind()` reads `KIND_COLORS[kind]` without checking whether the property is owned. For `kind === "toString"`, this yields inherited `Object.prototype.toString`; the terminal paths at `packages/design-system/src/acp/components.ts:59` through `packages/design-system/src/acp/components.ts:90` then invoke it as the formatter instead of falling back to dim styling. Called as a detached function in strict module code, it stringifies `undefined` and discards the intended event line.

## Expected Behavior

Unknown ACP tool kinds, including names colliding with inherited object properties, should render through the normal fallback styling while preserving the event kind and title. A valid event must not lose its user-visible contents because its kind matches an inherited JavaScript property name.

## Impact

Agents or tools using a legitimate custom kind such as `toString` can emit terminal progress records that contain no description of the operation performed. This corrupts interactive audit output and screenshots while JSON and Markdown render modes continue to expose the original event data, creating format-dependent loss of observability.
