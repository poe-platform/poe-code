# Live collection/value continuation evidence

Scope: `sdk-collections-values` only. The earlier enum/helper increment in
[collections-values.md](collections-values.md) remains valid. Its missing-owner
findings describe the historical graph; task 28 supplied the live types now
qualified here. No later task or whole source-test adaptation is promoted.
The [owned plan](../plans/docx-collections-values-continuation-20260921.md)
contains the agent QA procedure and delivery ownership.

## Relationship defaults

Original `relationship-default-owner.test.ts` reproduced `get` returning a
foreign default without validation. Defaults now require null or a live
relationship from the same package; removed handles reject. `pop` uses the same
admission rule while retaining missing-key versus explicit-null behavior.
Arbitrary scalar false/zero/string defaults reject as typed input, rather than
silently collapsing into absence. This is the exact existing security mapping
in public API register rows `docx.opc.rel.Relationships.get` and `.pop`, not a new
general JavaScript dictionary contract.

Original memfs CLI acceptance uses the existing typed batch operations and
SDK-backed engine. A removed default yields `stale-selection`, exit 1, one JSON
failure envelope, null data, affected 0 and unchanged input. Typed input failures
remain usage/exit 2. Nullable missing lookup remains null; missing pop without a
default throws MissingKeyError. No ambient I/O or external-target following.

Verification before the local relationship correction commit:

- `npm test --workspace=docx -- --maxWorkers=1 -t relationship`: exit 0,
  42 files / 127 matching cases passed; 4,907 cases skipped by the explicit
  filter. Skipped cases are not claimed as passes.
- `npm run lint --workspace=docx`: exit 0, ESLint and source/test TypeScript;
  one existing unused-type-variable warning in `operation-types.test.ts`.
- Focused original/default plus existing package-view cases: 13 passed.
  The added stale-default CLI case then passed with its direct counterpart.

The early accidental complete-package invocation during red authoring was
cancelled with 130 and is not verification. Initial undocumented row/shape
equality assumptions were test-authoring mistakes and corrected before the
qualified two-defect red run (two failures, three passes). No timeout increase.

No README, ignored fixture, native runtime, corpus download, push or release.
