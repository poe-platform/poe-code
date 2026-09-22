# htmlq candidate verification

Candidate base: `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with the existing
uncommitted command/build integration preserved. Execute these steps against
the final working-tree candidate; base HEAD alone does not identify its source.

1. Check the private ESM package, composition-only public export, qualified
   build profile and unchanged default registration. Follow the package pattern
   at `docs/plans/archive/safe-bash-command-package-pattern.md` (the original
   path was already deleted). Inspect runtime imports for host/native/network
   capabilities.
2. Reproduce duplicate singleton option acceptance with memory-VFS CLI/SDK
   tests. The pinned upstream `src/main.rs` derives Clap options without
   self-overrides: scalar/bool options are singleton; only attributes and
   removal selectors use vectors. Test grouped and mixed short/long duplicates,
   no VFS reads on rejection, deterministic stderr, and ordered repeatable
   options. Run the regression before and after the repair.
3. Run the htmlq workspace unit and lint routes, the maintained explicit
   safe-bash build closure, and focused private-build/publication tests.
4. Stage with `scripts/package-safe.mjs`, npm-pack only the three public safe
   artifacts, and install those tarballs outside the checkout with scripts and
   workspaces disabled. Run the installed htmlq runtime and strict NodeNext
   declaration fixtures. Check that no private workspace was installed.
5. Manually exercise text/attribute precedence, duplicate rejection and
   repeatable attributes from an installed Shell with explicit htmlq plugin
   registration. Capture and inspect a terminal screenshot using the maintained
   screenshot runner. No screenshot tests or standalone QA script.
6. Record failures, skips, runtime qualification limits and delivery separately;
   purge task-owned temporary evidence. `/out` is read-only on this host, so
   temporary evidence uses ignored `out/htmlq-candidate-verification` and an
   outside-checkout temporary consumer.

No shared production build logic or registration changes are intended. Broad
repository gates and actual browser/workerd/Bun runtime qualification must not
be inferred from the focused checks. Existing full HTML5/selector/URL parity
limitations remain open. No commit, push or publication is requested.

## Executed receipt, 2026-09-21

- The new duplicate regression failed before the repair (actual status 0,
  expected 2); 126 other tests passed. Final workspace unit route: 127 passed,
  zero failures, cancellations or skips. Source and test TypeScript plus ESLint
  passed. The nine focused private-build/publication tests passed.
- The maintained explicit safe-bash build closure passed after the final source
  edit, including guarded build and native npm postbuild. Shared cache was used;
  this is not an uncached whole-repository build receipt.
- Final public tarballs installed offline outside the checkout, with scripts
  and workspaces disabled. Installed htmlq runtime and strict NodeNext types
  passed. `npm ls --all` passed with no private command/contracts installation.
  The packer admitted the qualified owner and checked private specifier rewriting.
- Manual installed Shell checks and inspected screenshot passed: text-node LFs,
  attribute precedence/order, grouped/attached options, and both grouped/mixed
  duplicate diagnostics and status 2. The generic maintained screenshot runner
  was used because this command registers inside Safe Bash rather than the
  top-level poe-code CLI. No visual code was changed.
- Runtime source inspection found no executable, network, ambient filesystem,
  native/WASM or dynamic-download dependency. Existing tests covered byte
  ownership, foreign realm input, cancellation, cleanup failure preservation,
  ceilings, atomic rollback and BOM boundary invariance. Original serialization
  controls passed; persistent checkpoint/replay contracts were unchanged and
  were not separately exercised.
- No outstanding failure in the focused routes. `/out` creation failed because
  the host root filesystem is read-only; ignored local evidence was used and
  purged. Full repository lint/unit/build, actual browser/workerd/Bun engines,
  native duplicate-option execution and full upstream compatibility were not
  run or counted as passes. Native duplicate semantics were checked against the
  pinned source configuration, not a newly executed native binary.

Source/build/fixture SHA256 is
`4d609e8fb0845f934f4c1051f00ccaca19609edb968e2edbc5be0fa5b7bf0596`.
Reproduce by lexically sorting htmlq `src/*.ts`, its manifest, the public htmlq
wrapper, the safe-bash manifest, bundle/packer scripts and the two installed
htmlq fixtures; hash each relative path, NUL, file bytes, NUL in that order.

Public tarball SHA256 receipts (version `0.0.0-htmlq-candidate`):

- Safe Bash: `e7f4f7a482af2dd7de4faeebd36cceda73eb88d5120712a9e69f1b444ad86bf2`.
- SafeFS: `74ae2cc9fcc86d580f94a87a5d76425266b483da5b9c361862eee099685b8773`.
- SafeJS: `87aa0c10b504be50076c6a092becf3f030d5247047bbe2ff1e242de536574893`.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No standalone private-package publication occurred.
