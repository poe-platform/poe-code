# Initial yq profile v1 — normative language draft

Status: **LANGUAGE DRAFT AWAITING ROOT ADOPTION** on 2026-08-28. This is a
design and static-source packet, not implementation authorization. No statement
in this packet changes product behavior. The numeric vector `P1`, every CLI
choice labelled proposed, the status mapping, diagnostic spelling, and output
presentation remain unapproved until root selects them explicitly.

Normative words apply only to a future implementation after that freeze. The
fixed implementation baseline is commit
`5137a74ec855a32d8a8860eb66b62eb44d11e290`; source identities are in
`decisions.json`. The live relevant files inspected on 2026-08-28 had identical
bytes and no relevant diff from that baseline. Historical design commits
`270fedbe4f1fee6405dace72e6e18b22f358b5ce` and
`0b8064d21fa82d516160ee8cd7ac3808144d09fc` are context, not authority over this
profile.

## 1. Root-settled boundary and decisions still required

The following constraints are root-settled for this draft:

1. Initial yq is a restricted YAML 1.2.2 Core-profile reader and formatter over
   the existing bounded jq query engine. It is not full YAML, full Core, Mike
   Farah yq syntax, or a new query parser.
2. One invocation compiles one query once, before input acquisition, and uses one
   existing `Budget` and one interpreter across every operand and document.
   Each input document is queried independently in operand/document order. Each
   query yield becomes a separate output document. There is no implicit gather.
3. `eval-all`, `ea`, `-s`, `--slurp`, every write mode, and every schema selector
   are rejected. No public slurp or evaluate-all behavior is approved.
4. The complete existing bounded jq surface, including `length`, remains. The
   string-length allocation prerequisite is a separate one-branch protocol; it
   does not authorize a broad structured-command refactor or new charging.
5. Input documents and output documents may be wholly buffered under admitted
   byte/depth/node limits. Claims are limited to logical payload bounds. There is
   no heap, RSS, latency, allocation-lease, or hard-preemption guarantee.
6. Compilation remains synchronous. The source byte and AST-depth caps bound the
   admitted problem, but general tokenization/AST work is not charged to
   `maxSteps` and has no cooperative checkpoint.

Root must still choose each row below before code work:

| ID | Exact draft choice | State |
| --- | --- | --- |
| D1 | Adopt proposed CLI grammar `C1`, including `eval`/`e` and only four output option families | UNAPPROVED |
| D2 | Adopt scalar/tag/alias profile `L1` below | UNAPPROVED |
| D3 | Adopt statuses and stable diagnostic protocol `E1` | UNAPPROVED |
| D4 | Adopt numeric vector `P1`, including the conservative 8 KiB query-source cap | UNAPPROVED |
| D5 | Approve a narrow private query adapter with the three internal factories described in section 8 | UNAPPROVED; no public export |
| D6 | Require the separately reviewed string-`length` prerequisite before yq code | ROOT-SETTLED direction; future code freeze still required |

Rejecting or revising any row does not silently select an older packet.

## 2. Proposed CLI `C1` (unapproved)

The entire accepted grammar would be:

```text
yq [eval|e] [OPTION ...] [--] [FILTER [FILE ...]]

OPTION := -o FORMAT
        | --output-format FORMAT
        | --output-format=FORMAT
        | -c
        | --compact-output
        | -r
        | --unwrapScalar

FORMAT := yaml | json
```

`eval` or `e` is recognized only at argv index zero. Its absence means the same
single-eval behavior. Option recognition continues until `--`; non-option
operands do not end it. Short options do not cluster and do not accept attached
values. `--` only ends option recognition; it does not change operand roles.
Every spelling of the same option family may occur at most once, so for example
`-o json --output-format=json` and `-c --compact-output` are errors.

