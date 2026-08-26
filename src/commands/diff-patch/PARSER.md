# Focused parser repairs

Current utility target: GNU Diffutils 3.12 / GNU patch 2.8. See `GNU-PATCH.md`
for the current default publication, backup, rejection and `--atomic` contracts.
The historical evidence and checkpoint counts below remain historical; they are
not fresh validation of the GNU-default implementation.

## Clean-source followup

The August 26, 2026 post-cleanup checkpoint in `GNU-PATCH.md` supersedes older
runtime observations for the changed implementation: parser regressions pass
80/80, path regressions 619/619, target followup 23/23, and author followups 83/83.
The complete requested five-suite gate is still 928/930, not acceptance; broader
author/pruning failures remain visible there. Global `npm run typecheck` passed
with `--noEmit`; no generated JavaScript shadowed the tested TypeScript sources.

Last format selector wins. Between complete sections, bare descriptive metadata
is scanned through rather than hiding later targets from authorization. This
does not interpret Git rename, copy, binary or mode-change instructions. A
matched hunk behind the consumed output cursor is an applicability conflict and
emits the measured misordered-hunks diagnostic, not a parser-range exception.
Atomic staging rejects orphan deletion payload outside declared hunks; default
GNU scanning can ignore that trailing text. Default partial publication and
explicit nontransactional atomic staging remain distinct.

Selected-path authorization uses the appropriate namespace: preceding actual
results in ordinary execution, hypothetical results in atomic mode, and the
unchanged filesystem in default dry-run. Read-only selection previews use the
same hunk/reversal logic and existing resource/cancellation budgets. Dry-run
does not create targets, auxiliary files or directories; it is not required to
select the same path as an actual create-then-edit invocation.

## Suppressed blank bodies

Normal `<`/`>` and context `!`/`+`/`-` without the usual following
space represent complete empty data lines. Bare context blank lines represent
shared empty data lines only while consuming the declared side range. Existing
count, incomplete-EOF and paired-change checks remain active. Overlapping hunk
coordinates are now judged by GNU placement/applicability in both modes, not
rejected merely by the parser. An old-coordinate zero-range insertion after an
earlier edit can be valid; a genuinely conflicting overlap becomes a hunk reject.

GNU Diffutils 3.12 documents `--suppress-blank-empty` for these formats in its
“Omitting trailing blanks” section. The frozen independent native evidence shows
GNU patch 2.8 rejects its own normal-format generated case; this implementation
intentionally supports the well-defined generated input rather than copying
that native failure. Context suppressed-blank input is accepted by that oracle.

Scope excludes repeated-context selector dialect choices, legacy range policy,
and asymmetric F0 placement. This is not universal GNU/BSD compatibility.

## Physical CRLF transport

Before mail envelope handling, normalize exactly one CR before each physical LF
only if every physical line has that framing. A mixed LF/CRLF stream is left
unchanged, not guessed at. Thus LF-structured patches retain literal CR in file
data; CRCRLF transport retains one data CR. Normalization runs once, never
recursively on nested patch-looking payload. It charges work, checks cancellation,
and bounds line accumulation. Final physical LF is still mandatory. Mail
signatures are recognized after normalization and retain existing trailer limits.

## Mixed format sections

The dispatcher detects each section separately. Unified parsing now exposes an
internal cursor-based single-section entry point, stopping only after all declared
hunk bodies are consumed. Context parsing consumes one file section and its
range-bounded sides; normal parsing consumes consecutive commands as one section.
No scanner searches inside hunk payload for apparent file headers. File/hunk/work
budgets remain shared across formats, with cumulative converted-byte accounting.

The last `-n`, `-c`, or `-u` selector (including long spellings) asserts the format
of each accepted section. With `--atomic`, a later incompatible section prevents
all writes. The default retains completed earlier sections when a later parse
error occurs. Normal sections can use an `Index:` name or explicit TARGET; a
bare `diff old new` line is not a native normal-format filename header. Explicit
TARGET remains the only selected path even for differing authorized absolute
header labels. Default `-R` keeps section order and default dry-run reads the
unmodified filesystem. Sequential hypothetical dry-run and inverse-order
chain reversal now require `--atomic`; those are documented staging extensions.

The historical independent 80-test parser checkpoint reported 75 passes and
five native-oracle failures, with no product issues in its 76 product fixtures.
The native failures remain visible: tab-prefix normal, suppressed-blank normal,
unsafe-integer oracle timeout, generated suppressed-blank normal, and generated
zero-context middle deletion. All seven required valid-input product cases pass.

