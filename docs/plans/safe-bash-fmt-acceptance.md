# fmt research and acceptance matrix

Task `research-fmt`, inspected 2026-09-19 on local `main`, HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55`, with unrelated working-tree edits
preserved. This document pins subsequent implementation and independent QA;
it does not claim a GNU 9.10 implementation, installed artifact, or release.

## Baseline and evidence authority

The compatibility baseline is **released GNU coreutils 9.10**, archive
<https://ftp.gnu.org/gnu/coreutils/coreutils-9.10.tar.xz>, SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
The archive was explicitly downloaded and its hash verified during this task.
No host fmt, BSD utility, native build, or host locale was executed.

Development comparison: <https://github.com/coreutils/coreutils/tree/b25722854370b8206d7f53f8934c36710cdd9974>.
Read release and development `src/fmt.c`, the `fmt invocation` section of
`doc/coreutils.texi`, and all five `tests/fmt` files. Findings from this reading
are source evidence, not native observations.

| Read source | Release SHA256 |
| --- | --- |
| `src/fmt.c` | `5c14a993ddddf251970e764f81e134128bb73bb585363d3bde1e3e053b52aec6` |
| `doc/coreutils.texi` | `59eebfdd7631904269d3c90cdc9bd3a2f7675e2c2b3b9b26f8c855978620b01e` |
| `tests/fmt/width.sh` | `c1ed00a015a7c7199977ac8cd8039bb11aaa9bbd67dc1fbb48e5d94afccac143` |
| `tests/fmt/goal-option.sh` | `c59dffa544737c0a81616f79b8df77e16f3e2e34c52330a1751191591d8e59de` |
| `tests/fmt/long-line.sh` | `244c7c233ce26cd09400aee4dddda85900661f79fc4c0923712ce885313ea878` |
| `tests/fmt/non-space.sh` | `c9745cefe7b5f84f06f3d4115c326f5272b26d8417079d578921c21a80f90394` |
| `tests/fmt/base.pl` | `56cdd19df820c3fded8a75032a21b526571ea0b7ad79303e6d545244fdae43fe` |

Development fmt.c SHA256 is
`dca9737e5dcc0fa12d55887deba66ce8dd5598ee4e32a764599e8fd03793fe8d`;
development manual SHA256 is
`44a1a4f375a9b66c808f91154a581724303c584d1045e6292773fd1afce15f1d`.
The fmt manual sections are identical, including their trailing separator,
SHA256 `1156d317a28787d785d00ad88f2fc80bf8b72fee868be12aa084dceb5c256a48`.
The only fmt.c differences move default initialization from main into static
initializers. Four upstream tests are identical; development `base.pl` removes
strerror normalization and asserts the platform ERANGE suffix through getlimits.
Its formatting fixtures are unchanged. Do not treat that test change as a new
formatting algorithm or use its platform-dependent suffix as a portable oracle.

Evidence labels used below:

- **U**: exact expectations transcribed from released upstream tests.
- **S**: released source/manual-derived behavior; not a native run.
- **R**: native observations supplied in the task; not rerun here. Complete
  transcripts and identities of all original inputs were not supplied.
- **L**: this task's memory-VFS execution of the current implementation.

## Current main inspection and validated gaps

`packages/safe-bash/src/commands/fmt.ts` currently owns parser, formatting DP,
stream handling and diagnostic quoting. No `packages/safe-bash-command-fmt`
workspace or public `./commands/fmt` manifest export exists. The existing factory
is `fmtCommand()`; default registration tests cover direct, nested, pipeline,
VFS and redirection routes. Preserve registration behavior during extraction.

Inspected `tests/commands/fmt.test.ts`, `fmt-adversarial.test.ts`,
`tests/plugins/fmt-registration.test.ts` and snapshot metadata. Existing
`fmt-native`, `fmt-adversarial`, `fmt-quoting` and `fmt-ascii-quoting` controls
are historical GNU 8.30 controls. They remain independent historical evidence;
never relabel them 9.10 or generate replacement expectations from the engine.

Concrete width gap: `Formatter.optimize` stops when the next candidate length
is `>= width`; released `fmt_paragraph` admits lengths `<= max_width`.
Ad hoc TypeScript ESM execution with MemoryFileSystem, byte stdin, awaited sinks,
and explicit `LC_ALL=C` produced these **L** results:

| argv | stdin, no final LF | Current stdout | stderr/status | Released U stdout |
| --- | --- | --- | --- | --- |
| `-w8` | `aa bb cc dd ee` | `aa\nbb cc\ndd ee\n` | empty / 0 | `aa bb cc\ndd ee\n` |
| `-w7` | `aa bb cc dd ee` | `aa\nbb cc\ndd ee\n` | empty / 0 | `aa\nbb cc\ndd ee\n` |

These observations validate a 9.10 gap; this research task changes no runtime
code. Migration/repair requires an original failing test before implementation.
The current `unicodeLocale` accepts arbitrary names ending utf8/utf-8 rather than
rejecting unavailable profiles; this is a source-validated profile-admission gap.
Existing ownership, cancellation, cleanup, limits and backpressure tests were
read, not counted as fresh passing checks. Initial CJS ad hoc execution was
inapplicable to import-only contracts; the successful probe used ESM.

## Pinned byte and profile semantics

Formatting consumes original byte values. A word's length is its encoded byte
count, not JS string length, grapheme count or Unicode terminal width. UTF-8
`é` costs two bytes and `界` three. Unicode spaces are not automatically word
delimiters. Invalid UTF-8 and NUL remain original bytes; no replacement-character
round trip is allowed. Prefix matching likewise uses raw owned argv bytes.

`get_line` ends a word on ASCII `c_isspace`: SPACE, TAB, LF, VT, FF, CR. However,
`get_space` consumes only SPACE/TAB and the line loop terminates only at LF/EOF;
VT/FF/CR can begin the following word rather than disappearing as generic
whitespace. Do not use JS whitespace splitting. Pin original fixtures for these
controls. C `strchr` membership also includes NUL: the source's opening,
closing and period tests have that edge behavior. Punctuation uses `ispunct`,
so a non-C diagnostic/classification profile needs its own qualification.

The required core profile is raw bytes, ASCII whitespace, byte widths, TAB stops
at multiples of eight, C punctuation and C English diagnostic policy. A UTF-8
diagnostic profile must specify decoder validity, printable classification,
quoting and table/version provenance independently of formatting widths.
Advertised `en_US.UTF-8` compatibility needs its independent diagnostic gate;
the supplied equal-output fixtures do not establish every locale behavior.
Resolve profiles explicitly from supplied configuration/environment, with no
ambient host locale. Reject unknown/unavailable profiles with structured SDK
error and equivalent CLI status/diagnostic; exact new rejection text remains an
implementation-contract gate, not an invented GNU diagnostic.

Normal paragraphs join nonblank lines with equal indentation. Blank lines
remain paragraph boundaries. Input indentation uses only SPACE/TAB. Prefix
indentation must match within a paragraph. Width includes restored prefix and
indentation, excludes output LF, and does not split an oversized word.
Any encountered TAB enables re-tabbing output spacing for the remainder of that
file; reset at each file. Default spacing preserves expanded interword distance,
not necessarily original whitespace bytes. `-u` normalizes word spacing but
keeps sentence spacing. Trailing interword space is not emitted. Formatted
paragraphs end with LF even without input LF; an unmatched prefix copy path can
preserve missing LF. Whitespace-only and prefix-only paths need separate controls.

This differs from fold's display-column semantics: fmt does not decode glyphs
to wcwidth or apply display-column wrapping, and it optimizes breaks rather
than greedily filling lines.

## Options and exact interactions

| Option | Pinned rule (S unless marked R) |
| --- | --- |
| `-w`, `--width` | Default 75; inclusive range 0..2500. Zero is accepted. Default goal is floor(width × 187 / 200). |
| `-g`, `--goal` | Goal 0 accepted; validate final goal against final width, regardless order. Without explicit width validate against 75, then set max = goal + 10. Thus goal-only 76 fails, goal-only 75 gives max85. |
| Repeated width/goal | Last occurrence of each wins; validate after parsing. |
| Numeric syntax | R accepts `+5`, `05`, leading ASCII whitespace before 5; no generic numeric coercion. Invalid suffixes fail. |
| Legacy `-WIDTH` | Only first argv; `-20`/`-123` accepted. Later digit option fails, including after a file. Use `-w` subsequently. |
| Long forms | GNU unique abbreviation `--wid=20` accepted (R); unknown/ambiguous options fail. Attached/separate values and short clusters need parity. |
| `-s`, `--split-only` | One input nonblank line per paragraph; never joins. Takes precedence over crown and tagged. |
| `-c`, `--crown-margin` | First indent retained; second indent governs all subsequent lines. Takes precedence over tagged. |
| `-t`, `--tagged-paragraph` | Join second line only when its indent differs from first. Equal indent makes a one-line paragraph. Secondary indent carries between paragraphs within a file; starts at0, and if equal to first choose3 for first0, otherwise0. |
| Mode combinations | `-sc`, `-st`, `-ct`, `-sct` are accepted: split > crown > tagged, independent of order. Do not blanket-reject combinations. |
| `-u`, `--uniform-spacing` | One space between words, two after recognized sentences; orthogonal to the three paragraph modes and prefix. |
| `-p`, `--prefix` | Trim only ASCII edge SPACE bytes from matching prefix, retaining original leading minimum and post-leading full length including trailing spaces. Require these margins for eligibility; restore trimmed prefix on formatted lines. Prefix-only and strict partial matches are copied. |

Sentence detection strips closing `)`, `]`, apostrophe and double quote from
word end, then recognizes `.?!`; require at least two expanded spaces or line
end. EOF also marks the final word. Opening bonus characters are `(`, `[`,
apostrophe, backtick, double quote. Paragraph-final word is forced period/final.
One SPACE after a period inside a line is not a sentence break; a period at
input line end remains one after joining. Tabs contribute expanded spacing.

## Cost and bounded-window acceptance

Use suffix DP, with strict `<` updates: equal costs keep the first considered
break. At least one word is admitted even when longer than max. Nonfinal line
cost is `100*(goal-length)^2`, plus `50*(length-nextLength)^2` when the next
line is nonfinal. Final line's variable cost is0. Previous emitted line length
adds ragged cost at the retained window start when positive.

Base cost is4900, then preceding period contributes -2500 if sentence-final or
+360000 otherwise; preceding other punctuation gives -1600; otherwise a
first-word widow gives trunc(40000/(length+2)). Opening word gives -1600;
otherwise sentence-final word gives trunc(22500/(length+2)). Preserve the source
branch order, integer division and NUL membership. Whole-paragraph DP and
ordinary greedy wrapping are different algorithms.

MAXCHARS5000 counts retained word bytes. MAXWORDS1000 has a flush check at slot
MAXWORDS-2 before advancing: characterize 998/999, not just1000. Multiword flush
optimizes completed words, chooses strict-less minimum marginal suffix break
cost with accumulating credit9, emits up to that break, moves retained suffix
and unfinished word, and carries previous emitted line length. The one-word
case writes raw buffered bytes without prefix/indent/out-column updates. It
resets the buffer and measures the remaining tail as word length. Preserve
these released oddities in the GNU profile; corrected long-word behavior needs
a separately named profile.

Checked exact JS arithmetic and explicit finite work/byte limits are required.
Do not emulate native signed-long overflow. Rejection beyond documented safe
limits is an explicit compatibility deviation. Account DP candidates, byte
scans, copies and moves; bound cancellation latency between admitted units.

## Independent exact fixtures

Notation: quoted strings use escaped LF/TAB; `A^N` means exactly N ASCII A bytes.
All success rows have empty stderr and status0. These are acceptance controls,
not expectations obtained by calling the implementation.

| ID / authority | argv | Exact stdin | Exact stdout |
| --- | --- | --- | --- |
| width8 / U | `-w8` | `aa bb cc dd ee` | `aa bb cc\ndd ee\n` |
| width7 / U | `-w7` | `aa bb cc dd ee` | `aa\nbb cc\ndd ee\n` |
| final-LF / R | `-w20` | `one two three four five` | `one two three\nfour five\n` |
| uniform-tabs / R | `-u` | `a\tb\tc` | `a b c\n` |
| zero / S,R | `-w0` | `one two` | `one\ntwo\n` |
| prefix-only / U | `-p '>'` | `>\n` | `>\n` |
| prefix-partial / U | `-p foo` | `fo\n` | `fo\n` |
| byte-prefix / U | `-p ç` | UTF-8 `ça\nçb\n` | UTF-8 `ça b\n` |
| unmatched-final / S | `-p '>'` | `plain` | `plain` |
| blank-boundary / S | default | `a\n\nb\n` | `a\n\nb\n` |
| invalid-byte / S | default | hex `ff 0a` | hex `ff 0a` |
| unicode-word / S | `-s -w1` | UTF-8 `=\u00a0=` | identical original bytes plus LF |
| chars5000 / R | `-w20` | `A^5000 end` | `A^5000\nend\n` |
| chars5001 / R | `-w20` | `A^5001 end` | `A^5001 end\n` |
| prefix5000 / R | `-w20 -p '> '` | `> A^5000 end` | `> A^5000\n> end\n` |
| prefix5001 / R | `-w20 -p '> '` | `> A^5001 end` | `A^5000> A end\n` |

Exact error controls, stdout empty and status1:

| Authority / argv | stderr bytes |
| --- | --- |
| U `-72x` | `fmt: invalid width: '72x'\n` |
| U `no-such-file` | `fmt: cannot open 'no-such-file' for reading: No such file or directory\n` |
| U `-c -72` | `fmt: invalid option -- 7; -WIDTH is recognized only when it is the first\noption; use -w N instead\nTry 'fmt --help' for more information.\n` |

Goal20 with width10 fails in either argument order (R); exact released stderr
was not supplied, so it remains a transcript gate. Do not borrow old suffix
bytes for a claimed 9.10 observation. Upstream wide-option controls normalize
strerror in release `base.pl`, so exact diagnostic suffixes also need capture.

## Supplied native cohorts and remaining gates

The task reports 252 successful native9.10 controls: 18 original inputs ×7
flag combinations × C/en_US.UTF-8, no locale differences, all empty stderr.
The complete 18 inputs, seven argv vectors and raw outputs are unavailable
here. Preserve the report as R; obtain those bytes before calling the cohort
independently reproducible or passed by this implementation.

The 200 MAXCHARS recipes are fully specified: lengths4998,4999,5000,5001,5002,
9998,9999,10000,10001,10002; leading profiles empty, eight SPACE, TAB, `> `,
`  > `; modes default,-u,-c,-t; always -w20, add `-p '> '` for greater-than
profiles. Input = leading + A^N + SPACE + `end`, no LF, LC_ALL=C. All reported
status0/empty stderr. At5001 indentation/prefix follows the first5000 raw A
bytes; at10001 it follows10000. Full outputs for every cell remain to capture.

The 144 MAXWORDS recipes: counts996,997,998,999,1000,1001,1002,1003,1004,
1998,1999,2000 × widths7,17,20,75 × cyclic recipes `[a]`, `[a,bb]`,
`[a,bb.,c]`. Start cycle at its first token, take exactly N tokens, join with
single SPACE, append LF; LC_ALL=C. All reported status0/empty stderr.
Width17/all-a: N996 has111 lines starting8,8,8 words; N997 starts8,8,9;
N998 starts8,9,9. N999 has112 lines starting8,9,9 and ending8,2; N1000
ends8,3 through N1004 ending8,7. N1998..2000 has223 lines ending8,8,4/5/6.
These are supplemental summaries; they cannot reconstruct all expected bytes.
Retain full independent stdout bytes rather than asserting only counts.

| Gate | Required acceptance / current disposition |
| --- | --- |
| Released baseline | Immutable version/archive/source metadata and raw fixtures; width7/8 explicit gate. Historical8.30 snapshots separate. |
| Flag interactions | Exact original controls for every mode precedence, prefix edge spacing, tagged carry, crown second indent, sentence closers, tabs, blank/control bytes; source pinned, full native cross-product open. |
| Algorithm | Exact bytes for goal deviations, strict ties, punctuation/widow/orphan decisions and window carry; upstream goal-option expected block independently available. |
| Windows | Capture all200/144 outputs; combine prefix/crown/tagged/tab/punctuation/tie/window controls separately. Those combinations remain open. |
| Upstream controls | Transcribe exact goal-option input/output; long-line recipe is LF after1015 repetitions of SPACE+y and expected29 lines each35 words with leading SPACE. non-space profiles require explicit availability, never unavailable-case passes. |
| Ownership and streams | Memory-only producer-reuse/retirement, distinct invalid argv, retained-copy admission, awaited slow sinks, no extra pulls under backpressure; existing tests are starting evidence, fresh gate needed after changes. |
| Safety | Explicit input/output/retained/work limits, checked costs, cancellation during DP/moves/output, cleanup registered before acquisition and idempotently awaited; VFS failures and falsey reasons stay covered. |
| Isolation | Denied host process/file/network capabilities; no native/WASM fallback, runtime downloads or ambient locale. Mock external capabilities. |
| CLI/SDK | One responsible factory/engine; equal argv/options, bytes, statuses and VFS behavior through direct and actual Shell registration routes. |
| Packaging | Real private workspace `safe-bash-command-fmt`, TypeScript ESM, no external runtime dependencies. Safe Bash only composes/exports at `@poe-platform/safe-bash/commands/fmt`; command imports canonical leaf contracts, never safe-bash. |
| Installed artifact | Bundle private JS and declarations, no unpublished specifier/install need; strict external consumer import/typecheck, register factory, VFS files/pipes/scripts, runtime identity, byte argv and isolation. Publication forbidden without explicit instruction. |

Follow [the moved package pattern](archive/safe-bash-command-package-pattern.md);
the requested original path is deleted by unrelated working-tree changes.
No empty workspace or speculative engine was added for this audit. Subsequent
implementation tests use original TDD cases in the responsible package;
independent compatibility controls carry their own metadata and fixed bytes,
without deriving expected values from candidate APIs.

## Verification and delivery

Archive hash verified; release/development source, manual and upstream test
comparison completed; two current memory-VFS width probes completed. This is
documentation-only work, so no code/unit-test, build, visual or packed-consumer
pass is claimed. Temporary source downloads used workspace `out/research-fmt`
because absolute `/out` is read-only on this host; they were purged after capture.
Local commit: none. Verified remote-main delivery: none. Successful release:
none. No command package was published.
