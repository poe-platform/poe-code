# JSON serialization after removing a Date hook

## Validated defect

Before the repair, five independent native-comparison cases produced three
guest failures (38cfb7). Deleting `Date.prototype.toJSON` still serialized a
Date as an ISO string, ignoring its enumerable `extra` property. Replacing
the Date's prototype with null or an ordinary object instead threw during
unrequested date conversion. An own undefined hook and an inherited callable
replacement were passing controls. Native comparisons use fresh VM contexts
so deleting a native intrinsic cannot contaminate other tests.

[SerializeJSONProperty](https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonproperty)
reads `toJSON` from the value and invokes it only when callable. It does not
apply a separate Date conversion when the property is absent.

## Repair

Remove the Date-only absent-hook fallback from `console-json.ts`. Dates now
follow the same guest property lookup and callable-hook path as other objects.
This also avoids a preliminary descriptor lookup before inherited Proxy hooks.
No new conversion path or special-case representation is introduced.

## Verification

- Focused JSON and Date selection: 305 tests across 15 files passed (48286b).
- Expanded regression: eight cases passed (ece7d7), including an inherited
  Proxy hook and pending/completed JSON checkpoint restoration.
- Runtime and initial regression ESLint passed (feb535).
- Expanded regression ESLint passed (5636c9); whitespace validation passed.
- Package TypeScript no-emit check passed (77e91c).
- README updated; this has no visual CLI change.

The full-package gate has not been rerun for this change. Its previous 14
failures concern ISO formatting and host Promise admission, not this newly
validated issue. This repair is local only under the release hold.
