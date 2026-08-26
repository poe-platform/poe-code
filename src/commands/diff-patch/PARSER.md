# Focused parser repairs

## Suppressed blank bodies

Normal `<`/`>` and context `!`/`+`/`-` without the usual following
space represent complete empty data lines. Bare context blank lines represent
shared empty data lines only while consuming the declared side range. Existing
count, incomplete-EOF, paired-change, and unified overlap checks remain active.

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

An explicit `-n`, `-c`, or `-u` (including long spellings) asserts the format of
every section, not just the first. A later incompatible section rejects the whole
input before filesystem writes. Normal sections still require explicit TARGET.
Existing sequential staging applies sections in input order, or reversed section
order under `-R`; all sections are parsed and preflighted before commit. Explicit
TARGET remains the only selected path even for differing authorized absolute
header labels. The inspected starting implementation already permitted multiple
sections under explicit TARGET; no single-section restriction needed removal.

The unchanged independent 80-test parser checkpoint now reports 75 passes and
five native-oracle failures, with no product issues in its 76 product fixtures.
The native failures remain visible: tab-prefix normal, suppressed-blank normal,
unsafe-integer oracle timeout, generated suppressed-blank normal, and generated
zero-context middle deletion. All seven required valid-input product cases pass.

## Common empty-file flows

`-E` / `--remove-empty-files` stages removal when a section's result is empty;
nonempty results remain files. This composes with dry-run, reverse, and sequential
delete/recreate sections. Without this flag, the existing `/dev/null` and epoch
deletion rules remain unchanged.

Creation from `/dev/null`, including reversed deletion, accepts an existing empty
regular target, but rejects an existing nonempty target before writing. Creation
hunks still require zero old content. Missing targets retain exclusive `wx`
creation; existing targets retain the original bytes/existence preflight and
symlink/hardlink guards. The existing backend race caveat is unchanged: portable
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

## Final focused checkpoint

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
