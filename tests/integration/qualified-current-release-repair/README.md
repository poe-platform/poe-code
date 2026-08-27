# Release runtime coverage repair — August 27, 2026

## Exact candidate for root's decision

**c3fbda6279028fd2bde9f6d967970870ff7546aa** is the frozen repair candidate.
Curie must independently review this configuration repair before acceptance.
No full suite or new qualified/comparison run is authorized or claimed here.
The bounded current-consumer run exits0; root can separately choose this freeze
for its next whole-gate/comparison authorization.

This candidate contains byte commits7a517cec/7d7dce7c and canonical rmdir profile
commit3bf672f. Its product src, package, lock and root README match the reviewed
tree/file79316dfe exactly. Later dirty env-S (`execution.ts`/`env-split.ts`) work
is **excluded**, not waited for or silently included. Product source, FS,
contracts, author fixtures, dependencies and manifest are unmodified by this
repair. Foreign staging/scratch is untouched.

## Two reproduced coverage holes and corrections

Independent862fdc54 authenticated all original20 classifications but showed:

1. `tests/fs/webdav/atomic-extension-independent/consumer.mts` is an injected-
   fetch program, not a TLS service consumer. It was wrongly a compile-only
   companion. It now has its own `webdav-atomic-independent` runtime group,
   unchanged emitted `consumer.mjs`, and an identifying package.json beside
   emitted code. Original source/module-resolution assertions remain intact.
   The real TLS-dependent author consumer/example/HTTPS group stays compile-only.
2. A canonical `.test.mts` group with runtime:[] previously compiled and passed
   without executing its23 assertions. The runner now validates mandatory
   emitted-runtime coverage and positive nodeTests/one-runtime declaration
   **before building**, then matches declared groups/programs to actual successful
   results and exact assertion counts **after execution**. Empty, missing,
   skipped, failed or unrecorded execution cannot count as complete.

The former broad independent-holdout prefix census escape is also removed. It
contains no current .mts, so the177-entry census and original input hashes do
not change. A future executable there is no longer silently filtered out.
Classification is still trusted, separately reviewed metadata: no universal
hostile-config or fabricated-provenance protection is claimed. Original12
historical inputs and all raw evidence remain unchanged.

## Frozen execution and controls

| Check | Result |
| --- | --- |
| Current consumer groups |18 strict groups /29 unique maintained inputs;16 emitted programs; two actual external-service compile-only groups |
| Corrected self-contained atomic program |unchanged program passes; configured remove called1 time, final methods3 PROPFIND, stock ENOTSUP and namespace checks pass; no network |
| Original WebDAV loopback |13/13 unchanged |
| Canonical timestamp runtime |20 controls +3 mutant-kill assertions, not23 provider-success operations |
| S3 constructor program |6/6, not deployed-service proof |
| Existing negative types |two fixtures, exact2+5 messages/positions/continuations; paired positives pass |
| New canonical regression file |24/24, strict types pass in regular-file c3fbda62 archive; confirmed npm's actual glob discovers the file |
| Actual runner sentinel/record controls |3/3 coverage guards exercised |
| Actual runner guard mutations |both detected: remove precheck; remove postcheck while suppressing actual result recording |

The actual-runner experiments use unchanged frozen code bounded to the canonical
timestamp group; all other18-group routes and negative types are independently
covered by the unchanged current-consumer run. Only temporary test/harness
copies receive apply_patch mutations:

- **Declared sentinel:** strict compile succeeds; emitted program throws the
  exact sentinel; qualification rejects.
- **Omitted runtime, same sentinel:** mandatory-runtime precheck rejects before
  any build/type/runtime step. No phantom zero-test pass.
- **Missing actual result record:** the23 tests execute successfully, but a
  test-only runner mutation suppresses its record; postcheck rejects.
- **Remove precheck:** omission still eventually rejects at the postcheck, but
  incorrectly performs build/type work; the required prework assertion detects it.
- **Remove postcheck plus missing record:** the bad runner returns successfully
  with no recorded program. The mutation control detects that precise false
  success. It is not reported as a valid consumer pass.

No executed node:test skips/cancellations/TODOs. Counts remain separate; these
are not new native, full-gate, deployed TLS/S3 or all-backend acceptance results.
The independent tree/file package review is separately11/11 plus unchanged
199/199 and packed13/13 twice; no original family behavior was rewritten.

## Preserved history and reproduction

Preserve **847dfd7 exit0 as incomplete-coverage qualification**. Its old17 groups
and15 emitted programs were real, but omitted the service-free program and did
not guard runtime removal. Independent review accepted the20 classification
decisions, not that stronger coverage claim. Old whole-gate110 failures,
11/30 standalone omissions, native profile differences and first failed fixture
captures remain in their original commits/files. This repair changes only the
current execution route description for the one consumer, not its classification
or hash. No historical expectation/manifest rewrite.

```sh
node scripts/verify-current-consumers.mjs --source-commit c3fbda6279028fd2bde9f6d967970870ff7546aa
node tests/integration/qualified-current-release-repair/verify-regressions.mjs c3fbda6279028fd2bde9f6d967970870ff7546aa /tmp/release-regressions-unique
node tests/integration/qualified-current-release-repair/runtime-controls.mjs EXACT_NEW_QUALIFIED_DIRECTORY /tmp/runtime-controls-unique
```

The first command requires runner/config bytes matching the frozen commit and
retains the exact run path in its output. The third uses that frozen copy, not
mutable source or a private package. Harness helpers are committed separately
from evidence; all source mutations are in owned regular-file scratch, never
live product or original fixture files. Raw outputs, source/tool/package inputs,
ancestor bindings and cleanup are sealed in `evidence` and MANIFEST.json.
Actual root dist and source/tests were unchanged by the bounded run. All exact
owned run and mutation scratch trees are removed after capture. External
service execution and full-gate authorization remain with root.
