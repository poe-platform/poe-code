# htmlq command wiring review

Reviewed 2026-09-21. The implementation and integration already existed in the
working tree. This review changes only htmlq argument handling, its memory-VFS
regression controls, its installed-consumer fixture and its documentation.
Unrelated workspace, publication, workflow and command edits are preserved.
The package-pattern document is currently at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its original path was
already deleted before this task.

## Validated finding and repair

`htmlq -f --unknown` swallowed the unknown flag as a filename and returned VFS
status 1. The new command test failed with actual 1 versus expected argument
status 2 before implementation. Separate option values now reject leading
flags and `--`, while the literal `-` sentinel remains accepted. Attached values
remain literal. Typed SDK values use attached long options, preserving literal
leading-dash paths without treating them as flags. Synthesized SDK strings are
admitted against token/allocation ceilings before construction. CLI and SDK
regression controls compare output, diagnostics and statuses.

## Review and verification

- All 125 htmlq package tests passed; no skips or failures. Tests use memory
  streams/VFS and mocked capabilities, without native or LLM calls.
- Package ESLint and source/test TypeScript checks passed after the final edit.
- Nine focused private-build and publication-policy tests passed.
- The maintained explicit safe-bash workspace build closure passed after the
  final code change, including guarded compilation and native npm postbuild.
- The maintained safe-library packer produced all three public artifacts,
  including bundled htmlq implementation and rewritten declarations.
- Only the three public artifacts were npm-packed and installed into an
  outside-checkout consumer, with scripts/workspaces disabled. The htmlq runtime
  fixture and strict NodeNext declaration fixture passed. `npm ls --all` passed
  and showed no private command/contracts workspace installation.
- Installed runtime controls cover canonical command identity, absent default
  registration, explicit plugin registration, lazy removal, CLI/SDK parity,
  protected same-file VFS publication, unknown flags and literal leading-dash
  SDK paths. The packer's unpublished-specifier checks passed.
- An adhoc screenshot from the maintained screenshot runner was inspected:
  text and attribute queries returned their expected lines/status 0, and
  `-f --unknown` displayed `htmlq: E_ARGUMENT` with status 2. Temporary consumer,
  artifacts, tarballs and PNG were removed after inspection.

The reviewed command remains private, TypeScript ESM and dependency-free at
runtime. Safe-bash only exports/composes it. No default registration change,
host executable, ambient filesystem, fetch, dynamic dependency download or
native/WASM fallback was found in command runtime source. Owned output cleanup
is registered before acquisition; writes and cleanup are awaited. Existing
controls exercise cancellation, pending/late producer reads, foreign realms,
producer ownership, falsey failure preservation and cumulative resource limits.
No persisted snapshot/version contract changed. No test-supported unnecessary
abstraction or proxy-only function was found that needed removal.

The initial directory-install dependency inventory reported npm's file-directory
dependencies as invalid despite passing runtime/types. Reinstalling actual
public tarballs resolved that QA failure; the final runtime/types and dependency
inventory all passed. An attempted repeat pack into existing output directories
failed with EEXIST; removing only this task's generated artifacts and regenerating
resolved it. Neither failure required a product or policy change.

## Unresolved qualification

Full HTML5 recovery, complete legacy selector and Clap grammar, Rust URL
normalization and every pretty/direct writer state remain unqualified, as
recorded in the existing engine/behavior reviews and package README.
`htmlqBaseline.fullHtml5Parity` remains false. Enumerated controls and successful
wiring do not close those findings; they block a claim of complete upstream
compatibility. No additional unresolved wiring defect was found in this review.
No full repository lint/test gate was claimed: production changes were confined
to this command, with shared build/export implementation preserved.

No local commit, remote-main push, release or private-package publication was
performed.