The first operand is always the filter. If there is no operand, the filter is
identity (`.`) and stdin is the only input. Consequently `yq data.yaml` treats
`data.yaml` as a filter; reading that file requires `yq . data.yaml`. A lone `-`
in file position means stdin and may occur at most once. Other file operands are
literal virtual paths, may repeat, and are read in the stated order. A leading-
dash filter or file must follow `--`. With no file operand, stdin is used once.

Input is always the restricted YAML profile in this document. There is no
extension-based or stdin-content format inference. JSON text that is valid under
this restricted YAML/Core profile is accepted as YAML; no JSON-schema mode is
implied.

Output defaults to `yaml`. JSON defaults to two-space pretty output. `-c` selects
compact JSON and therefore requires `-o json`. `-r`/`--unwrapScalar` also requires
`-o json`: a string result is emitted as its exact UTF-8 content without JSON
quotes or escaping, while every non-string result follows the selected pretty or
compact JSON encoding. Every result, including an empty raw string, ends in one
LF. Duplicate flags, missing/unknown values, an unknown option, an unexpected
command word, and incompatible options are CLI errors.

The following are explicitly refused as CLI errors, including long `=value`
forms where meaningful: `eval-all`, `ea`, `-s`, `--slurp`, `-n`,
`--null-input`, `-p`, `--input-format`, `--yaml-schema`, `--schema`,
`--json-schema`, `--failsafe-schema`, `-i`, `--inplace`, `--in-place`,
`--allow-lossy-write`, all update/write/split/document-selection modes, program
files, variables, properties/front-matter/XML flags, color flags, and every
unlisted option. `--help` and `--version` are not included because this draft
does not invent package/version/help bytes.

CLI validation and argv admission MUST finish before stdin iteration, VFS calls,
stdout acquisition, or query compilation. The one query compilation MUST then
finish before stdin iteration, VFS input calls, or stdout acquisition. A CLI
failure may write its one bounded stderr diagnostic but has no stdin, VFS, or
stdout effect. A compile failure likewise has no input/VFS/stdout effect.

## 3. Proposed language profile `L1` (unapproved)

### 3.1 Accepted presentation syntax

Input is UTF-8 only, decoded fatally. UTF-16/32 are intentionally outside this
restricted profile even though full YAML 1.2.2 processors support them. An UTF-8
BOM is recognized and removed at the stream prefix and at a document prefix
after a legal document boundary. U+FEFF inside a quoted scalar is content;
elsewhere inside a document it is rejected.

The parser accepts YAML 1.2.2 block sequences/mappings, flow
sequences/mappings, plain scalars, single- and double-quoted flow scalars,
literal (`|`) and folded (`>`) block scalars, indentation and chomping
indicators, comments, bare documents, `---`, and `...`. CR, LF, and CRLF are
structural line breaks and scalar line breaks normalize to LF. NEL U+0085,
U+2028, and U+2029 are non-break characters in YAML 1.2. Tabs are accepted only
where the YAML grammar permits them and never as indentation.

Outside quoted scalar content, raw characters MUST be YAML 1.2.2 `c-printable`:
TAB/LF/CR, U+0020–U+007E, U+0085, U+00A0–U+D7FF, U+E000–U+FFFD, or
U+10000–U+10FFFF. Within quoted content the YAML `nb-json` allowance applies;
legal double-quoted escapes may represent control content. Invalid UTF-8,
unpaired surrogates, forbidden raw controls, U+FFFE/U+FFFF, and malformed or
out-of-range escapes fail. Output strings escape content that cannot be emitted
as printable YAML. These rules follow YAML 1.2.2 sections 5.1–5.4 and 5.7.

Only `%YAML 1.2` is accepted, at a legal directives position and at most once for
that document. `%TAG`, another YAML version, duplicate YAML directives, and
reserved/unknown directives fail. This is a deliberate restricted subset.

