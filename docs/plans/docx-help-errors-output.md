# DOCX help, errors and output

Task: `help-errors-and-output` only. Later pipeline tasks remain pending.
The unrelated pipeline edit and archived-plan move are outside this ownership.
No README edits, downloaded fixtures, native reference build, push or release.

## Scope and ownership

- A pure design-system terminal-field escaping leaf and original unit tests.
- DOCX discovery from the existing maintained operation declarations, real
  package metadata, closed result schemas, and the public SDK export.
- Engine discovery dispatch, bounded human/JSON diagnostics, and help-alias
  limit provenance. The safe-bash adapter remains a byte/context delegate.
- Original tests in the existing registered Shell test file; no screenshot tests.
- Narrow status/evidence documentation. No model API or document operation is
  promoted from planned status by this milestone.

Scoped safe-bash instructions require delegation: the adapter owner handled
engine/Shell integration, a design owner authored the escaping leaf, and root
handled discovery, declarations, dependency wiring, checks and delivery.

## Acceptance and red evidence

Original tests established these failures before their respective changes:

1. Discovery had no implementation; real Shell help emitted no output.
2. Human diagnostics ignored admitted 1/16-byte ceilings and silently truncated
   long messages without a marker.
3. Discovery result schemas excluded actual failure envelopes.
4. SDK discovery returned data despite a one-byte output ceiling.
5. `text replace --help` and `-h` dropped lowered output/diagnostic limits;
   passing parsed help to the SDK also lost those limits.
6. Parsed help lost its cancellation signal when passed to SDK discovery.

Evidence logs are disposable local outputs: `/tmp/docx-adapter-focused-red.log`,
`/tmp/docx-help-result-schema-red.log`, `/tmp/docx-help-sdk-limit-red.log`,
`/tmp/docx-help-alias-red.log` and `/tmp/docx-help-alias-sdk-red.log`.
The meaningful regressions are original source tests and need none of these logs.

## Checks and QA procedure

Run maintained package unit/lint checks for DOCX and toolcraft-design, selected
DOCX workspace build closure, existing Shell registration/I/O tests through the
safe-bash reporting route, portable export/bundle tests, and root maintained
unit/lint routes for the dependency boundary. Do not treat skipped profiles as
passes or an earlier failure as a successful full invocation.

Execute actual Shell discovery/error commands with an explicit MemoryFileSystem
and injected engine. Preserve the resulting stdout/stderr/status transcript in
`/tmp/docx-help-qa`, then display those exact transcripts through
`npm run screenshot-poe-code -- --no-header --output ... bash --root
/tmp/docx-help-qa -c 'cat help.txt'`. Repeat for targeted help and errors and
inspect the PNGs. This checks output presentation, not a root DOCX CLI command:
DOCX remains an explicit plugin. No QA script or screenshot test is introduced.

## Verified atomic foundation

The pure `escapeTerminalText` design leaf passed its initial missing-module red
test, then all four original tests. The maintained design package test route
passed 1,716 tests in 82 files and its lint route passed. The selected DOCX
dependency build also built the leaf and passed design export smoke checks.
The explicit leaf export enables source test resolution without changing the
root test resolver or loading the design package's ambient terminal modules.

## Delivery

Pending final verification and local atomic commits. No push or release.
