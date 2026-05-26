# Toolcraft schema union plus key collides with two required keys

## Summary

The exported `toolcraft-schema` `S.Union()` constructor rejects valid distinguishable object branches when a required property name contains `+`. A branch requiring the single key `"a+b"` is treated as identical to a branch requiring the two keys `"a"` and `"b"`, because both are flattened into the same separator-delimited fingerprint.

## Reproduction

Create the disposable probe `packages/toolcraft-schema/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { S, validate } from "./index.js";

describe("union required-key fingerprint separator collision", () => {
  it("rejects distinguishable branches when one property name includes plus", () => {
    expect(() =>
      S.Union([
        S.Object({
          "a+b": S.String()
        }),
        S.Object({
          a: S.String(),
          b: S.String()
        })
      ])
    ).toThrow('share required-key fingerprint "a+b"');

    const first = validate(S.Object({ "a+b": S.String() }), { "a+b": "one" });
    const second = validate(S.Object({ a: S.String(), b: S.String() }), { a: "one", b: "two" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft-schema/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-schema/src/__probe__.test.ts
```

## Observed Behavior

The probe passes:

```text
✓ packages/toolcraft-schema/src/__probe__.test.ts > union required-key fingerprint separator collision > rejects distinguishable branches when one property name includes plus
```

Each object branch validates successfully on its own, but composing them with `S.Union()` throws `Union branches [0, 1] share required-key fingerprint "a+b"`. `getRequiredKeyFingerprint()` sorts a branch's required keys and joins them with `+` at `packages/toolcraft-schema/src/union.ts:14` through `packages/toolcraft-schema/src/union.ts:22`; `assertUniqueRequiredKeyFingerprints()` then rejects any equal string at `packages/toolcraft-schema/src/union.ts:24` through `packages/toolcraft-schema/src/union.ts:49`. As a result, the key sets `["a+b"]` and `["a", "b"]` collide even though `walkUnion()` could distinguish values by checking each literal required key at `packages/toolcraft-schema/src/validate.ts:352` through `packages/toolcraft-schema/src/validate.ts:411`.

## Expected Behavior

`S.Union()` should distinguish required-key sets structurally rather than with an ambiguous delimiter join. Object branches using valid property names containing `+` should be constructible when their literal required-key sets differ.

## Impact

Schema authors cannot express otherwise valid union inputs for APIs whose payload keys contain `+`, including externally defined JSON fields or encoded query-style names. The failure occurs at schema construction time, preventing tool registration or request validation even though the candidate input shapes are unambiguous.
