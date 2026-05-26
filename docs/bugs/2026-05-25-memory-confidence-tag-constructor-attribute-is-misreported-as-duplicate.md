# Memory Confidence Tag `constructor` Attribute Is Misreported as Duplicate

## Summary

The exported `@poe-code/memory` `parseClaims()` API misclassifies a single unsupported confidence-tag attribute named `constructor` as a duplicated attribute. Other unsupported attributes reach the normal validation error, but this legal identifier reads the inherited `Object.prototype.constructor` value from the parser's temporary attribute map before it has been assigned.

## Reproduction

Create a disposable Vitest probe at `packages/memory/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseClaims } from "./confidence.js";

describe("memory confidence tag inherited constructor attribute repro", () => {
  it("reports one constructor attribute as duplicated instead of unsupported", () => {
    const body = [
      "<!-- memory:ambiguous reason=uncertain constructor=visible -->",
      "Claim body"
    ].join("\n");

    expect(() => parseClaims("<!-- memory:ambiguous reason=uncertain owner=visible -->\nClaim body"))
      .toThrow('ambiguous confidence tags do not support: "owner"');
    expect(() => parseClaims(body)).toThrow('Duplicate confidence tag attribute "constructor"');
  });
});
```

Run:

```sh
npm exec -- vitest run packages/memory/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a tag containing only one `constructor` attribute receives a false duplicate-attribute diagnostic. Remove the disposable probe after validation.

## Observed Behavior

Parsing `<!-- memory:ambiguous reason=uncertain owner=visible -->` rejects the unsupported `owner` attribute with the expected “do not support” message. Parsing the equivalent tag with one `constructor=visible` attribute instead throws `Duplicate confidence tag attribute "constructor"`. In `packages/memory/src/confidence.ts`, `parseAttributes()` creates `attrs = {}` and performs duplicate detection with `if (attrs[key] !== undefined)` before assignment. For `key === "constructor"`, the inherited constructor function is already non-undefined, so parsing incorrectly treats the first occurrence as a duplicate and never reaches unsupported-key validation.

## Expected Behavior

Confidence-tag attribute validation should treat only own previously parsed attributes as duplicates. A single unsupported `constructor` attribute should be rejected in the same way as any other unsupported identifier rather than reported as duplicate input.

## Impact

Memory documents containing this unsupported attribute produce a misleading parse error, which impairs diagnosis and automated remediation of malformed memory pages. Consumers cannot reliably distinguish actual duplicate attributes from unsupported field names using the public parser's reported error.
