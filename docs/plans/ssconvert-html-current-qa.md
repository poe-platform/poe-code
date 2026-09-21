# Current HTML import verification

This procedure verifies the current dirty workspace candidate, preserving the
pre-existing importer, integration, exports, dependencies and historical QA.
No README edits, commits, pushes or publications are authorized by this run.

## Manual procedure

1. Hash the archive in `out/ssconvert-lifecycle`; require Gnumeric 1.12.61 SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Use the separate colima oracle and recorded C/UTC dependency/plugin profile
   in `docs/ssconvert/html-reference-profile.json`. Never load it in product code.
2. Convert the original nested-caption fixture in the new command integration
   test through native HTML-to-XML. Compare names, extraction order, coordinates
   and values with command checkpoint and SDK replay. Confirm CSS/x:num cannot
   override cell text. Keep scratch files exclusively in out.
3. Convert the original combined title/textarea/script/empty-reference fixture
   through native HTML-to-CSV. Compare status, CSV and warning bytes after
   accounting for the explicitly different input filename.
4. Execute the cell-budget rejection case with throwing destination operations.
   Require no destination acquisition, one input read, unchanged memfs contents,
   and a successful subsequent importer-listing command.
5. Build the maintained safe-bash dependency closure uncached. Run ssconvert's
   maintained uncached workspace test and lint commands. Run all five maintained
   ssconvert command test files directly through the Node test runner; separately
   check integration-file ESLint and safe-bash's maintained typecheck route.
6. Screenshot the built virtual command's HTML4 recovery/warning example via
   `scripts/screenshot.ts` with an out-only helper and PNG. Inspect the CSV,
   warning excerpt/caret and statuses visually. This command is virtual and is
   not exposed as a poe-code CLI subcommand, so use the generic screenshot route.
7. Record exact candidate hashes, passes, failures and unverified runtime cells
   below; remove only run-owned scratch logs/helpers/PNGs and oracle fixtures.

## Independent review

See `ssconvert-html-current-independent-qa.md` for three reproduced failures,
failing regressions before repairs, native negative controls, and measured
remaining diagnostic mismatches. HTML4 title/textarea children are tokenized
through the parser's public API with absolute offsets; scripts remain inert.

## Results

The manual procedure completed against dirty HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`. This run repaired the existing importer;
it did not recreate or claim authorship of pre-existing integration or QA edits.
The official archive hash and native `ssconvert --version` were reverified.

Passed:

- Maintained `npm test --workspace=@poe-code/ssconvert -- --no-cache`: 178 files,
  4,537 tests, zero failures/skips. The initial run caught the independently added
  deliberately failing empty-reference regression: 4,531 passed, one failed.
  The entire workspace suite was rerun after repair; this was not a focused-only
  substitute for the failed workspace gate.
- Maintained `npm run lint --workspace=@poe-code/ssconvert`: ESLint and both
  source/test TypeScript configurations passed after the final source repair.
  Integration-file ESLint also passed.
- Maintained `npm run build:workspaces --
  --workspace=@poe-platform/safe-bash --no-cache`: the declared dependency closure,
  ssconvert, safe-bash and native npm suffix scripts completed successfully.
- All five ssconvert command test files: 67 passed, zero skipped/cancelled.
  These are focused Node tests, not the complete safe-bash workspace test route.
- Native nested-caption XML and combined HTML4-recovery CSV matched the new
  command/SDK checks. Names are `Sales &amp; Costs`, then `Detail`; outer rows
  remain 0/1, nested row 0. Combined CSV is `,X\n,&\naxb,AB\n`, status 0.
  The long-line numeric warning matched exactly after filename normalization.
- Foreign-realm byte arrays probe/import identically to local bytes. Thrown
  diagnostic-handler reason identity is preserved. Existing cancellation tests
  cover initial abort and abort during an awaited diagnostic. The new negative
  destination-authority test proves no publication/temporary acquisition before
  cell admission, intact memfs namespace and successful subsequent invocation.
- Original HTML, XML checkpoint, SDK reload and command replay preserve nested
  extraction and named-sheet selection. Existing cases cover merges, external
  image comments, script inactivity, input-only reads and output bytes.
- Built virtual-command screenshot inspected: readable two-row CSV, parser
  excerpt/caret, status 0. No ad hoc screenshot tests were added.

Failed/incomplete:

- Maintained `npm run typecheck --workspace=@poe-platform/safe-bash` exits 2
  before source/consumer checks. Investigation located the checkout-profile
  assertion in `tests/plugins/qualified-current-release/peer.mjs:245`, which
  requires `poe-code` export `./safe-fs` to import
  `./packages/safe-js/dist/safe-fs.js`. The current root manifest has no such
  export; the assertion observes `undefined`. The same omission is present in
  HEAD. This is a current failed gate, with zero consumer groups checked, not
  an HTML incompatibility or a successful wider typecheck. No shared export or
  assertion was changed to bypass it.
- Native comment-closure, unterminated-attribute/start-tag and embedded
  unexpected-end-tag diagnostics remain mismatches as detailed in the independent
  report. Complete libxml diagnostic parity is not achieved.
- The first additional budget test incorrectly expected SDK conversion to return
  a command-style status for a resource error. It was corrected to assert the
  documented thrown SDK error while separately checking command status 1.
  The first checkpoint assertion incorrectly required an ordinary object
  prototype; it was corrected to compare own value fields of the restored
  null-prototype records. These were test expectation failures, not code fixes.

Not run/unverified:

No full repository test/lint/build gate, full safe-bash unit suite, e2e or
performance measurement was run for this focused codec repair. No alternate
locale, dependency/plugin profile, browser/workerd, or alternate Node-version
runtime cell was exercised. Full parser recovery/encoding/sheet-name/overlap
coverage retains the limits in `ssconvert-html-import-qa.md` and the current
independent report. These cells are unverified, not passes. Resource limits are
host policy rather than native exhaustion compatibility.

Exact checked files (SHA-256):

| File | Hash |
| --- | --- |
| `packages/ssconvert/src/codecs/html.ts` | `2429e3da9c5e15d72a44c5b1d964993af3e39827e755e4cde7bd3df3e394cd6d` |
| `packages/ssconvert/src/codecs/html.test.ts` | `05a3fe2afa72ae9107577cdeac3c69ef7811bdce8c96f556a6a0939223cfce35` |
| `packages/ssconvert/src/codecs/html-independent.test.ts` | `1e6ccdd632dc5974b1b8bd531b6f7a9a5222215af1781efa1dfb74394d80979c` |
| `packages/safe-bash/tests/commands/ssconvert.test.ts` | `19b38a4d140f207d27b704fd6947cab9aff4529db2c3c1327a913b093b4eea86` |

Run-owned scratch evidence was reduced here and removed. Existing source
archives, historical evidence and other out contents were preserved. No README
edits, local commits, remote-main delivery, publication or release occurred.
