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