Every mapping key MUST compose to a scalar string. Collection, null, Boolean,
and numeric keys fail rather than being coerced. Explicit scalar-key notation is
accepted when its result is a string. Duplicate keys are rejected after tag
resolution and scalar decoding by exact Unicode-code-point string equality.
Insertion order is retained in the null-prototype query object; dangerous names
such as `__proto__` are data. The key `<<` is always rejected, even quoted or
explicitly tagged, so historical merge behavior cannot be mistaken for a normal
entry. Complex keys, sets, ordered-map types, and merge keys are not supported.

### 3.2 Core resolution and tags

Plain, untagged scalars use the YAML 1.2.2 Core regular expressions in section
10.3.2: empty/`~`/the three case variants of `null`; the three case variants of
`true` and `false`; signed decimal, `0o` octal, and `0x` hexadecimal integers;
decimal floats; and the Core infinity/NaN spellings. Unmatched plain content is
a string. Quoted and block scalars are strings absent an accepted explicit tag.

Only these exact expanded built-in tags and their `!!` shorthand are accepted:
`tag:yaml.org,2002:map`, `seq`, `str`, `null`, `bool`, `int`, and `float`.
`map`/`seq` MUST match node kind. Scalar tags MUST match the corresponding Core
lexical family; `!!str` accepts any syntactically valid scalar content. Explicit
`null`, `bool`, `int`, or `float` does not coerce content from another family.
Verbatim and shorthand spellings resolve before this allow-list check. Local,
application, unknown global, `binary`, `timestamp`, `set`, `omap`, `pairs`, and
merge tags fail. The non-specific explicit `!` is rejected. Thus there is one
resolution path, not a fallback phase that silently turns a rejected tagged
value into a string.

Core `.inf` and `.nan` forms lexically resolve as floats but are then rejected by
the finite-value rule. This makes the profile intentionally narrower than full
Core rather than pretending those spellings are strings.

### 3.3 Values and exact numeric admission

The composed query value is exactly the baseline `Json` family: null, Boolean,
well-formed string, finite `number`/`Decimal`, array, or ordered null-prototype
object. Styles, comments, raw scalar spelling, tags, anchors, and source slices
are discarded after successful composition. Query inputs are mutation-forbidden
for each run; query operations may produce new values.

Numeric admission is lexical and bounded before conversion:

1. Core integer digits are stripped of sign and base prefix. Leading zeros are
   normalized. Magnitude is compared by digit count and lexicographic order to
   `9007199254740991` expressed in that base. Larger magnitudes fail. No `BigInt`
   or exponentiation is needed.
2. A decimal float is decomposed into sign, coefficient digits, decimal-point
   position, and explicit base-10 exponent. Exponent digits are accumulated with
   saturation only far enough to decide whether the normalized exponent is in
   the baseline `Decimal` interval `[-1147483646, 999999999]`; an out-of-range
   exponent fails. No power-of-ten allocation is performed.
3. Exact mathematical integrality is determined from normalized digits,
   exponent, and trailing zeros. If integral, exact magnitude is compared to
   `Number.MAX_SAFE_INTEGER` by lengths and lexicographic digits; an unsafe
   result fails. After conversion through baseline `decimalNumber`, a non-finite
   `.double`, or an integral but unsafe `.double`, also fails. This second test
   catches a nonintegral decimal rounded by binary64 to an unsafe integer.
4. Accepted base-8/base-16 integers are converted to an exact safe decimal token;
   accepted decimal spellings are passed as bounded canonical decimal text.
   `Decimal` retains normalized digits, exponent, text, and binary64 double, not
   the original YAML spelling. Negative zero remains numeric negative zero where
   the baseline representation preserves it.

The same finite/safe-integral checks apply recursively to every input graph and
every yielded query graph before encoding. Query built-ins such as `nan` or
`infinite` remain syntactically part of the existing jq surface, but their
nonconforming yielded value fails validation. This wrapper does not silently
delete existing query syntax.

### 3.4 Anchors and aliases

