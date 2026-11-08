# Selector policy v4 — seven ratifications; final exclusion decision PENDING

Authority: latest root assignment > this explicitly split disposition > accepted
`1168432e12568e63ff307e92ed83d64d78a03a3c` > nonconflicting inherited v2.
This is a DOC-ONLY project profile, not an implementation or independent freeze.
Dirac's public final-freeze-v3/HANDOFF.md B01 at `a364a807` identifies the prior
blocker; no CASES, CONTROLS, LIMITS, manifest or hidden expected corpus was read.
Historical v2/v3 documents and original 28+16 observations stay immutable.

## 1. Seven decisions already ratified

1. Repeated singleton flags reject with status 1 before I/O, not last-wins.
2. Delimiters remain one ASCII byte (including the existing literal `\t`
   spelling); NUL, CR, LF and double quote additionally refuse before I/O.
3. Unsigned numeric options accept ASCII digits with optional leading `+` only.
   Empty/whitespace, minus, decimal/exponent/hex/separator forms reject. Existing
   u64 domain remains; signed selector indices/occurrences are NOT narrowed.
4. Checked start+len, index+1 and header-start+column must fit their existing
   numeric domain; reject overflow. Static invalid operands reject pre-I/O;
   header-dependent arithmetic is checked when known, before corresponding output.
5. Interior empty selector clauses reject pre-I/O. One trailing comma is valid.
   The WHOLE EMPTY selector is valid and means all. Bare `!` means none.
6. Slice `-L` with `-I` or any ordinary range mode, and `-I` with ordinary
   range mode, reject status 1 pre-I/O. Common `-n/-d/-o` remain compatible.
7. Invalid plural-index diagnostics accurately identify `-I`; nonempty bounded
   wording is required, not one globally fixed diagnostic string.

These are PROJECT boundaries, not native goldens. All accepted CR/BOM/M/EOF,
uppercase L0 versus ordinary zero-range behavior, 18 exact caps and bounded
wx/w fallback/identity/lifecycle rules remain unchanged. No new numeric domain,
feature, command, cap, output waiver or provider guarantee is introduced.

## 2. Complete proposed bounded consuming grammar

**PENDING root adoption and Dirac freeze:** the following replaces only the vague
“cursor-skipping wildcard/range combinations” exclusion. Parsing MUST consume
every character by a production, never silently bump over a non-separator.
All existing argument/selector/node/depth/work/selected-column caps apply.
This is a lexical/semantic specification, not a new executable parser.

```text
selection := [ "!" ] ( EMPTY | clause ( "," clause )* [ "," ] )
clause    := all | suffix | prefix | one | range
range     := [ one ] ":" [ one ]
one       := token [ occurrence ] | occurrence
occurrence := "[" signed-i64 "]"
token     := quoted | unquoted
quoted    := opening-quote ( nonquote | doubled-quote )* closing-quote
unquoted  := one-or-more characters other than comma, colon, opening-bracket
all       := unquoted leading "*" immediately followed by clause boundary
suffix    := unquoted leading "*" followed by nonempty raw-suffix
prefix    := first-position one whose name ends in "*", with no occurrence
```

The disambiguation rules below are part of the grammar, not optional heuristics:

- Strip at most the first `!` of the entire selector. Any later `!` is literal
  name text. EMPTY is possible only for the whole remaining selection; `,`,
  `!,`, leading/interior empty clauses and a second trailing comma are invalid.
  An explicitly quoted empty name (`""`) is a token, not EMPTY.
- At clause start an unquoted `*` takes precedence over `one`/`range`. Alone it
  is all. Otherwise scan raw-suffix up to comma, colon, opening-bracket or EOF;
  only comma/EOF may follow it. Quotes in raw-suffix are literal, not quoting.
  Additional stars are literal: `**` is suffix `*`; `*a*` is suffix `a*`.
- Else, a token beginning with `"` uses quoted parsing. A doubled pair inside
  quotes contributes TWO quote characters. Closing quote must be followed by
  occurrence, colon, comma or EOF. Unquoted tokens preserve whitespace, embedded
  quotes, closing brackets and stars literally. No JS/RFC unescaping or trimming.
- An occurrence can follow quoted or unquoted text, or be bare: `[0]` addresses
  occurrence zero of the empty header name. Exactly one bracket pair is allowed;
  its content is optional `+`/`-` followed by ASCII digits, within signed i64.
  After `]`, only colon, comma or EOF may follow. `a]` itself is a literal name,
  NOT a malformed bracket; `0[0]` selects the header NAME `0`, not index zero.
- Without occurrence, a token that parses as signed i64 is numeric even if
  quoted (`"0"`, `"+0"`). Outside-i64 unbracketed numeric-looking tokens remain
  names, as already approved; bracket overflow is a syntax/numeric failure.
