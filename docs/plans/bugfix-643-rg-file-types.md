# #643: bounded rg file-type filters

## Authority and scope

September 5, 2026. Resumed on clean `c139b62d7d6613ecc95ae0d26635753854bfc10e`.
Re-fetched the complete GitHub #643 body: author exactly `kamilio`, updated
`2026-09-05T18:43:32Z`. It requests a built-in bounded type database, `-t`/`-T`
and integration with traversal/globs; no customization flags were requested.
Read scoped AGENTS.md fully; current SHA-256:
`add0cac1e0c87194a1718dd340a7919119e9aa68ea642979ecd1629f7b6afcfa`.

Only search/options.ts, search/walk.ts and a new literal file-types.ts are
product edits. New tests: tests/commands/rg-file-types.test.ts.
Root owns registration and full gates. No README, matcher/ERE/regex/grep,
shared.ts/glob.ts/index.ts, build/dist, Git mutations or outside-path writes.

## Inventory and inspected semantics

Local oracle: `rg --no-config --type-list`, ripgrep **15.2.0 (rev e89fff89ac)**.
The complete 6,482-byte LF output has SHA-256
`43d61f9dcafe9af53d496f1d68ea170f71e74994a906bf1fbc30a7d110af980e`:
224 type names, 609 declared patterns, 537 distinct patterns. Preserve every
entry as literal data, including aliases, basename and multi-pattern rules.
The source output is a pinned inventory profile, not a latest/parity claim.
Canonical tests will authenticate this data contract, not implementation bytes.

Native read-only probes used --no-config, --color=never, --threads 1, --sort path,
a one-second timeout and 8-KiB output bound. They listed only the existing search
directory or searched supplied stdin. The initial sandbox subprocess returned
EPERM; the approved outside-sandbox retry completed. Recorded observations:

- Includes form a union; the last matching selection wins for includes/excludes,
  including different aliases and overlapping patterns. `-t all` selects all
  known types, not all possible filenames. Excludes alone admit unmatched names.
- `-g` overrides take precedence regardless of position relative to type flags.
- Explicit files and supplied/explicit stdin bypass filtering, but unknown types
  still error. `--files -t json -` prints `<stdin>\n`, status 0.
- Unknown/uppercase/comma-separated type names return status 2 with exact
  `rg: unrecognized file type: NAME\n`; no comma-list shorthand.
- Primary source at ripgrep tag 15.2.0, crates/ignore/src/dir.rs (matched and
  matched_dir_entry) and types.rs (matched/build), confirms: ignore exclusions
  precede types; type exclusions can reject ignore whitelists; a positive type
  match whitelists a hidden leaf, but does not whitelist/prune directories.
  This hidden-leaf interaction is intentional, not disabling hidden traversal.

## Implementation boundaries

1. Add RED controls for short/long/attached/repeated flags, aliases, basename
   patterns, ordering, glob/ignore precedence, explicit/stdin paths, hidden and
   symlink behavior, unknown names and bounded/cancellable filtering.
2. Pin all inventory entries as immutable literal arrays. Reuse existing worker
   glob matching on basenames; never content-sniff, load host config/databases,
   add new authority or bypass transports. Do not modify the glob implementation.
3. Cap type selections at 1,024 before retaining them. Resolve/validate before
   input consumption. Deduplicate matching patterns with last-selection order
   while retaining whether any positive type was requested. At most the fixed
   537 unique type patterns can be retained; charge cooperative preparation work.
4. Preserve existing search file/record/output/worker budgets, byte ownership,
   falsey cancellation, ignore/symlink/canonicalization checks and explicit paths.
5. Run only focused new/adjacent search tests and bounded native differentials.
   Root freezes for maintained lint/types/build/integration; no bypass or full gate.

## Results

- RED on c139b62d7 before product edits:
  `TSX_DISABLE_CACHE=1 node --import tsx packages/safe-bash/tests/commands/rg-file-types.test.ts`.
  Exit 1, 15 tests, **14 failures, 1 pass, 0 skipped**, 29.196 ms. Supported-type
  cases rejected -t/-T with status 2; the new inventory module was absent;
  unknown/limit diagnostics differed and type-preparation cancellation was not
  reached. The existing unsupported-customization control passed.
- Initial GREEN: same direct command, 15/15 passing, no skips, 2,067.770 ms.
- First bounded native differential: **39/40 matched**. The mismatch was
  `--files --no-messages -tunknown_type .`: both exited 2 with zero stdout;
  native stderr was `rg: unrecognized file type: unknown_type\n` (41 bytes),
  virtual stderr was empty. Preserve this finding; it is not a native pass.
  Add a dedicated RED control before correcting early configuration validation.
- Supplemental RED: direct node command with
  `--test-name-pattern='unknown type diagnostics'` selected one test, which
  failed before the correction (exit 1; 10.637 ms). Moving unknown-name
  validation into option parsing made the same test pass (exit 0; 8.713 ms),
  without changing filesystem diagnostic suppression or regex transports.
