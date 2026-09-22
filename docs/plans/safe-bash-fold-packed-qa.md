# Ship-fold packed export and documentation QA

## Scope and procedure

Verify the existing private fold implementation and document its admitted profile.
Follow [the archived package pattern](archive/safe-bash-command-package-pattern.md);
the original plan path is deleted in existing checkout edits. Preserve those edits.
This task changes documentation only; it does not change command behavior, shared
packaging, registration defaults or publication configuration.

1. Inspect the fold manifest, public composition wrapper, parser, engine and
   invocation adapter. Confirm private ESM ownership, empty runtime dependencies,
   explicit locale/limits, VFS-only byte I/O, awaited writes and cleanup.
2. Fetch the released coreutils 9.10 archive explicitly for research, verify
   SHA256, and read `src/fold.c`, the fold manual section and all five release
   test files. Read the development source/manual at the supplied revision.
   Do not execute a native fold or infer ambient locale behavior.
3. Run maintained fold workspace unit/lint routes and the selected safe-bash
   build closure. Run repository package lint. Shared production/build changes
   would additionally require complete repository test/lint routes.
4. Stage with `scripts/package-safe.mjs`, then `npm pack --ignore-scripts` the
   public SafeFS, SafeJS and safe-bash artifacts. Install only public tarballs
   offline with scripts/workspaces disabled into a fresh consumer. Include local
   declaration-only Node/undici type support; install no private workspace.
5. Copy maintained consumer fixtures. Run `safe-packages-fold.mjs` under default,
   browser and workerd conditions, denying resolved file imports outside the
   consumer. Initialize Node web constructors before removing Buffer in the
   portable cells. These cells test export resolution on Node, not those engines.
6. Compile `safe-packages-fold-types.mts` in strict ES2023 NodeNext mode for all
   three conditions, without `skipLibCheck`, with exact optional properties and
   unchecked indexed access enabled. Use consumer-local type roots.
7. Run installed smoke and registration fixtures. Audit JS/declaration module
   references with the maintained AST rewriter and verify bundled LGPL notices
   and modified width-table source. Record tarball/source digests.
8. Generate and inspect the actual CLI help screenshot with
   `npm run screenshot-poe-code -- --help --output <temporary-path>`.
   Render the package Markdown through the existing design renderer and inspect
   generated document PNGs. Purge task-owned temporary artifacts afterward.

## Executed local receipt, 2026-09-19

Checkout HEAD: `35d01c57f8078d8afa916dc59929395d857e9c55`, with pre-existing
uncommitted implementation/integration edits preserved. Runtime: Node v22.22.2.
This qualifies the live checkout, not a committed archive or published release.

- `npm run test:unit --workspace=safe-bash-command-fold`: 68 passed, zero failures,
  skips or cancelled cases. Existing memory-only tests cover released fixtures,
  boundaries, controls, invalid bytes, long zero-width input, budgets, cross-realm
  ownership, CLI/SDK equivalence and cancellation/cleanup.
- `npm run lint --workspace=safe-bash-command-fold`: passed, including production
  and test TypeScript checking.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed its
  maintained 16-build closure and native postbuild events.
- `npm run lint:packages -- --quiet`: all 18 rules passed across 83 packages.
- Fresh isolated installed fold runtime: passed default/browser/workerd cells.
  Portable cells had no global Buffer. The fixture verifies real Shell commands,
  streaming SDK, canonical contract identity, cross-realm inputs, mutable SDK
  operand ownership and caller cancellation during producer cleanup.
- Strict installed fold declarations: passed all three condition cells. Neither
  `safe-bash-command-fold` nor `safe-bash-contracts` was installed.
- Installed maintained smoke and registration fixtures: passed, including
  existing realm, replay, identity and resource checks. This is not a new exhaustive
  replay qualification.