- At the FIRST endpoint/standalone position only, a nonnumeric name ending `*`
  without occurrence becomes prefix matching (remove exactly its last star).
  This includes quoted `"a*"` and quoted `"*"` (empty prefix). Only comma/EOF
  may follow this branch: a colon cannot make it a range start. An occurrence
  disables this branch: `a*[0]:0` is a valid named range.
- Otherwise a single colon introduces an inclusive range. Missing start/end
  means first/last column, as already approved. SECOND endpoints use `one`
  without top-level wildcard dispatch: `0:*`, `0:a*`, `0:"a*"` are ranges to
  literal header names `*`/`a*`, not wildcard expansion. `0:*a` similarly names
  literal `*a`. This positional distinction MUST NOT be narrowed away.
- A bare unquoted token is nonempty; omitted endpoints belong only to the one
  range colon. A quoted empty token or bare occurrence is still an explicit
  name endpoint. Multiple colons outside quotes cannot consume an empty token.
- No special syntax is attached to an embedded/closing bracket or embedded
  quote in raw name text. Regex/expression support remains absent. Every accepted
  selector must finish at comma/EOF; no additional fallback grammar is implied.

Resolution preserves existing byte-exact name matching, header-mode requirement
for names/prefix/suffix, signed negative indices, and inclusive ascending or
descending ranges. Bare name chooses its first duplicate; occurrence is zero
based, negative occurrences count from the last duplicate. Wildcard matches
follow header order. Lists preserve order and duplicates; complement resolves
the list then returns each unselected column once in original header order.
No-name/no-match/index/occurrence failure reads the first logical record as
already required, emits no selected header/body, then fails; no full-input read
or synthetic successful selection. Existing zero-width resolution policy is
not changed by this syntax clarification.

## 3. Finite refusal categories and diagnostic classes

All malformed syntax below: status **1**, stdout **empty**, **before any I/O**,
including metadata/input acquisition/output publication. S = selector syntax,
N = occurrence numeric conversion/domain. Diagnostics must be nonempty, bounded,
identify `xan select` and the failing class; existing exact approved diagnostics
(including known unclosed quote/bracket wording) are retained. Newly excluded
cursor forms use the existing `unsupported in bounded CSV profile:` family with
selector/category detail; no global relaxation of other exact diagnostics.

| Finite syntactic category | Concrete selector argv values | Class |
| --- | --- | --- |
| Empty non-whole clause; extra trailing separator | `,`, `!,`, `,0`, `0,,1`, `0,,` | S (ratified) |
| More than one unquoted range colon, including repeated colon | `0::1`, `0:1:0`, `::`, `0:1:` | S |
| Top-level all/suffix/prefix branch followed by colon | `*:1`, `*a:0`, `a*:0`, `"a*":0` | S |
| Suffix branch followed by occurrence/open bracket | `*a[0]`, `*[0]`, `**[0]` | S |
| Unclosed quote/bracket, repeated bracket, trailing junk after quote/bracket | `"a`, `a[0`, `a[0][1]`, `"a"junk`, `a[0]junk`, `a[0]*` | S |
| Empty, nondecimal, nested, or out-of-domain occurrence content | `a[]`, `a[+ ]`, `a[0[1]]`, `a[9223372036854775808]` | N |

This enumeration is exhaustive by grammar violation category, not an unbounded
list of unsupported spellings. Adjacent/interior stars, literal `]`, literal
stars at second endpoints, quoted empties and bare occurrences are NOT blanket
refusals. All tokens not consuming a production fail one of these categories;
invalid scalar argv and existing limits retain their separately approved checks.

R = resolution failure: status 1, empty stdout, after first-record/header read,
diagnostic accurately distinguishes missing name, unmatched prefix/suffix,
out-of-range column or duplicate occurrence (or named use under `-n`). Existing
source-known exact messages remain exact where already bound. Limits, cancellation
and output failure may supersede ordinary outcomes under existing contracts.

## 4. Frozen DOC bytes and concrete examples