- Final focused GREEN:

  ```sh
  TSX_DISABLE_CACHE=1 node --import tsx --test --test-concurrency=1 --test-reporter=spec \
    packages/safe-bash/tests/commands/rg-file-types.test.ts \
    packages/safe-bash/tests/commands/search/rg.test.ts \
    packages/safe-bash/tests/commands/search/safety.test.ts \
    packages/safe-bash/tests/commands/search/pipelines.test.ts \
    packages/safe-bash/tests/commands/search/capability-requirements.test.ts
  ```

  The sandbox reported five passing file children without individual test
  events. Approved outside-sandbox replay reported **49 passed, 0 failed,
  cancelled, skipped or todo**, exit 0, 3,344.330 ms. Includes 16 new tests.
- Final native differential: **45/45 matched exit status and exact stdout/stderr
  bytes**, including the original 40 controls, separated long flags, both
  no-messages orderings and 1,024 repeated `-tts` selections. The extra-cap
  1,025-selector rejection is an intentional virtual limit, not native parity.
  Ordered receipt digest (JSON of args, stdin, status, stdoutHex, stderrHex):
  `f528f996de3a93dc77eb186c8b91c7bd57ffcd4221a371417e0d55ddbaa588a0`.
- Native/virtual comparison fixture: the 14 regular basenames in the current
  search directory, mirrored as empty MemoryFileSystem files, plus supplied
  `hit\n` stdin. Native only listed existing names or searched supplied stdin;
  no fixture files or outside-path evidence files were created. Names:
  README.md, file-types.ts, glob.ts, grep.ts, index.ts, matcher.ts, options.ts,
  output.ts, portable.ts, requirements.ts, rg-command.ts, rg.ts, shared.ts, walk.ts.
  `README.md` exercises actual basename matching and overlap with md/markdown;
  ts/typescript/typoscript exercise aliases and overlapping type patterns.
- Native results: selected TS names total 163 stdout bytes; README selection 12;
  their union 175; explicit options.ts 11; files-mode stdin 8; searched stdin 4.
  Empty selections exit 1 with no bytes. Unknown-type cases exit 2 with no stdout
  and exact diagnostics (unknown_type 41 bytes, TS 31, ts,js 34, constructor 40,
  empty name 29). Native bounds remained one second/request, 8-KiB output, one
  thread, --no-config and deterministic path ordering. Exact argv/results and
  the equality assertions are in the execution transcript.
- `git diff --check` passed for owned paths. No lint/build/typecheck/full gate,
  registration edit, Git mutation, README edit or shared-dist write was performed.

## Final source identities

Independent root verification on September 5, 2026 passed all 49 focused
tests (3481 ms, no failures, skips or cancellations). Root separately
reconstructed the complete native inventory from the literal data and compared
all 6482 bytes with installed `rg --no-config --type-list`: exact equality,
224 types, 609 declared patterns, 537 distinct patterns, and the same pinned
inventory SHA-256. This verifies the current local oracle, not future versions.

Logs are `tmp/issue-643-root-focused.log` and
`tmp/issues-635-643-root-identity.log` under the directory identified by
`/tmp/kamilio-569-575-validation.path`. Both new suite registrations also passed
98/98 integration-registry tests (8035 ms), recorded in
`tmp/issues-635-643-registry-root.log`. Maintained qualification and delivery
remain separate, pending root steps.

SHA-256, after final source/test edits:

| Path (under packages/safe-bash) | SHA-256 |
| --- | --- |
| src/commands/search/options.ts | `3fc752abe7a72200c2c26f82c7e30a3640e1ab358a38790a5f25240d08950e75` |
| src/commands/search/walk.ts | `9b3036285b0199cd8a171ca6b8ef84a50cc87f65d96f465cb647e2ba29fc6ccd` |
| src/commands/search/file-types.ts | `2198b0d04026658226c92f21c2bb94b3d1d8534cf52e01eb7cf755575be0eb8f` |
| tests/commands/rg-file-types.test.ts | `7afe9acc21819deeb833e8b1307e2108888a64ef7e14ecc473190cc22d631a55` |

The 9,063-byte file-types.ts consists of literal ordered native type-to-pattern
data and immutability setup. Regeneration parses exactly the authenticated
6,482-byte inventory (`name: pattern, pattern\n`), emits JSON string/array
literals in the same order, and freezes the table and every array. There is no
runtime native dependency, host database/config access, or inferred extension
subset. The independent inventory-data hash test covers all entries; it does
not seal current implementation source bytes.

## Remaining boundaries

- This pins the inspected local 15.2.0 inventory, not an assertion about future
  versions or universal rg parity. Full inventory coverage and the 45 scoped
  native behavioral controls are distinct claims. Additional basename/classes,
  hidden/ignore and symlink controls use MemoryFileSystem; hidden precedence was
  inspected in the matching primary source, not in a newly created native fixture.
- Limit: 1,024 type selections; retained unique type patterns at most 537 for
  this pinned inventory. Preparation calls the existing cooperative tick; glob
  validation/matching uses unchanged worker transport batching and limits.
  Existing search entry/file/record/output caps remain unchanged. This does not
  establish a new global CPU/RSS bound or hostile-host-JavaScript isolation.
- `--type-add`, `--type-clear` and public `--type-list` remain unsupported.
  No content sniffing, extra case-folding, custom type definitions or new option
  configuration surface is added. Explicit file/stdin bypass and type-positive
  hidden-leaf whitelisting match inspected semantics, without following hidden
  directories or symlinks automatically.
- Root owns exact test registration, final maintained lint/types/build and
  integration/release decisions. No full qualification claim is made here.