- AST audit: 1,256 JS/declaration files and 3,534 module references; no bare private
  command/contracts imports. Public fold runtime/declarations resolve inside the
  installed artifact. Bundled fold LICENSE, COPYING, COPYING.LESSER and modified
  `width-data.ts` were present under `dist/safe-bash-command-fold`.
- Installed unknown-locale probe: status 1, empty stdout and
  `fold: Unavailable locale profile: unavailable` on stderr. README distinguishes
  initial admission diagnostics from exceptions during streaming.
- CLI help and package Markdown PNGs inspected. The screenshot font lacked CJK
  glyphs in the first example rendering; Unicode escapes now express the same
  input/output without missing glyphs. Final example, flag/limit tables, runtime
  profile and corrected error paragraph are readable. No screenshot tests added.
- `git diff --check`: passed. Full repository `npm test`/lint were not rerun for
  this documentation-only task; earlier broad-gate receipts are not fresh passes.

Reverified GNU archive SHA256:
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Released fold source SHA256:
`579245402394706b2e75909991bb6379d17c814611c7d24367c5c94df938d25d`.
Development `b25722854370b8206d7f53f8934c36710cdd9974` fold source SHA256:
`0172cb5af864c0f75eacce93778c1b72510869a2d333c9c4b9a7d1458c77e3a9`.
Release uses `c32isblank && !c32isnbspace`; development uses `c32issep`.
Both decode multibyte input in byte mode and retain prior character width across
LF/file boundaries. Release finite-buffer flushes add no LF. These are
source-derived findings; no native executable or host-locale oracle ran here.
User-supplied native controls retain their separate authority in the acceptance
plan. Checked underflow and pinned table profiles remain explicit qualifications.

| Public local tarball | SHA256 |
| --- | --- |
| Safe Bash | `d0ae5a2eddcc657f06ce2788b46bec5f188cbccb925b3ce7f7ef958b357f9db4` |
| SafeFS | `8f3328f08559a49322d6796490cbcbeeaa7c391cc990add4893bcf5b500ef934` |
| SafeJS | `5b66d02b8af0bee73d9d14391b16161a72cf2437cbf2837bc22bce0a8993bb2e` |

The 14-member inventory of fold `src/*.ts`, its manifest and public wrapper,
hashed as sorted relative path + NUL + binary SHA256(file), is
`bf17bed39b3fbef27e77fc167e9480b05eb6851603dae2fbb90e6ac13ae6e26f`.

An initial audit completed its module/hash checks but then attempted an incorrect
`_private` directory path and failed with ENOENT. The corrected complete audit
above found the actual `dist` asset paths and passed. A screenshot inspection
also requested a nonexistent third page; both actual pages and the final changed
paragraph were subsequently inspected. Neither failure prompted production edits.

Absolute `/out` refused creation because it is read-only. Task-owned evidence
used ignored `out/ship-fold`; temporary consumer, tarballs, screenshots and staging
were purged after review. Actual browser/workerd engines and Bun were not executed.
Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push or package publication occurred; the command package remains private.

## Independent final review, 2026-09-19

Rechecked the live task diff without changing production code or other
contributors' edits. Reviewed parsing, decoding, separator/remainder handling,
checked column arithmetic, owned byte views, invocation budgets, file errors,
awaited output and reentrant cancellation/cleanup. The public wrapper only
re-exports the private implementation. No validated compatibility defect,
unsafe host access or test-supported simplification was found; no unresolved
finding blocks this scoped verification.

Fresh maintained checks passed: all 68 fold unit tests, fold lint/typecheck,
the selected safe-bash build closure and all 18 package-lint rules. Fresh public
tarballs installed offline with scripts/workspaces disabled and optional peers
omitted. A consumer import hook refused file resolution outside the consumer;
Node and undici declarations were copied into consumer-local type roots.
Fold runtime and strict declarations passed default, browser and workerd
conditions; portable runtime cells removed global Buffer after initializing web
stream constructors. Registration and public smoke fixtures also passed.
An AST audit found 1,256 JS/declaration files and 3,534 module references with
zero private imports; the installation contained zero private command/contracts
packages. All four fold attribution/table assets were present.