Anchor names are unique within one document. An anchor becomes usable only after
its entire node is composed and validated. An alias can reference only such a
completed earlier anchor in the same document. Missing, forward, current-node,
duplicate-anchor, cross-document, and cyclic references fail. Each accepted
alias becomes a distinct recursive deep copy; query-visible identity sharing is
not retained.

Each completed anchor caches its subtree node count and compact-value byte
measure. Before allocating an alias copy, checked safe-integer addition MUST
prove that the copy fits the current document's node/value/depth limits and the
cumulative invocation alias/work limits. Every copied node and copied scalar's
actual UTF-8 bytes count before copying. An alias never hides descendants from a
limit. Anchor namespaces and per-document maxima reset at a document boundary;
the one `Budget`, cumulative alias-reference count, cumulative input, work,
results, and output never reset.

The YAML specification permits a broader representation graph. This deep-copy,
backward-completed-anchor rule is an intentional safety subprofile.

## 4. Documents, query, and output

A stream contains zero or more independent documents. A comment/BOM-only empty
stream has zero documents and therefore no query run and no output. An explicit
empty document introduced by `---` composes as null. Each subsequent `---`
starts another document; `...` ends the current document. Directives and anchor
names never cross document boundaries.

The filter is admitted by exact UTF-8 byte length and compiled exactly once with
the fixed baseline `parse`; the filter is not reparsed or AST-copied per input.
One `Interpreter`, one variables map with no CLI-injected variables, and one
existing `Budget` serve the invocation. Inputs are processed in FILE order, then
document order, and each document is passed independently to that compiled AST.
Generator yields retain engine order. No array of documents or results is
implicitly constructed.

The accepted query grammar, precedence, operators, literals, selectors,
conditionals, assignments, optional operator, arrays/objects, and functions are
exactly those in fixed blob
`a7bcafcd6a3676ed8e344dcaa1293d4593652c9c343172c5184c8c826d042b51`
(`src/commands/structured/parser.ts`). The function table is:

```text
empty select map map_values length keys keys_unsorted values type has contains
sort sort_by unique unique_by group_by add not reverse first last limit range
join split tostring tonumber tojson fromjson to_entries from_entries with_entries
min max min_by max_by any all strings numbers booleans arrays objects nulls
scalars iterables nan infinite isnan isinfinite isfinite
```

No variables are injected, so variable references fail compilation. Existing
in-memory assignment syntax is query behavior and grants no file write. There is
no Mike Farah document operator, path-expression language, env/property operator,
format operator, include/eval extension, or AST reimplementation. `fromjson`
retains its baseline query-engine semantics; it does not change YAML input
admission.

Zero yields emit zero bytes. Each yield is validated, counted against global
`maxResults` before outward publication, encoded, and completely preflighted
before requesting the next yield. Earlier complete outputs remain if a later
document/yield fails.

Default YAML output is deterministic: two-space block indentation; empty
collections as `[]`/`{}`; null/Boolean/numbers in canonical lowercase/baseline
numeric text; every string and mapping key double-quoted with YAML escapes; no
directives, comments, tags, or aliases. The first output has no header. Every
later output is preceded by `---\n`; every output ends in LF. JSON pretty/compact
and raw rules are in `C1`. No output mode writes a VFS path.

## 5. Proposed numeric vector `P1` (entire vector unapproved)

