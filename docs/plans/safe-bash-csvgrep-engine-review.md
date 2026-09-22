# engine-csvgrep review

Reviewed current working tree on 2026-09-20. Completion is blocked.

## Validated findings

1. No `packages/safe-bash-command-csvgrep` implementation or engine tests exist.
   Workspace manifest/source inventory contains csvsort but no csvgrep owner.
   Searches of `packages/safe-bash/package.json`, `scripts/bundle-safe-bash.mjs`
   and `scripts/package-safe.mjs` find no csvgrep export or bundle entry.
   There is no task code diff to simplify or run affected checks against.
2. The required accepted shared CSV parser/selector contract remains absent.
   `packages/safe-bash-contracts/src` contains command, filesystem, I/O, output,
   plugin, error and value contracts, but no CSV contract. The csvsort workspace
   supplies sorting, not the missing shared byte-stream parser/selector.
   `packages/safe-bash/integration-boundaries.json` holds XAN CSV and selector
   paths; `tsconfig.build.json` excludes them. Held payloads were not inspected
   or reused. The existing prerequisite finding remains applicable.
3. Regex isolation is available, but Python 3.9 search compatibility is not
   declared. Existing protocol descriptors cover grep, rg, glob, expr-match and
   bre-search; byte/UTF8-scalar profiles do not establish Python Unicode classes,
   inline flags, anchors or named references. A worker timeout alone cannot
   satisfy those semantics. Unsupported features must remain explicit.
4. The plan marks `engine-csvgrep.status.implement` as `done`, conflicting with
   the missing implementation and the prerequisite finding. This review does
   not certify that status. The existing plan edits were preserved.

## Required follow-up

Establish and accept the shared CSV parser/selector/serializer contracts and an
explicit bounded regex capability before dependent integration. Then write
original failing memory-VFS engine tests covering the independent acceptance
controls, including precedence, empty patterns, aggregate inversion, missing
fields, physical line numbers, Unicode match-file rstrip, every-byte chunking,
cancellation, cleanup ownership and invocation-local budget exhaustion.

Review the resulting implementation for duplicate engines, proxy-only helpers,
unnecessary abstractions, host access and failure-path leaks. Verify CLI/SDK
equivalence and isolated installed runtime/declaration consumers without the
private workspace. Existing snapshot/version compatibility cannot be certified
before those implementations and checks exist.

The deleted package-pattern document was read at its archived successor,
`docs/plans/archive/safe-bash-command-package-pattern.md`; neither path was
changed. No substitute parser, scaffold, placeholder test or unsupported regex
translation was added. Verification here was repository inventory, explicit
protocol/export searches and task-diff inspection, not a runtime test pass.
No code changed, so unit, visual and artifact checks were not run. Unrelated
edits were preserved. Local commits: none. Verified remote-main delivery: none.
Successful releases: none. No private package publication was attempted.

## Subsequent behavior implementation

The later behavior task introduced original private CSV and csvgrep owners, supported-profile grammar and explicit budget/cleanup controls. See the candidate-increment appendix in `safe-bash-csvgrep-acceptance.md` and the two package READMEs. The original missing-implementation findings above describe the inspected earlier tree, not the current candidate. Full Python CSV/regex and native-profile qualification remains open; the candidate appendix separates passing supported controls from unsupported/unqualified matrix cells.
