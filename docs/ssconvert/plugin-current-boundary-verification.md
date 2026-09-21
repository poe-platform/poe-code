# Current ssconvert adapter boundary verification

This run preserves the existing domain engine, registration, exports, independent
inventories and prior QA evidence. The new validated repair routes diagnostics
through a lazy enrolled stderr output operation, just as stdout is enrolled.
Independent failing regression evidence preceded the repair. An additional
cancellation control verifies that admitted diagnostic writes drain before
invocation/registered-cleanup settlement and preserve the exact abort reason.

## Candidate identity

The candidate is the dirty worktree above HEAD
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`, not a committed release revision.
SHA-256 bindings for the inspected/tested files:

| Input | SHA-256 |
| --- | --- |
| safe-bash ssconvert adapter | `d905b803596529ac5af4cc0102d0550a8046cd070d12e375e8e24cc76bc7a962` |
| independent plugin stress tests | `fda195869d77073a4d515670d09f411d3dd5e434936482a8d1ef56fec2fff38a` |
| ssconvert command/SDK integration tests | `68b44d4c2fd73eebf110206605157b4c4150bb282abd30d7f8aae1f24e24d64a` |
| integration-input discovery assertions | `2bac9cbfa9a7097b654ff21fea9428134b9cc2f771b7efbc6e1ac325cbdb8d68` |
| safe-bash package manifest | `1a706dedef3d81380534c8e758e7bab62e9deeeeedab42377cc2d923f89f0ed7` |
| root package manifest | `447bbd8621f98145458fad6d4baca8bd816ab91a3894859f30170e3fd55cac66` |

Domain input inventory: 586 regular files under `packages/ssconvert/src` and
`scripts`, plus its package manifest and two tsconfigs. SHA-256 of JSON-encoded
lexically sorted `[repository-relative path, file SHA-256]` pairs:
`10cdef8c1b7fe6a25a988cf99dd544139aa753c347ad0620086a14a80dd2d2cc`.
No symlink inputs are admitted by this inventory calculation.

Integration input inventory uses the same encoding/ordering over 848 regular
files: all files below `packages/safe-bash/src` and `scripts`, the `src` trees of
`pdf`, `office-package`, `safe-fs` and `safe-bash-contracts`, all direct
`packages/safe-bash/tests/commands/ssconvert*.test.ts` files, the safe-bash/root
package manifests and root package lock. SHA-256:
`14628fb4058e93627435ceef990512f9757b7a2e8772cf62dadf2c33556e4bcf`.
This binds current integration/dependency source inputs without asserting a
complete installed third-party artifact census or a committed revision.

## Passes

- Recomputed official Gnumeric 1.12.61 archive SHA-256 matches
  `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
  Primary source remains only in the pre-existing `out/ssconvert-lifecycle`
  capture. The dependency/plugin/locale reference profile remains incomplete.
- Fresh domain workspace tests: 304 files and 6,187 tests passed. Fresh domain
  lint, source typechecking and test typechecking passed through its maintained
  workspace lint script.
