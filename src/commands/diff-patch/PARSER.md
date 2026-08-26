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
