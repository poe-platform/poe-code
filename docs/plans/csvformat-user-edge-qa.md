# Independent csvformat user edge QA

Exercise the literal executable through safe-bash shell registration, with the
explicit UTF-8 codec, noninteractive terminal, UTC clock and locale bindings.
Canonical tests use MemoryFileSystem and in-memory byte producers. No native
program, database, network, host file or LLM participates in canonical execution.

## Procedure

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvformat-user-edge.test.ts`.
2. Check exact stdout bytes, stderr and exit status for supplementary Unicode
   delimiters/quotes and rejected multiple-codepoint delimiters.
3. Feed one byte per input chunk, splitting UTF-8 BOM, multibyte cells and CRLF.
   Check source-compatible embedded CRLF normalization and producer finalization.
4. Supply a virtual filename and a stdin producer that throws if read. Redirect
   output in VFS; check untouched input bytes, converted output and zero stdin reads.
5. Compare raw ragged rows with the typed `-U 2` path: short typed rows are padded,
   while overwide typed rows fail before emitting the header.
6. Check runtime output modes 4/5 retain raw literal empty/text/numeric strings.
7. Check typed Decimal spelling, scientific notation, special numbers, number
   formatting, Unicode digits and null/text inference against frozen observations.
8. Check arbitrary terminator characters require escapes in mode 3 and a single
   empty field emits the source error after preserving completed rows.

## Executed evidence

The restored reference at `out/csvformat-user-reference/bin/csvformat` reported
csvkit 2.2.0, using the root-authenticated CPython 3.14.2/hash-locked profile.
Every distinct stdin-based observation in steps 2, 3, 5, 6 and 8 was compared
against this reference with exact stdout/stderr/status: nine observations match.
A further 31-case number/text/null inference cohort matched exactly, with zero
mismatches. Fourteen representative observations are retained in the canonical
test. Temporary native research capture belongs in out and is purged by root.

Step 4 verifies injected-filesystem integration and borrowed stdin ownership;
it is source-supported integration evidence, rather than proof about host
filesystem adapters. Seven canonical tests pass. No product change was needed
for these cases. The independent agent did not change integration exports or Git.

## Explicit limits

This focused cohort is not full csvkit qualification. Existing input modes
2/4/5, Agate duplicate/unnamed-header warning provenance, locales other than
en_US/de_DE, verbose deployment tracebacks and other unmeasured cases remain
explicit blockers in docs/csvkit/csvformat-validation.md. Rejection tests for
unsupported modes establish honest rejection and do not establish parity.
No remote database/backend or terminal screenshot qualification is claimed here.