| Limit | P1 | Lifetime/meaning |
| --- | ---: | --- |
| `maxInputBytes` | 67,108,864 | Cumulative bytes received from all stdin/file sources |
| `maxDocumentBytes` | 8,388,608 | Current raw document, including its presentation bytes |
| `maxValueBytes` | 8,388,608 | Compact JSON byte measure of one composed/yielded graph |
| `maxScalarBytes` | 1,048,576 | UTF-8 bytes of one decoded scalar/key |
| `maxQuerySourceBytes` | 8,192 | UTF-8 filter bytes before synchronous compile |
| `maxDepth` | 128 | One current input/result graph |
| `maxAstDepth` | 64 | Compiled query AST |
| `maxSteps` | 1,000,000 | One existing `Budget`, whole invocation |
| `maxResults` | 100,000 | Cumulative query yields before outward publication |
| `maxCollectionSize` | 100,000 | Members in one current collection |
| `maxDocuments` | 1,024 | Cumulative composed documents |
| `maxAnchorsPerDocument` | 1,024 | Scoped to current document |
| `maxAliasReferences` | 1,024 | Cumulative accepted aliases in the invocation |
| `maxDocumentNodes` | 100,000 | Original plus alias-copy nodes in current document |
| `maxOutputBytes` | 16,777,216 | Combined successfully admitted stdout and stderr bytes |
| `diagnosticReserveBytes` | 4,096 | Fixed part of output cap unavailable to stdout |
| `maxDisplayedFilenameBytes` | 256 | Escaped filename field inside a diagnostic |

The 8 KiB source cap is an intentionally conservative engineering choice, eight
times below the baseline jq default. Fixed-source proof shows token/AST storage
is `O(S)` but suffix regular expressions, repeated path validation, and error
diagnostics can do uncharged `O(S²)` synchronous work. The cap establishes a
finite admitted envelope; it is not a measured latency, heap, RSS, instruction,
or preemption guarantee. Raising it requires a new root decision or a separately
approved compiler/accounting change.

All additions and multiplications for admission use checked safe-integer
arithmetic and fail before the operation whose projected quantity exceeds a
limit. Exact byte rules are:

- source, argv, raw input, scalar, raw output, separator, newline, and diagnostic
  bytes are UTF-8 byte counts, never UTF-16 `.length`;
- `maxInputBytes` counts every received source byte, including BOMs, comments,
  whitespace, document markers, and bytes later rejected; it excludes argv and
  filter bytes, which have their own admission checks;
- `maxDocumentBytes` counts raw bytes assigned to the current document/prefix;
  document markers are assigned once, not duplicated between documents;
- graph value bytes use the fixed baseline compact JSON measure, including
  escaped string/key bytes, punctuation, and baseline Decimal text;
- output counts the exact finally encoded bytes, including YAML `---\n`, every
  escape/indent byte, raw string bytes, and trailing LF.

The resolved yq shared fields are passed unchanged into the single baseline
`Budget`; there is no inner/outer pair and therefore no invented `min` rule. The
additional YAML counters are private invocation-local checked integers, not a
public shell-global budget or capability claim. Existing jq defaults and behavior
remain unchanged.

## 6. Exact work/counter decomposition and checkpoints

For the future yq-owned asynchronous scanner/composer/validator/encoder, one
owned work unit is charged through `Budget.step()` for each decoded Unicode code
point, emitted token/event, composed node, copied alias node, recursively
validated node, and encoded node, plus one unit per started 1,024 UTF-8 payload
bytes copied or emitted. A checkpoint calls `Budget.tick()` after at most 1,023
such owned units without an await; that call itself is one additional existing
Budget step and may yield at the Budget's private threshold. Awaited input/output
boundaries also observe the borrowed signal. This is implementable using current
methods and states the admitted unit; it is not an allocation or CPU-instruction
counter.

The synchronous fixed query compiler gets only its actual baseline charges
(notably numeric literal conversion). Its source scan, token creation, AST node
creation, validation walk, regex work, and diagnostic scans are **not** observable
as Budget units and MUST NOT be reported as charged. Its upfront source-byte and
AST-depth checks are admissions, not work counts. It cannot yield while inside
`parse` or preempt opaque host execution.

The interpreter retains every actual fixed-engine `step`/`tick`, collection,
value, and Decimal charge. The adapter does not invent a query-instruction or
allocation count. Result count increments exactly once immediately before each
outward yield; exceeding `maxResults` publishes none of that yield. Validation
and encoding use the yq-owned rules above.

