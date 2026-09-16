# LaTeX input: bounded TypeScript profile

`latex` input is implemented in packages/pandoc and automatically available through
the existing SDK and safe-bash command descriptor. The original parser tokenizes
control words/symbols, comments, whitespace, groups, optional groups, environments,
math delimiters and verbatim regions. It does not call any native converter or TeX
runtime. No new environment variables or CLI arguments are introduced.

## Supported projection

- Fragments and document environments become block sequences. Document class,
  class options, title, author and date are retained as metadata. Maketitle creates
  a title-block Div. No class/package code is loaded.
- Part/chapter/section use level 1; subsection through subparagraph use levels 2–5.
  This is a fixed outline profile, without TeX class-dependent numbering. Stars
  become an unnumbered class and optional titles remain short-title attributes.
- Blank lines and par split paragraphs. Groups preserve internal whitespace;
  comments consume their terminating newline. Escaped braces/dollars/percent,
  emphasis, bold, small caps, underline, texttt, footnotes and a fixed Unicode/
  combining-accent command dictionary are supported. No ligature/font/language
  package interpretation is claimed. Accent arguments are one scalar or a group.
- Itemize/enumerate/description and quote/quotation map to typed lists and quotes.
  Optional item labels are retained as text prefixes (or description terms).
- Verb and verbatim/verbatim* retain literal source up to their exact terminator.
  Inline verbatim cannot cross a newline. No commands inside verbatim are evaluated.
- Href/url/includegraphics accept braced literal targets with supported escaped
  characters. Image options remain opaque latex-options attributes. Figure/table
  placement, captions, optional captions and labels are retained. Repeated captions
  fail instead of overwriting arguments.
- Tabular supports l/c/r columns, vertical-rule source, hline counts, ampersand
  cells, double-backslash rows and whole-cell multicolumn with a positive span and
  l/c/r alignment. Floats retain column/rule attributes. Empty or nonrectangular
  tables fail. Fixed-width/custom column prototypes, multirow, longtable and
  optional tabular positioning are outside this projection and fail explicitly.
- Labels identify the current heading/float/table or a standalone anchor Div.
  Ref/eqref link to the label's title source without inventing TeX counters/page
  numbers. Missing, duplicate, cyclic-title and multiple labels per target fail.
  Pageref is unsupported raw source. No auxiliary files are read.
- Dollar/double-dollar, parenthesized/bracketed command delimiters and
  math/displaymath/equation/equation*/align/align* retain typed InlineMath or
  DisplayMath source. This preserves TeX source, without rendering or promising
  macro expansion inside math. Delimiters/groups must match; escaped dollars and
  math comments do not terminate a region.

## Simple macro allowlist

Only newcommand, renewcommand and providecommand with a braced simple ASCII
control-word name (1–64 letters), 0–9 braced required arguments and an optional
first-argument default are interpreted. Stars, unbraced arguments, parameter
patterns, doubled parameter markers and primitive definitions are unsupported.
Parameters are single #1–#9 markers bounded by the declared count; escaped markers
and comments are literal/comment syntax. Definitions are local to groups and
non-document environments; included files share their caller's macro scope.
Built-in/structural/reserved commands cannot be replaced. Definition and invocation
counts charge macros; substitution charges expandedBytes, resourceBytes and
retainedBytes through the shared execution budget before string growth. Recursive
invocation, excessive nesting, work and byte growth fail with E_LIMIT.

## Resources and security

Input/include support braced relative names, appending .tex only to suffixless
names. Absolute paths, parent traversal, backslashes, schemes, empty components,
control characters and tilde prefixes are rejected. Only AdapterContext.resources
may resolve them. Base denotes the source directory; nested includes use their own
directory. The thin safe-bash adapter injects this capability from its explicit
VFS and supplies cwd for stdin. Namespace authority remains with the provider;
lexical validation is not a host filesystem sandbox.

Includes are acquired eagerly before AST completion and publication. Active-path
cycles, includes counts, nesting depth, aggregate resources/resourceBytes,
input/decoded text and retained memory/work budgets are bounded by existing Limits.
The shared resource wrapper owns and charges acquired bytes once; macro expansion
has its separate aggregate expansion budget. Missing provider files fail E_IO;
absence of the capability fails E_CAPABILITY. Invalid included UTF-8 fails
E_ENCODING. Cancellation propagates through the injected capability. No missing
include becomes empty text or a warning-only success.

Catcode changes, write/shell escape, primitive definitions/expansion, file I/O
primitives, Lua, specials, package loading and other reserved primitives listed in
latex-syntax.ts fail E_CAPABILITY even under --lossy. Undefined harmless commands
and environments are rejected by default. With rawContent retain/escape or lossy,
unknown commands preserve their star and adjacent optional/required arguments in
RawInline; unknown environments preserve their entire source in RawBlock. Each
emits W_RAW_CONTENT. This policy belongs to conversion options; readDocument is
strict. JSON accepts rawContent explicitly and preserves these typed nodes. Other
writers still enforce their own raw/math/table loss policy; --lossy is not blanket
permission to drop content or execute TeX.

Malformed syntax and unsupported prototypes of otherwise mapped constructs remain
errors under every policy. This profile does not claim full TeX or Pandoc-reader
compatibility. The coverage ledger records original evidence separately from the
research-only upstream inventory.
