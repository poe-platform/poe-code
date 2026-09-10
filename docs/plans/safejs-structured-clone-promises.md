# Reject Promise values in SDK structured cloning

## Validated gap

`cloneSandboxValue(value, { structuredClone: true })` accepted guest, native
host and foreign-realm native Promise values. Three regression cases failed
before implementation (177ccf); native structuredClone rejects the corresponding
native promises with DataCloneError. The ordinary-copy identity control passed.
The interpreter's guest structured serializer already rejects guest Promises,
so the SDK path had inconsistent admission behavior.

Reject native-branded and guest promises before property reads or assimilation
when structured cloning is requested. Keep ordinary copying and settlement-only
host imports unchanged. Tests cover direct values, nested records and arrays,
and verify no constructor getter reads. No public Promise property-admission
policy change is included.

## Verification

- Node 22: 87 tests passed across Promise cloning/import, ordinary value copying,
  error cloning and transfer regressions.
- Node 18.18.2: eight Promise cloning/import tests passed.
- Package TypeScript no-emit check passed.
- Focused ESLint passed for values.ts and the new regression file.

Only the two-line Promise guard, its tests and this plan belong in the commit.
Other uncommitted Temporal/weak changes in values.ts remain outside it. These
working-tree focused checks do not replace the failing full integration gate.
No CLI appearance changes. Local commit only under the release hold; no push,
release or issue closure. Unrelated staged changes are preserved.