- Independent reviewer: 80 focused command/stress tests passed, including ten
  plugin stress cases. These use injected capabilities and original in-memory
  fixtures/memfs, without native utilities, LLMs or disk fixture writes.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`
  passed the maintained selected dependency closure, guarded ESM/declaration
  emit and postbuild; 18 declared builds executed.
- Maintained safe-bash `test:runner`: 558 passed, zero failures/skips. The stress
  suite retains its literal path in integration-input assertions; historical
  inventories/seals and default command registration are unchanged.
- Maintained safe-bash `npm run test --workspace=@poe-platform/safe-bash --
  --test-name-pattern=ssconvert` completed with status 0 after discovering 1,346
  active test files. Reporter: 1,434 passes, zero failures/cancellations/skips/TODOs
  in 547.58 seconds. Counts include file wrappers; the name filter excludes
  unrelated behavior and is not full-suite qualification. Current conversion
  suites exercise command/SDK comparisons, errors, original/checkpoint/replay
  execution and exact namespace effects alongside the plugin boundary tests.
- Guarded root `npm run lint:eslint`: complete, zero errors, four warnings,
  17,034 subjects linted with complete receipt accounting.
- Built public Node command/SDK imports resolve. An agent Shell with explicit
  plugin binding executes ordinary `ssconvert --version` with status 0 and empty
  stderr. Browser-condition root imports select the portable root without the
  ssconvert export; this does not execute the browser domain engine.
- Manual realm/authority controls pass with their documented rejection
  boundaries: SDK accepts the measured foreign byte source; foreign workbook
  records are rejected; explicit host normalization gives identical command/SDK
  `17` bytes. HTTPS access without an injected transport returns status 1,
  empty stdout and the exact disabled-capability diagnostic.
- Original oversized input (`abc` with a two-byte limit) fails before codec
  admission/output creation, preserving unrelated file bytes. The public Shell
  diagnostic is exactly
  `shell: line 1: EFBIG: file too large, readFile '/input.fixture'\n`.
- Public virtual `ssconvert --help` screenshot was captured and visually
  inspected: ordinary literal invocation, aligned descriptions, readable help,
  no error. QA was executed from the Markdown procedure in `docs/plans`.

## Registration and bounded measurement

Retain explicit host plugin registration alongside `agentCommands()`. No new
agent invocation syntax or default inventory change is introduced. Conversion
logic remains solely in `packages/ssconvert`; native ssconvert is never a product
dependency/fallback. The existing Node root export eagerly imports this plugin;
explicit registration does not imply a lightweight Node root import. Browser
root selection remains portable.

A single sequential Node v22.22.2 observation imported internal built
`dist/core.js` in 235.67 ms with a 31,388,528-byte heap delta, followed by the
public plugin in an additional 280.32 ms with a 12,447,200-byte heap delta.
This is a bounded observation with shared-module/GC/load effects, not a repeated
benchmark or startup guarantee. `/core` is not a public package export. The
existing rendering/parser/domain dependency tree and required explicit host
limits/environment continue to justify exclusion from the portable aggregate.

## Failures, limitations and unverified cells

- Maintained safe-bash typecheck fails with status 2 before source/consumer
  checking: `Public SafeFS must preserve shared SafeJS runtime identity`.
  The current root manifest has no `./safe-fs` export, while the qualified peer
  guard requires `./packages/safe-js/dist/safe-fs.js`. Reproduced both before and
  after the maintained build. The guard was preserved, not bypassed; consumer
  groups and runtime executions from this route remain unverified.
- Foreign-realm Shell stdin chunks fail with status 1, empty stdout and
  `shell: line 1: internal error\n`. The existing Shell input contract uses a
  host-realm Uint8Array check. Foreign workbook prototypes are rejected by the
  domain's existing plain-record admission with command status 1 and
  `Unsupported workbook prototype\n`; SDK conversion rejects with
  `invalid-request`, exitCode 1 and that message. These controls establish the
  rejection behavior, not cross-realm acceptance. Neither shared boundary was
  broadened by this diagnostic-output repair.
- Initial manual probes used invalid harness assumptions: a sync array supplied
  to async-only Shell stdin, an unexported `/core` public import, an incorrect
  expected network diagnostic and a returned-result expectation for a rejected
  SDK conversion. They failed, were investigated and corrected. The first
  screenshot captured the import error; only the corrected screenshot is a pass.
- Full repository `npm test`, repository-wide lint chain/types/workflows, root
  suffix build, E2E, native differential runtime cells, deployed remote backends
  and browser domain execution were not run for this focused adapter repair.
  The selected dependency build is not the full root build. Complete Gnumeric
  parity and all mapped upstream dependency/plugin/locale variants remain
  unverified; the captured profile's blockers/unsupported cases remain active.
  Specifically, both mapped Psiconv attempts are unavailable because unchanged
  released plugin compilation failed; the core-without-file-plugins and
  Paradox-only runtime captures do not qualify successful Paradox conversion.
  Eight of nineteen listed importer cells remain unmeasured, full graph
  renderability/importer usability is unmeasured, inherited custom-directory/
  module-loading mappings and hidden-operation side effects remain partial,
  and dependency parser/patch-set audits remain incomplete. These are retained
  reference-profile limitations, not new measured engine failures or passes.

No README edits, staging, commits, pushes, publication or releases were performed.
Task-owned temporary logs/screenshots were purged after recording final results;
pre-existing oracle/source/QA evidence is preserved.