The following are UTF-8 JSON string literals defining exact DOCUMENT fixtures;
they are not files created in the VFS, hidden fixtures, or executed observations.
All examples use default comma/header mode and successful I/O unless marked.
Each table selector is passed literally as argv `["xan","select","--",SEL]`
(the table's backticks are not bytes; embedded double quotes ARE selector bytes).

```json
{"A":"a,b\n1,2\n3,4\n","B":"a,a,ab,ba,a*,*,\"a\"\"\"\"b\",0,x:y,\"x,y\",,a]\nA0,A1,AB,BA,AST,STAR,QQ,ZERO,COL,COM,EMPTY,CLOSE\n"}
```

B's decoded header is `a`, `a`, `ab`, `ba`, `a*`, `*`, `a""b`, `0`,
`x:y`, `x,y`, empty, `a]`; the quote-containing name has TWO quotes.
Every success below has status 0 and empty stderr. stdout is a JSON string.

| Fixture | SEL (literal bytes) | stdout |
| --- | --- | --- |
| A | empty string; `*`; `:`; `0:1`; `0,1` | `"a,b\n1,2\n3,4\n"` |
| A | `0,`; `0`; `+0`; `"0"`; `:0` | `"a\n1\n3\n"` |
| A | `!` | `"\n\n\n"` |
| A | `!0`; `-1`; `1:` | `"b\n2\n4\n"` |
| A | `1:0`; `-1:+0` | `"b,a\n2,1\n4,3\n"` |
| A | `0,0` | `"a,a\n1,1\n3,3\n"` |
| B | `a`; `a[0]` | `"a\nA0\n"` |
| B | `a[1]`; `a[-1]`; `"a"[+1]` | `"a\nA1\n"` |
| B | `a[1],a[0],a[1]` | `"a,a,a\nA1,A0,A1\n"` |
| B | `a*`; `"a*"` | `"a,a,ab,a*,\"a\"\"\"\"b\",a]\nA0,A1,AB,AST,QQ,CLOSE\n"` |
| B | `*a` | `"a,a,ba\nA0,A1,BA\n"` |
| B | `**` | `"a*,*\nAST,STAR\n"` |
| B | `*a*`; `a**` | `"a*\nAST\n"` |
| B | `"a""b"` | `"\"a\"\"\"\"b\"\nQQ\n"` |
| B | `"0"` | `"a\nA0\n"` |
| B | `0[0]` | `"0\nZERO\n"` |
| B | `"x:y","x,y"` | `"x:y,\"x,y\"\nCOL,COM\n"` |
| B | `""`; `[0]`; `""[-1]` | `"\"\"\nEMPTY\n"` |
| B | `a]` | `"a]\nCLOSE\n"` |
| B | `0:*` | `"a,a,ab,ba,a*,*\nA0,A1,AB,BA,AST,STAR\n"` |
| B | `0:a*`; `0:"a*"` | `"a,a,ab,ba,a*\nA0,A1,AB,BA,AST\n"` |
| B | `a*[0]:0` | `"a*,ba,ab,a,a\nAST,BA,AB,A1,A0\n"` |
| A | `0::1`; `0:1:0`; `a*:0`; `*a[0]`; `"a"junk`; `0,,1` | `""` — status 1, S, pre-I/O |
| A | `a[]`; `a[9223372036854775808]` | `""` — status 1, N, pre-I/O |
| A | `missing`; `9223372036854775808`; `0:*` | `""` — status 1, R missing name, header read |
| A | `2`; `-3`; `a[1]` | `""` — status 1, R index/occurrence, header read |
| A | `z*`; `*z` | `""` — status 1, R prefix/suffix, header read |
| B | `a*b`; `*"a"` | `""` — status 1, R literal name/suffix, header read |

Examples are calculated PROJECT expectations under this proposal. The only
native-observed outcomes remain the original immutable 28+16 records. No new
native result, stderr golden, product pass or independent freeze is asserted.

## 5. Pinned source reasoning and smallest remaining decision

Primary authority inspected read-only: upstream tag 0.54.0 commit
`2f9156c8ec79a3ecc09e0879735ac68ec8997b7a`, `src/select.rs`, cached per the
existing provenance/source map; SHA256
`a9e9ec4bdadaff676af7d8aeb1bb8cb6ca59f56aaa06d779791b3d01c7dbe6da`.
Source lines 17–65 bind complement/list ordering; 162–234 dispatch wildcards and
ranges; 237–265 token/numeric/name parsing; 267–316 quote/occurrence parsing;
327–333 delimiters; 365–431 wildcard/range resolution; 433 onward indices/names.
These are source inferences, NOT executions:

- `0::1` stops on the second colon and reaches expected-end failure. It is
  classified S by this proposal, not left UNCLASSIFIED or claimed observed.
- `a*:0` takes prefix then blindly advances over colon; `*a[0]` takes suffix
  then advances over `[`. Strict refusal removes this cursor-skipping behavior.
- `**` consumes suffix `*`; second-endpoint `*` is a name, not top-level All.
  Rejecting either wholesale would silently narrow already described semantics.
- Quoted numeric conversion, retained doubled quotes, quoted ending-star prefix,
  and bracketed numeric NAME interpretation follow the actual parser, not CSV
  selector intuition. The consuming grammar preserves them.

**Root's sole remaining disposition:** adopt sections 2–4 as the exact bounded
selector exclusion/consumption policy (including literal second-endpoint stars,
adjacent-star suffixes, empty-name occurrences and pre-I/O S/N failures), then
route Dirac for independent additive freeze. If root intended “wildcards” to
forbid literal-star range endpoints or adjacent stars, explicitly resolve that
conflict rather than approve a silent narrowing. Seven decisions in section 1
are already ratified and are not reopened. No reviewer has run for this packet.