`Budget` steps, input bytes, output bytes, and results plus cumulative documents,
aliases, and input bytes never reset at file, document, parser, compiler,
interpreter, result, or encoder boundaries. `maxDepth`, one-graph value/node
maxima, collection size, anchors, and current-document bytes are scoped maxima,
not monotonic counters; starting a new document clears only that scoped state.
Clearing anchor names does not clear cumulative alias work or counts.

## 7. Retention and whole-document qualification

Each document is fully admitted under raw-document bytes before composition and
fully composed before query. Retained producer chunks are copied into owned bytes
before advancing; borrowed `slice`/`subarray` views are not retained. A streaming
provider is consumed with `readBytes` and the borrowed signal. A fallback
`readFile` receives `maxBytes: remaining`, then its result is checked, but a
nonconforming provider may allocate before honoring or rejecting that request.

There is deliberately no `maxRetainedBytes` claim in P1. A truthful conservative
logical-payload inventory includes, when simultaneously referenced: owned raw
chunks (`R`), decoded document text (`T`), token/composition/anchor metadata,
expanded input graph (`M`), compiled query source/AST, interpreter inputs and
unknown intermediate graphs, current yielded graph (`Q`), encoder fragment
payload (`E`), joined text, suffixed text, and final byte buffer. Completed anchor
caches contain counts and graph references; alias deep copies are included in
`M`, not hidden.

For the fixed JSON-style fragment/join/suffix/buffer path, known encoded payload
alone can reach `M + Q + max(2E, 3E + 2s)` while the interpreter may still retain
its input, where `s` is the separator/newline suffix bytes. YAML whole-document
encoding has the same categories and MUST be documented from its actual code.
This formula excludes token/AST/object/array metadata, string representation,
ropes, allocator slack, garbage-collection lag, and opaque engine intermediates.
The limits bound each named logical payload and the no-slurp design prevents an
all-stream array, but they do not prove an aggregate heap or RSS maximum. No
release is called a lease, and dropping a reference is not claimed to return RSS.

## 8. Narrow private adapter boundary

If D5 is adopted, the only query reuse layer should be a narrow private adapter
under `src/commands/structured/`, with no root/barrel/package export and no copied
parser/evaluator. In principle it needs exactly three factories/operations:

1. create one query session from the resolved limits, borrowed signal, and empty
   variables map; the session owns exactly one `Budget` and interpreter;
2. compile exactly one source through fixed `parse`, rejecting another compile;
3. run the compiled AST for one borrowed input and expose its async yields, plus
   baseline value measurement/JSON encoding needed by the private yq consumer.

Exact TypeScript names/signatures remain part of the future pre-code freeze, not
an API promised here. The adapter MUST close each generator in `finally`, preserve
fixed errors internally, and let the yq boundary map only approved language
errors. It MUST NOT catch/remap caller cancellation, sink failure, or cleanup/
control failure. No `eval-all`, slurp, public query core, root export, or aggregate
registration follows from this proposal.

## 9. Proposed output admission and errors `E1` (unapproved)

`stdoutCap = maxOutputBytes - diagnosticReserveBytes`. Before any bytes of a
current output document are submitted, count/encode the entire document including
its possible YAML separator and final LF. Publish it only if prior stdout plus
that document is at most `stdoutCap`, prior combined output plus it is at most
`maxOutputBytes`, and the global result limit has admitted the yield. A known
limit therefore emits none of that document. An awaited sink may still fail
after accepting a prefix; no transaction or rollback is claimed.

Diagnostics use one LF-terminated ASCII framing line:

```text
yq: CATEGORY: CODE [at JSON_ESCAPED_SOURCE[:LINE:COLUMN]]\n
```

