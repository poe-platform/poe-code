# command-soffice review — 2026-09-20

Reviewed the current working-tree command workspace, composition export, manifest,
consumer fixtures and archived package pattern. The requested pattern document is
currently at `docs/plans/archive/safe-bash-command-package-pattern.md`; its move and
other contributors' edits were preserved.

## Validated fix

An original failing regression demonstrated that `parseCsvExportOptions` accepted
supplied options and allocated a split token array with `retainedBytes: 0`.
The parser now scans and counts tokens with work accounting, reserves token/text
and result storage before splitting, and releases its reservation on failure.
Successful reservations remain invocation-owned until budget close, conservatively
covering returned encoding text. Numeric validation now scans directly instead
of allocating a character array. Tests cover rejection before allocation and
rollback without releasing earlier caller reservations. The sheet preflight test
still verifies exact path-byte accounting, measured after parser reservations.

No host capabilities, dependencies, public signatures, output strings or source
revision were changed. Existing CSV legacy/modern semantics, Unicode admission,
UTF-16/UTF-8 serialization, byte ownership, budgets and cancellation tests pass.
No CLI visual change was introduced by this parser-only correction.

## Command and export assessment

The private `safe-bash-command-soffice` package contains actual CommandDefinition,
plugin and typed SDK implementations. Its manifest has no external runtime
dependencies. Safe Bash's soffice entrypoint is a composition-only re-export;
registration remains opt-in. Command source uses local modules and admitted
first-party contracts, with no host execution, ambient files, implicit network,
native/WASM fallback or dynamic dependency downloads.

The handler registers cleanup before acquiring output operations, awaits output
writes and passes its cancellation signal. Existing tests exercise backpressure,
external cleanup, cancellation, cleanup idempotence, diagnostic exhaustion and
literal/byte argument admission. Ordered SDK arguments use the same parser;
structured conversion admission matches the CLI's deterministic unsupported result.
Help/version are functional. Unlike the earlier engine task review, the current
candidate does have an executable handler; it does not perform conversion.

## Verification

- Original added regression failed with “Missing expected exception” before fix.
- `npm run test:unit --workspace=safe-bash-command-soffice`: 51 passed.
- `npm run lint --workspace=safe-bash-command-soffice`: ESLint and production/test
  typechecks passed.
- `npm run build:workspaces -- --workspace=safe-bash-command-soffice`: maintained
  dependency closure passed, including safe-fs and canonical contracts builds.
- `node --import tsx --test packages/safe-bash/tests/plugins/soffice-wiring.test.ts`:
  two passed using memory VFS and mocked network.
- `git diff --check`: passed.

## Unresolved findings blocking completion

Every Office conversion is rejected before stdin/VFS access. There is no admitted
import/export engine, enforced staging/publication lifecycle or loss-preserving
layout implementation. Thus conversion success/failure parity, conversion-time
cancellation, stdin consumption, overwrite/progress output and transactional
cleanup remain unqualified. CSV text serialization and path preflight do not
constitute workbook conversion.

DOCX/ODF/PPTX/XLSX preservation, formula evaluation, deterministic PDF JSON/settings,
licensed versioned fonts, cluster shaping, pagination, table/footnote retries,
notes/hidden-slide numbering, work-bounded convergence and original geometry/
screenshot acceptance remain open. PDF/A and PDF/UA standards require independent
qualification. The pinned source revision remains
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`; the installed manifest is separate.
Blocked pre-main native controls establish no conversion or global exit-status
parity. Adapter exit results must not be represented as qualified native semantics.

Existing engine-contract receipts describe earlier installed candidates; this
review's selected workspace build and source integration tests do not renew
packed-consumer/declaration/runtime qualification for the current candidate.
The documented external dependencies in whole Pandoc/PDF/Office closures cannot
be admitted by silently bundling third-party source. The command's empty runtime
dependency manifest does not establish whole-artifact independence.

These findings prevent marking the task complete. Local commits: none. Verified
remote-main delivery: none. Successful releases: none. No command publication
was performed.