Re-fetched and hash-verified the GNU 9.10 archive, read its fold source, manual
and all five tests, and compared the supplied development source/manual.
No native utility or ambient-locale oracle executed. CLI help and both rendered
README pages were inspected. Actual browser/workerd engines remain unqualified.
Full repository test/lint routes were not rerun: this review changes only this
Markdown receipt, while shared implementation edits predate the review.

Fresh local tarball SHA256 values:

| Public artifact | SHA256 |
| --- | --- |
| Safe Bash | `ede08a9aa2e8ae69a918cde76ac302aea70a18adf8e175fe42b6180081a6ba9f` |
| SafeFS | `ca50528c87ae137699f61f56239709b0690dc69ec9c2c66951cb664cdf590af2` |
| SafeJS | `08464a8381842594a7b1f9a0ad2fe377ceb5e0c6e53da0ff2d2348f22d1cd687` |

The first supplemental registration attempt lacked a transitive fixture; after
copying the maintained fixtures it passed. A separate attempt used the wrong
working directory for the import hook and was rerun from the consumer. Initial
archive extraction used obsolete test paths; the five actual `tests/fold` files
were subsequently extracted and read. These were verification setup failures,
not command defects. Task-owned `out/ship-fold-review` evidence was purged.
Local commits: none. Remote-main delivery: none. Successful releases: none.

## Current-candidate repeat verification, 2026-09-19

Executed the procedure above on Node v22.22.2 at the same checkout HEAD.
The current 14-file source/manifest/wrapper inventory SHA256 is
`5e86768e8f84345a837c95dc4f25c1203caf7f755752019b6026cebb556ad96f`.
Only documentation changed in this execution: the README now explicitly
distinguishes invalid `FF` preservation from native signed-char EOF collisions.

- Passed: 68 fold unit tests, zero failures/skips/cancellations; fold lint and
  both typechecks; maintained safe-bash 16-build closure; 18 package-lint rules.
- Passed: fresh offline public-tarball installation, isolated fold runtime and
  strict declarations in default/browser/workerd conditions. Portable runtime
  cells removed Buffer. No private fold/contracts package was installed.
- Passed: maintained installed smoke/registration fixtures, including their
  existing original/replay and realm controls. No new replay behavior changed.
- Passed: independent installed NBSP output, five invalid-option forms,
  unavailable-profile rejection before input/VFS acquisition, and exact C versus
  UTF-8 byte-mode controls. No native utility executed.
- Passed: AST audit of 1,256 JS/declaration files and 3,534 references, with no
  bare private command/contracts imports; all four fold license/table assets.
- Passed: released archive/source hashes rechecked; released and development
  fold sources/manuals and all five released test files read. CLI help and both
  rendered README PNGs inspected; `git diff --check` passed.
- Setup failures: absolute `/out` is read-only, so evidence used task-owned
  ignored `out/ship-fold-current`; an import-hook launch used the checkout cwd
  initially, then passed from the consumer. A tool-call syntax error executed
  no verification. No test/runtime failure or timeout remained.
- Not run: full repository test/lint/build gates for this documentation-only
  execution. Actual browser/workerd engines, arbitrary libc locales, native
  diagnostic parity and missing complete native state transcripts remain
  unverified, as specified in the acceptance plan. No performance benchmark ran.

Local public tarball SHA256 values:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `0f137e8ba85ec4df0deed77e332e57c432fcb6d14a6193495c955d0e5470ecdc` |
| SafeFS | `cf98b5021e2d8926f180db613b6b6e0bd1306b8f3d4a17751c1d36773a7fe013` |
| SafeJS | `34748170dcc0879317096adc160ea9b332252042acca4b1f6f4ccaebac5a60e2` |

Task-owned temporary evidence was purged after inspection. Local commits: none.
Remote-main delivery: none. Successful releases: none. Private package publication:
none.