`CATEGORY` is one of `cli`, `query`, `input`, `schema`, `alias`, `limit`, `vfs`,
or `encode`. `CODE` is a stable uppercase identifier, not the offending argv,
input, query excerpt, host message, or stack. Source is `<stdin>` or a filename
encoded incrementally as a JSON string; controls, quotes, and backslashes are
escaped. It is truncated on a Unicode-scalar boundary so the complete escaped
field, including quotes and a terminal ASCII `...`, is at most
`maxDisplayedFilenameBytes`. Line/column are one-based and appear only when the
parser has structured location data; no location is invented from an opaque
query/VFS error.

The preferred diagnostic is admitted atomically from the untouched reserve. If
it does not fit, use exact ASCII fallback `yq: limit: DIAGNOSTIC_TRUNCATED\n`; if
that does not fit, emit no diagnostic. Every successfully submitted stderr byte
increments the same `Budget.outputBytes`; stdout never consumes the fixed reserve.

Proposed normal statuses are: success `0`; CLI or VFS input-open/read `2`; query
compile `3`; YAML syntax/composition, schema/tag/alias/value validation, query
runtime, limit, or encode `5`. An empty stream or zero query results succeeds with
zero output. There is no exit-status option. Unknown options always produce
status 2 and `CLI_UNKNOWN_OPTION`, without echoing the option. The first selected
language failure stops further input. Already emitted complete documents remain.

Caller cancellation (with exact reason identity), stdout/stderr sink rejection
including EPIPE, escaping execution/control rejection, and cleanup rejection are
not normal statuses and MUST NOT be masked by a diagnostic attempt. Typed VFS
input errors map only when they are the selected language path; cancellation-like
errno shapes do not override an aborted caller signal.

## 10. Cancellation, ownership, and settlement

The command borrows `context.signal` and never aborts the caller's controller. It
registers one shared, idempotent invocation close synchronously through optional
`registerCleanup` before creating/admitting input iterators, output operations, or
other invocation-owned resources. The same close is called from `finally`; its
overlapping calls share one completion. It closes acquisition admission first,
then drains admitted cooperative resources. If the hook is absent, `finally`
still closes local resources but cannot invent a host settlement barrier.

Stdout and stderr are sibling destination operations. Closing stdout because its
consumer closed does not cancel stderr, VFS/header work, the borrowed caller
signal, or the whole command merely to close that destination. Each owned output
operation follows cleanup-before-acquisition and awaits writes for backpressure.
Unenrolled sinks and wrapping alone gain no ownership or arbitrary preemption.

All VFS reads use the supplied signal; all source/sink iteration uses
`readBytes`/`writeBytes`. Iterator returns and cooperative late rejections are
observed. Completed effects cannot be undone. Opaque/uncooperative host work is
not forcibly killed or promoted into registered cleanup.

Public settlement follows the existing root cleanup barrier and outcome order:
caller abort observed before settlement by exact identity; otherwise selected
execution/control rejection unchanged; otherwise cleanup failure(s); otherwise
the numeric result. Cancellation is checked around awaited I/O and owned
checkpoints, but synchronous query compilation and uncooperative host JavaScript
have no hard-preemption promise.

## 11. Acceptance evidence still required

This packet defines prospective cases; none ran. After root adoption and a
different pre-code freeze, tests must cover every accepted/rejected CLI spelling,
compile-before-input effects, all scalar/tag/key/numeric boundaries, UTF-8 and
chunk reuse, documents/empty streams, aliases and copy admission, shared-counter
exhaustion across files/documents, zero/many yields, exact YAML/JSON/raw bytes,
diagnostic reserve, partial sink failure, cancellation identity, cleanup ordering,
and actual Shell/registry invocation. Existing exact jq regressions remain
mandatory. Mock/backend success alone is not deployed-provider acceptance.

Primary language source: [YAML 1.2.2](https://yaml.org/spec/1.2.2/), especially
sections 3.2, 3.3, 5–9, and 10.3. The historical
[YAML 1.1 merge type](https://yaml.org/type/merge.html) is exclusion context only.
These citations are specification reads, not reference execution or parity proof.

