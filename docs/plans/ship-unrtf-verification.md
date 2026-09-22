# ship-unrtf verification

Reviewed the current working tree on 2026-09-20, preserving unrelated edits.
The requested package-pattern document is currently at
[its archived location](archive/safe-bash-command-package-pattern.md).
This task edits only the private command README, the existing Safe Bash support
row and this receipt. No runtime, export map, build logic or registration changed;
no code change required a new TDD cycle.

## Markdown QA

1. Inspect the private package manifest, source contracts/engine/command APIs,
   Safe Bash composition export and maintained packaging/declaration rewrites.
2. Run `npm test --workspace=safe-bash-command-unrtf` and
   `npm run lint --workspace=safe-bash-command-unrtf`.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`, then
   `node --import tsx --test` on Safe Bash's `unrtf-boundaries.test.ts` and
   `unrtf-compatibility.test.ts` plugin integration files.
4. Stage with `node scripts/package-safe.mjs --out-dir <task-output>/stage
   --version 0.0.0-ship-unrtf-review`. Pack only staged public SafeFS, SafeJS and
   Safe Bash using `npm pack --ignore-scripts`.
5. Install those tarballs offline into a fresh consumer outside the checkout,
   with scripts/workspaces/optional dependencies disabled. Assert private
   unrtf/contracts packages are absent. Execute `safe-packages-unrtf.mjs`
   normally and with Node's browser/workerd conditions. Compile
   `safe-packages-unrtf-types.mts` with strict NodeNext, exact optional properties,
   unchecked indexed access, ES2023 and Node types, normally and with matching
   browser/workerd custom conditions; do not skip library declaration checking.
6. Inspect the actual packed subpath targets. Parse shipped JS/declarations with
   the TypeScript AST, rejecting bare private command/contracts import/export,
   import-type and dynamic import/require references.
7. Bundle a public-only Shell/unrtf VFS conversion with esbuild's browser platform
   under browser/workerd conditions. Execute each in a Node VM with explicit web
   capabilities and no process, Buffer or require. Qualify this as a graph/realm
   check, not execution in an actual browser or workerd engine.
8. Check the documentation diff and remove task-owned temporary evidence.

## Fresh results

- Private package unit route: 79 passed; zero failures, cancellations or skips.
- Package lint: ESLint and production/test TypeScript checks passed.
- Maintained selected Safe Bash build closure passed, including npm postbuild.
- Focused integration: four passed; zero failures, cancellations or skips.
- Public-only offline consumer runtime and strict declarations passed under
  Node, browser and workerd conditions. Private unrtf/contracts were absent.
- Installed fixture verified binary suffix preservation, Unicode extraction,
  native-legacy refusal, strict escaped/styled HTML, canonical runtime identity,
  opt-in registration, VFS `.rtf` retry, literal operands, unsupported options
  and CLI/SDK output/status parity.
- Packed subpath targets: `./dist/safe-bash/commands/unrtf/index.js` and
  `./dist/safe-bash/commands/unrtf/index.d.ts`. Implementation and declarations
  are bundled inside the public package; no unpublished package is required.
- AST inspection of 1,284 shipped JS/declaration files found no bare private
  command/contracts references.
- Browser/workerd browser-platform bundles passed the VFS Shell conversion in
  VM realms without process, Buffer or require. The initial test realm lacked
  `performance`; a second setup paired host TextEncoder with foreign typed-array
  constructors, which MemoryFileSystem rejected. Final setup supplied performance,
  queueMicrotask and matching Uint8Array/ArrayBuffer plus encoding, cancellation,
  URL and timer capabilities. These were harness setup failures; no product
  assertions, implementation or deadlines changed to obtain the final passes.
- Manifest remains `safe-bash-command-unrtf`, `private: true`, TypeScript ESM,
  empty runtime dependencies. Safe Bash only composes/exports the command.
- README now includes commands/examples, the exact accepted flags and defaults,
  byte outputs/statuses, strict/native deviations, codec availability, budgets,
  cancellation/cleanup and VFS redirection publication limits.

Candidate tarball SHA256 receipts (local artifacts, not a Git/release identity):

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `419631c93c20a180ea67eb8270721a59e4651b76ba3c9769578ef52e99ebec83` |
| SafeFS | `d6ca36350fd4cbd9928ee2c70c706f135fad1676180a5bf07f5f7c90ffb43dac` |
| SafeJS | `d34970c748ed1834773e5fedff3428e89cd4e500097e2e9ef2b8a79cb26ba901` |

Tarballs preceded final README-only compaction. No host unrtf executable or
native oracle was invoked. Supplied native/source observations remain upstream
qualification evidence, not new measurements by this task.

## Qualification boundaries

GNU personalities and order-sensitive configuration flags, legacy Unicode/byte
projection, full native codec/charmap coverage, VFS picture exports and
nested/merged tables remain unimplemented. The pinned `unrtfBaseline` explicitly
sets native personality compatibility false. Upstream seek and decoder data-loss
bugs are not permissible compatibility optimizations. See
[safe-bash-unrtf-task-review.md](safe-bash-unrtf-task-review.md) and
[compatibility-unrtf.md](compatibility-unrtf.md) for remaining admission cells.
This task verifies packed delivery of the admitted strict profile; it does not
complete those native compatibility gates.

Actual browser/workerd engines were not exercised. No whole-Safe-Bash
zero-external-runtime-dependency claim follows from this leaf package's empty
dependencies. Full repository test/lint routes were not run: edits were scoped
to documentation, with no shared implementation changes. No CLI appearance or
document-rendering implementation changed, so new screenshots were not required.
`git diff --check` passed for the task files.

Absolute `/out` is read-only on this host. Task-owned ignored `out/ship-unrtf`
and the isolated temporary consumer were purged after capture.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or public/private publication was performed.

## Fresh follow-up review, 2026-09-20

Re-read command, budget, tokenizer, extraction, rendering and composition sources.
No runtime simplification was made: public typed aliases preserve API signatures;
registration and output-operation ownership are substantive adapter behavior.
No host access or new dependency was found in the command implementation.
Existing tests cover cancellation during pending input/output, source return,
cleanup failure preservation, reentrancy and retained-budget rollback.

Fresh maintained checks passed: private workspace `npm test` (79/79), workspace
lint including both TypeScript checks, selected Safe Bash workspace build closure
including postbuild, and both focused integration files (4/4). No tests skipped.
The final pack stage followed completed build/postbuild; an earlier overlapping
stage was discarded from qualification. Only public SafeFS/SafeJS/Safe Bash
tarballs were packed and installed offline with scripts and optional dependencies
disabled in an OS temporary consumer outside the checkout.

The maintained unrtf runtime fixture and strict NodeNext declaration fixture
passed under Node, browser and workerd conditions. Declaration checks enabled
exact optional properties and unchecked indexed access without skipLibCheck.
Private unrtf/contracts installations were absent. An AST scan of 1,283 packed
JS/declaration files rejected bare private command/contracts references and passed.
The packed unrtf types/import paths match the paths above. These condition checks
do not establish execution in actual browser/workerd engines. Earlier VM evidence
was not re-executed in this follow-up.

Additional validated unresolved finding: the inert destination set recognizes
exact `header` and `footer`, but not `headerl`/`footerr` (nor a complete variant
inventory). A memory-byte stream `{\\rtf1 BODY{\\headerl LEFT}{\\footerr RIGHT}}`
rendered as `BODYLEFTRIGHT`, status-success iteration. The package README now
qualifies this behavior instead of claiming all headers/footers are skipped.
This is an unresolved admission cell; documentation does not fix extraction.
The previously listed personality, codec, picture and table findings also remain
blocking. Thus packed-export verification passed, while overall admission/task
completion remains blocked. No full-native compatibility or release is claimed.

Only README wording and this receipt changed in this follow-up. No executable
code or rendering implementation changed; no TDD code cycle, repository-wide
gates or screenshots were required for these documentation edits. Safe Bash's
existing support row links the exact command contract. Tarballs preceded the
final README clarification; runtime and declarations did not change afterwards.
Task-owned ignored `out/ship-unrtf-followup` and the external consumer were purged
after verification because absolute `/out` is unavailable on this host.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or private/public publication was performed.

## Current candidate recheck, 2026-09-20

Executed the Markdown QA above against the current candidate using Node 22.22.2.
The only new package documentation change identifies the pinned archive hash
and explicitly separates source provenance from personality support. Existing
Safe Bash usage/support already documents the exact flags and links this contract.
No runtime, export, build or rendering code was changed by this recheck.

- Maintained private workspace unit route: 79 passed, zero failures or skips.
- Maintained private workspace lint: ESLint and both TypeScript checks passed.
- Selected maintained Safe Bash build closure and postbuild: passed.
- Both focused CLI/SDK integration files: four passed, zero failures or skips.
- Fresh public-only packed consumer: runtime and strict NodeNext declarations
  passed under normal, browser and workerd conditions. Declaration checking
  included exact optional properties, unchecked indexed access and library checks.
  Neither private unrtf nor private contracts was installed.
- AST inspection: 1,284 shipped JS/declaration files passed the bare-private-
  dependency check. Both packed unrtf export targets exist at the paths above.
- Browser-platform bundles under browser/workerd conditions passed VFS Shell
  conversion in explicit-capability VM realms without process, Buffer or require.
  These qualify conditional graphs and realm execution, not actual browser/workerd.

The first offline consumer install failed with `ENOTCACHED` for Node typings
22.19.15. A scan attempted before installation consequently failed with `ENOENT`.
Both setup failures were resolved by installing cached typings 25.9.4 (matching
the checkout), then rerunning all consumer checks and the scan successfully.
No product failure, assertion or deadline was changed.

Fresh Safe Bash tarball SHA256:
`9cc9a44a4e3d7afbf1dd75fe5a5409b2aff49246edf86e5908b90ba7681a3398`.
This is a local artifact receipt, not remote-main or release evidence. The pack
includes the current README provenance addition. Existing unsupported native
personality, codec, picture and table admission cells remain unchanged.

Full repository routes were not run for this documentation-only change.
CLI/document screenshots were not applicable: no CLI or document rendering
changed. Native oracle execution, actual browser/workerd, and original/checkpoint/
replay qualification were not performed; none is counted as passed. The archived
package-pattern document was followed without restoring its unrelated deletion.
Task-owned evidence used ignored `out/ship-unrtf-current` because absolute `/out`
is unavailable; staged artifacts and the external consumer were purged after
this receipt. Local commits: none. Remote-main delivery: unverified. Successful
release: none. No private or public publication or push was performed.
