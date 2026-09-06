---
title: Raw JSON values
---

## Validated gap

Eight initial cases failed because JSON.rawJSON and JSON.isRawJSON were missing.
Three later direct tests showed that plain object serialization, replay data and
sandbox copying do not preserve the raw JSON brand.

## Implementation

Validate JSON text, reject surrounding whitespace and non-primitive values, and
create a frozen null-prototype object with an unforgeable raw JSON brand.
Stringify emits its original text after toJSON/replacer processing. Add an
explicit, validated raw-json record to guest heaps and replay data; preserve
alias identity and the brand when restoring and copying trusted raw values.
No native rawJSON implementation is required, including on Node 18.

Normative reference:
[JSON.rawJSON](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.rawjson).

## Verification

- 37 raw JSON cases cover exact source text, malformed input, coercion, forgery,
  descriptors, mutation rejection, replacers, toJSON, checkpoints, direct heap
  restoration, replay data and copied values.
- Focused legacy checkpoint checks pass with explicit JSON method additions:
  81 passed and 1 skipped across the three files. Captured fixtures are untouched.
- Run maintained package tests, scoped lint/types and the selected build.
- Maintained package tests pass: 16,003 passed, 41 skipped. Scoped ESLint and
  TypeScript checks pass.
- Run this CLI harness and inspect its screenshot before committing and pushing.
- Selected workspace build passes. The real CLI harness passes with zero spawns;
  its screenshot was inspected.

## Further validated gaps

- String.fromCharCode and String.fromCodePoint throw TypeError for a guest object
  whose valueOf returns 65, instead of producing A. Their factories currently
  pass guest objects directly to native coercion.
- JSON.rawJSON.name, JSON.isRawJSON.name and JSON.parse.name evaluate to undefined.
  JSON method metadata needs a separate review of the shared function model,
  including descriptor mutation and checkpoint identity.
