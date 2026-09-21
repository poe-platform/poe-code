# Current hidden resize QA

Follow the existing resize-workbooks procedure with fresh evidence. Preserve all
existing work, acquire primary source only into out, and do not edit README files,
commit existing package trees, push or publish. Native is a separate QA oracle.

1. Authenticate the official 1.12.61 archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Use the exact environment and native binary in
   `docs/ssconvert/resize-reference-profile.json`. Check dependent.c's named
   expression `ignore_rel=TRUE` path and sheet.c's selection restriction.
2. Construct original local named expressions A200, $A$200, A$200 and
   A100:A200 on a sparse 256 by 256 sheet. Compare native resize to 128 by 128
   against ordinary cell-formula A200 as a negative control. Keep QA files in
   out/ssconvert-resize-current, separate from unit tests.
3. Before implementation run the new in-memory regression and require failure.
   Ask a different agent to independently check selections, nonzero name parse
   positions, namespaces, unchanged dimensions, cancellation and work limits.
4. Run maintained uncached ssconvert lint/tests and the selected safe-bash build
   closure. Run the maintained ssconvert command Node test file after rebuilding
   exports, and lint the edited integration test. Inspect actual virtual-command
   diagnostics through a screenshot. Keep original/checkpoint/replay name effects
   covered with memfs and compare SDK and command bytes/status/diagnostics.
5. Record fresh results and exact source hashes after the reviewer finishes.
   Historical counts do not certify this candidate. Unavailable runtime cells,
   full repository gates and remaining compatibility differences are unverified.

## Fresh results

- Archive SHA-256 matches; inspected sheet.c, dependent.c, expr.c and t9001
  source bytes match members of the authenticated archive. Native binary hash
  freshly matches the captured profile (`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`).
- Root named regression failed before repair: relative A200 incorrectly became
  #REF! and A100:A200 incorrectly clipped to A100:A128. Native instead prints
  A72 and A72:A100. Absolute row coordinates still relocate; ordinary formulas
  still invalidate. Reviewer reproduced two additional selection failures before
  clipping retained selection rectangles, resetting the cursor to the last
  surviving range start, and falling back to A1 for deleted selections.
- Native local names at A1 and independent names at GS201, plus three original
  selection cases, were checked under the captured C/UTC environment. See
  [independent current review](ssconvert-resize-current-review.md) for cases.
- Final `npm test --workspace=@poe-code/ssconvert`: 243 files, 5,365 tests passed,
  uncached maintained package route, including the reviewer's final eight tests.
- Final targeted resize set: six files, 40 tests passed. These are semantic
  checks; maximum-dimension sparse storage is not a performance measurement.
- Maintained ssconvert lint passed: source ESLint, source/test TypeScript.
- Uncached `npm run build:workspaces -- --workspace=@poe-platform/safe-bash
  --no-cache`: declared 18-build dependency closure passed. Final uncached
  ssconvert three-build closure passed after all product edits.
- Final export-backed `node --import tsx --test
  packages/safe-bash/tests/commands/ssconvert.test.ts`: 58 passed, zero failed,
  cancelled or skipped. Extended the existing memfs hidden-sheet case with local
  names, byte-identical command/SDK export, and serialized workbook replay.
- Edited safe-bash integration test ESLint passed. `git diff --check` passed.
- Executed the Markdown procedure and captured/inspected actual virtual command
  output with `npm run screenshot -- --output
  out/ssconvert-resize-current/visual.png node
  out/ssconvert-resize-current/visual.mjs`: trailing text succeeds, malformed
  uppercase X is silent, invalid power-of-two dimensions warn with status zero.
  The screenshot joins separately buffered channels for presentation; channel
  ordering and bytes are asserted separately in integration tests.

Verified host runtime: Node 22.22.2. Native oracle uses the separately captured
Linux dependency/plugin/locale profile; other runtime/profile cells are unverified.
Failed regressions were repaired. The foreign ordinary-object realm acceptance
probe failed and was investigated: it is explicitly unsupported by current
snapshot admission, with an accessor-refusal negative control passing. No timed
out or incomplete check was counted as a pass in this run.

## Candidate identity and limits

No local commit was created because the package/integration tree already contains
uncommitted work. These product/test SHA-256 values identify the candidate:

| File | SHA-256 |
| --- | --- |
| packages/ssconvert/src/workbook/resize.ts | ff9d3b759b4691ae8f49c645479627ae448bafc66a625e26673167d64003c0d8 |
| packages/ssconvert/src/workbook/resize-records.ts | a702005bc28a643b622e3b7e7f2af7d2b266c25dc94d522bcd91d781c612eb10 |
| packages/ssconvert/src/formulas/workbook.ts | 55ecbac008ec1091a549c22800ec303196d804b04c4cf30aeb09783b9079f723 |
| packages/safe-bash/tests/commands/ssconvert.test.ts | 5d360a48688bc13cd1e44f08975bfcb34060e2c11df9ba74ee795d88a4024d9e |

Full repository tests/lint/build, full safe-bash discovery, packed consumers,
Shell checkpoint serialization beyond workbook replay, and arbitrary realm/host
profiles were not run or qualified. Focused checks are not broad gate passes.
No remote delivery, push, publication or release occurred. No README was edited.
Root/reviewer current scratch was reduced to these documents and purged;
pre-existing source/oracle scratch and unrelated work remain preserved.

Existing resize QA documents enumerate the remaining native compatibility limits,
which remain open unless measured here: dynamic GLib diagnostic prefixes and
uninitialized invalid-size error state; native hash-table messages; scanf integer
overflow; style ties/hash traversal and partial-style default inheritance;
conditional-format expressions, solver/filter/scenario metadata, frozen panes,
scroll position, selection overlap simplification, all object anchor modes,
foreign-format style records, print page breaks and other print properties;
formula/XML canonicalization and unmeasured external/3D named expressions. These
are unsupported or unverified cells, not passes or a universal parity claim.
