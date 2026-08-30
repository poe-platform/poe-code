# Opt-in historical source audit

`preserved-source.test.ts` is renamed byte-for-byte to
`preserved-source.audit.ts`. Its two checks pin historical implementation bytes;
they are not reusable current behavioral coverage. No assertions, source files,
historical expected data, captures or previous reports are changed.

Run explicitly only in an isolated historical reproduction with column sources
from immutable commit `a809635432f18a235b8fb622a05367bedc54b315`, source tree
`8b32998383d1372a8624ac41d2e747551e5b6d4c`. Preserve the repository-relative layout
and the audit's sibling `preserved-source.json`:

```sh
node --import tsx --test tests/commands/column/padding-evolution/preserved-source.audit.ts
```

This command is an opt-in historical audit, not default canonical or current
module acceptance. Do not restore live source or overlay live product inputs
onto a frozen reproduction to make these pins pass. The author did not execute
this historical invocation; a different worker verifies it independently.

The inspected `package.json` test command discovers `tests/**/*.test.ts`, with
its existing exact native-data exclusion unchanged. Therefore only the old
test path leaves default discovery; the new `.audit.ts` path is not selected.
No compiler glob, exclusion, package script or behavioral test changes occur.
Historical results retain their original path and meaning in immutable history.
Foreign live file-content updates are not changes in discovery membership.

`receipt.json` records the byte hashes and the before/after discovery inventory
digests. These inventory checks do not execute tests, build, replay a module or
constitute a gate. Independent verification follows the author commit.
