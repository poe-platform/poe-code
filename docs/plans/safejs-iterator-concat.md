# Iterator.concat

Source inspection and built probe c52edd confirm Iterator.concat is absent,
independently of the missing zip/zipKeyed methods. The
[current specification](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.concat)
requires ordered acquisition of iterable methods, lazy opening/advancement,
shared iterator-helper behavior and closure of an active input on early return.

New regression file `interp/globals/iterator-concat.test.ts` covers sequential
values, empty inputs, prototype identity, observable acquisition order, invalid
inputs, early return before/after opening, captured method replacement,
metadata and completed public replay. Initial run 2821 exposed three malformed
fixture blocks and eight negative controls that passed merely because concat
was absent. The fixtures were repaired and negative controls now also require
the callable to exist. Corrected run 97456 fails all 15 cases for the missing
feature, without parse failures. Native Node 26 probe 8255ed matches the four
static fixtures' expected values, ordering, prototype identity and metadata.

The implementation must preserve outstanding iterable/method references in
budget accounting and snapshot state, including early close and error paths.
Use the existing helper prototype and callable bridge, not eager arrays or a
host-only implementation. Add low-level snapshot, error-precedence, reentrancy,
budget and foreign-realm controls before treating this feature as complete.
Joint iteration and the separate full-suite timing failures remain open.

The initial runtime implementation uses the existing helper prototype, records
unopened iterable/open-method pairs, and opens one input at a time. It passed
58 tests but reproduced a public replay failure because the snapshot validator
did not yet admit concat (2748). Five direct snapshot cases then failed for
that same missing format support (86575). Capture, validation and restoration
now preserve unopened inputs, active cursors and aliases; all 64 concat and
existing lazy-helper tests passed (18510).

Error and reentrancy controls plus the five direct snapshot cases passed all
26 tests (88975). Additional malformed-state and exact retained-data-delta
controls passed all seven snapshot tests (83212). These focused results do not
qualify the whole change: type checking, broader iterator/snapshot coverage,
lint, isolated build and independent delivery checks are still required.
The implementation is uncommitted and does not resolve zip/zipKeyed or the
prototype candidate's two full-suite timeouts.

Main-worktree type checking passed (`tsc -p packages/safe-js/tsconfig.json
--noEmit`, 77362). The broader 36-file iterator/accounting/prototype selection
passed all 798 tests (62604). This includes pending unrelated main-worktree
integration, so independent concat-only qualification is still required before
committing. Scoped lint is running; no push or release is authorized.

Scoped lint 65130 passed. The independent candidate is based on b6501e375,
staged tree `2b55598b905048bfb918db71ec249712bd564566`, and includes ten paths.
Inspected selective blobs include only concat accounting, helper schema,
capture/validation and restoration changes; pending prototype and weak-reference
work is excluded. All 1,333 tracked source/test/script/manifest blobs match the
private index (69cf4d), with no additional visible source files before generation.
The maintained selected workspace build is running in the new isolated directory.

Independent build 96587 passed all 23 selected dependency tasks and four fresh
native ESM import checks. The complete snapshot directory plus 30 additional
iterator/accounting files is now being verified against that isolated candidate.
Its source remains unchanged during validation.

Independent snapshot/iterator/accounting run 82035 passed all 2,418 tests across
161 files in 162.58 seconds. Built CLI probe 22b9be passed on Node 18.18.2,
returning `[1,2,3,4]`, an empty result for no inputs, name `concat` and length
zero. Independent scoped lint and the screenshot review remain pending.

CLI screenshot 11210 was reviewed: the built command displays the expected
successful JSON result without errors. Post-run verification 311fee matches all
1,333 source/test/script/manifest blobs and all eight generated Intl files to
their built copies, with no unexpected visible files. The README now describes
concat behavior and explicitly retains zip/zipKeyed as unsupported; its update
will be included in the same atomic improvement. Independent lint remains live.

Built SDK control 9866fd passed direct exported concat invocation with a foreign
Proxy input and Proxy open method. It verifies sequential values, exhaustion,
the originating helper prototype and originating Object prototype for results.
This supplements, rather than replaces, the maintained regression suite.

Built control 8d10bf preserves a captured guest open method through property
replacement and low-level JSON restoration, yielding the original value 7
instead of replacement value 9. Budget control bbc66f rejects exported concat
input traversal with the exact error fields `steps`, current 41 and limit 40.

Independent scoped lint 51548 terminated successfully (7aa64f). Qualification
for this atomic change comprises the isolated selected build/import checks,
2,418 snapshot/iterator/accounting tests, fingerprint verification, Node 18.18.2
CLI/screenshot checks and the explicit SDK/recovery/budget controls above.
This is not a clean full-package result: the separate prototype candidate's
two full-suite timeouts and the broader completeness gaps remain unresolved.
Commit locally only; publication remains on hold.