## Common empty-file flows

`-E` / `--remove-empty-files` requests removal when a section's result is empty;
nonempty results remain files. This composes with dry-run, reverse, and sequential
delete/recreate sections. Without this flag, the existing `/dev/null` and epoch
deletion rules remain unchanged.

Creation from `/dev/null`, including reversed deletion, accepts an existing empty
regular target. The noninteractive default now follows GNU `--batch` reversal
decisions for existing nonempty creation targets and missing deletion targets;
`--force` disables reversal. Missing targets retain exclusive `wx` creation;
existing targets retain bytes/existence revalidation and symlink/hardlink guards.
The existing backend race caveat is unchanged: portable
filesystem calls cannot make cross-file commits atomic or eliminate a concurrent
replacement after validation. A failing backend write may have side effects.

The extended literal-argv GNU patch 2.8 driver passes 156 checks: the original
126 plus six transport/data-CR cases, four mixed sequences, twelve remove-empty
checks, and eight reverse `/dev/null` creation checks (missing/existing-empty,
inferred/explicit target). Every check asserts native status and exact final
bytes/existence before comparing the product. Native calls use isolated working
directories, a three-second timeout and bounded output; no native fallback is
present in shipped implementation. The binary SHA-256 is
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.

Primary semantics references consulted on 2026-08-26: GNU Diffutils 3.12 manual,
“Omitting trailing blanks”, “Multiple Patches in a File”, “Creating and Removing
Files”, and “patch Options”; POSIX `patch` DESCRIPTION and Patch File Format.
These define the intended formats/options, not a claim that GNU accepts every
generated input. Transport decisions are additionally grounded in the exact
native cases rather than a universal CRLF compatibility assertion.

## Historical parser checkpoint

All five parser source hashes match the committed native evidence in
`tests/commands/diff-patch/parser-reference-evidence.json`. Implementation commits:
`f32cf89` (suppressed blanks), `e20bf44` (transport), `7fdfe5c` (mixed sections),
and `6e1240e` (empty-file flows). No README, independent test, diff formatter,
shared contract, root manifest, or other worker's implementation was edited.

| Gate | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| All author `*.test.ts`, GNU whitespace oracle configured | 829 | 0 | 829 |
| Literal-argv GNU reference driver | 156 | 0 | 156 |
| Unmodified independent parser | 75 | 5 | 80 |
| Unmodified independent formats | 1055 | 14 | 1069 |
| Unmodified independent paths | 619 | 0 | 619 |
| Unmodified independent editflows | 31 | 0 | 31 |
| Unmodified absolute-target tests, GNU oracle configured | 30 | 0 | 30 |

All final gates have zero skips/cancellations/TODOs. An initial absolute-target
run omitted `SAFE_BASH_GNU_PATCH` and therefore had two existing native skips;
the complete rerun above supplied it and passed all thirty. No test was weakened.

Parser product expectations pass 76/76; the five raw gate failures are native
failures listed above, including the native-native controls. The format failures
are unchanged: three out-of-scope GNU context-selector profile expectations,
six GNU native-native failures, and five cross-application gates blocked by
incorrect Apple reverse bytes. All 256 independent normal/context parser gates
within that format suite pass. Raw failing gates remain nonzero, not reclassified
as successes or removed from denominators.

Strict scoped TypeScript checks pass for all author TypeScript files and each
of the five independent suite tsconfigs. `git diff --check` passes. There is no
whole-repository test/build claim. Unrelated concurrent changes remain untouched.

Reproduction uses `node --unhandled-rejections=strict --import tsx --test` with
`tests/commands/diff-patch/*.test.ts`, or the relevant independent directory's
`*.test.ts` (independent suites also use `--test-concurrency=1`). Author tests set
`DIFF_WHITESPACE_ORACLE` to the verified GNU diff executable; absolute tests set
`SAFE_BASH_GNU_PATCH` to the verified GNU patch executable. The native driver runs
through `tsx tests/commands/diff-patch/patch-gnu-reference.ts` with
`GNU_PATCH_BINARY` set. Final TAP logs are under `.git/parser-all-author.tap` and
`.git/parser-independent-{tests,formats,paths,editflows,absolute}.tap`; full native
results are `.git/parser-gnu-reference.json`. These are local diagnostic files,
not modifications to the independent frozen evidence.
