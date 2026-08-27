# Column padding evolution: independent preparation only

This seal prepares a deliberate, Root-authorized profile evolution. It does not
run, inspect or certify the current author's implementation/tests. The author owns
`src/commands/column/**` and `tests/commands/column/**`; this verifier owns only
this new directory and its isolated scratch. No product, build, package, comparison,
performance, shared-contract audit or dependency installation runs in this phase.

## Immutable history and authority

- Preparation `46e90c80`, all seven original preparation files, all 88 original
  native captures, and the complete prior handoff evidence remain unchanged.
- Historical source `38cb670acf0826467e928ea30cdcb0524436d144`, five-file digest
  `06a48bca73584c719bad2fa5db1e447e87c63f900e5dc715c80244701d125a75`, and its original
  37/40 top-level result stay historical, not retrospectively declared defective.
- Root's new authority requires unchanged N01/N03 native bytes: N01 adds three
  spaces after `9` and two after `22`; N03 adds two after first-row `c`, retaining
  the second row's explicit trailing empty field. No old assertion is rewritten.
- API/options/default bounds, strict UTF-8, scalar widths, explicit empties,
  separator scalar sets, input order, and unsupported advanced options stay fixed.
  The historical README at `38cb670a:src/commands/column/README.md` supplies the
  API/bounds/text contract, not the current author's code or tests.
- S38's original failed assertions and observations remain sealed. Plato/Root
  review registered cleanup versus opaque external input separately. This phase
  neither labels every nonblocking return a bug nor waives any old assertion.

## Frozen controls

`recipes.json` contains **17 literal controls**, one variant each: original N01
and N03, multiple absent trailing fields, default/custom/empty/multibyte separators,
explicit empty fields, combining/CJK/emoji text, final partial input, and four fill
controls (`-x`, default direction and `-c`). Small native inputs only.

`native-observations.json` retains **34 fresh raw captures**, 17 per profile, plus
**10 raw identity/host probes**. These are not additional product passes. Every
argv/input/stdout/stderr/status/signal is retained; there is no whitespace,
unsupported-option or diagnostic normalization. New N01/N03 util-linux captures
are statically checked against their original raw observations.

`expectations.json` freezes the supported product bytes before any evolution
candidate observation. All 17 selected util-linux controls agree with the unchanged
scalar/separator/fill rules plus the authorized padding delta. BSD remains a
separate profile: four exact fill controls, four unsupported `-o` captures, one
partial-line error, and eight other byte differences. Those are disjoint capture
partitions, not passes against a candidate or claims of full native parity.

For each table, global field widths are taken over actual parsed cells. For every
column before the last global column, emit the row's actual cell or empty text,
space-pad to that column's width, then emit the literal output separator. Emit the
last cell or empty text without padding the final global column. This independent
description explains native bytes; it is not permission to materialize missing
cells or perform unchecked rectangular traversal. Fill remains unchanged.

`safety-schedules.json` contains **16 not-yet-executed safety schedules** with
registered negative controls. Nested variants are not counted as 16 test passes.
They cover cumulative output/work/arguments/rows/fields/cells/input, padding before
allocation, sparse 20,000-by-1,024 logical tables, zero-output scans, UTF-8 byte
versus display widths, bounded padding chunks, backpressure, cancellation, partial
effects, producer reuse, final records, operands and owned child retirement.
There is no `maxColumns` option: use unchanged `maxFields`/`maxCells` contracts.
Large expectations use size formulas and incremental hashes, never a rectangle.
An explicit budget refusal can satisfy a designated resource-safety assertion,
but is not a byte-layout success; timeout/OOM/output kill never counts as either.

## Reused native machinery and provenance

`capture.mjs` authenticates both existing native binaries and the unchanged old
capture runner, copies that runner and only the new recipes into a fresh isolated
scratch, and invokes it there. It creates no new runner framework or native build.
The old runner bounds each native child to 2 seconds and each raw output stream
to 65,536 bytes, observes close, and retires its owned process group. The wrapper
rechecks native hashes after completion. Scratch copying is exclusive; redirect
capture stdout to a new file with shell noclobber, never overwrite old evidence.

Native profiles are util-linux **2.41.2 linked to Darwin libSystem** and installed
Darwin BSD `/usr/bin/column`, not GNU/Linux. The prior primary pinned release archive
hash and build identity are linked through unchanged `../provenance.json`;
no new source download, build, installation or dependencies were needed. The
historical man7 rendering was development documentation, not proof of the binary
version. Full binary hashes and exact runtime/locale appear in the new provenance.

`validate.mjs` performs static JSON/hash/count/formula checks only. It verifies the
new directory's exact file set (including unexpected entries), and recursively
checks the original stress tree outside this new directory against its pre-work
inventory, detecting both changed and added entries. No product/native execution
or evidence writing occurs. This is preparation integrity, not runtime acceptance.

## Author handoff prerequisite — STOP

Wait for Root's explicit authorization and the closed author's commit/digest.
Then, and only then: authenticate a regular isolated whole committed archive;
verify source and locked development-tool identities before/after, including new
entry detection; run unchanged old holdouts plus these sealed controls and distinct
native profiles; implement the bounded safety schedules with retained raw failure
history. No live source aliases, synthetic cherry-picks or new runtime installs.

Later verification must include scoped strict types/build and a physically moved
offline package with public-root Shell and the packed internal column module URL,
single standalone plugin, collision/replace, pipelines/VFS byte effects and cancel
capabilities. Record the actual public-subpath limitation without claiming public
integration. Keep S38/packed shared observations and Root's decision boundary
unchanged unless Root explicitly adjudicates them; do not migrate assertions.

This preparation stops after its explicit-file commit. Owned native children have
closed; scratch and captures remain. No candidate replay or source work is running.
