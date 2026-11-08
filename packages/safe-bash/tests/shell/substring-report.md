# Scalar substring author checkpoint

Implements the scalar substring capability routed after independent baseline
`3243c5a86a23408b3b844a017db6a5a94f064d1b`, not a broader kernel reconciliation.
The unchanged handoff expression now produces `6:bca:default:set`, status0,
empty stderr. The frozen original36/72 were not rerun or edited by this author;
the independent owner reruns them after source freeze.

## Supported semantics

- `${NAME:offset[:length]}` and numbered scalar positional parameters, including
  `$0`, `${10:...}` and equivalent decimal spellings with leading zeroes. Unbraced
  `$10` retains the existing `$1` plus literal `0` parsing.
- Arithmetic offset/length, variable references and assignments, increment,
  nested parameter/command/arithmetic expansion, and nested ternary delimiters.
  Uses the existing signed64-bit arithmetic evaluator, not numeric-prefix parsing.
- Omitted length extends to the end; an explicit empty length is zero. Empty
  offset with a length is zero. Bare `${VALUE:}` is a fatal bad substitution,
  matching the primary. A space before a negative offset distinguishes it from
  existing `:-` default expansion. Negative lengths locate an end-relative end.
- Value is captured before arithmetic side effects. Unset values skip arithmetic;
  set empty values evaluate it. Offset is evaluated first; an out-of-range offset
  skips length evaluation. Valid offset and negative-length errors preserve
  existing fatal expansion scopes and earlier effects.
- Bounds remain BigInt until clamped to the bounded string/byte length. Quoted
  results remain one field; unquoted results use existing splitting/globbing.
  Source/dot/eval/function state and child/substitution isolation are unchanged.

The lexer only enables parenthesis/ternary-aware colon delimiters inside the new
substring operands. General shell grammar is not rewritten. Nested syntax is
still parsed before unit effects; arithmetic expression errors remain deferred
until expansion. Malformed operands do not execute later words or length work.

## Encoding and explicit limits

In the tested UTF8 locale, slicing counts Unicode code points, not UTF16 code
units or grapheme clusters. In C/POSIX byte locales, bounds count UTF8 bytes.
Byte-aligned slices that remain valid UTF8 are supported. A slice leaving an
invalid UTF8 fragment fails explicitly with status1 and
`substring expansion splits a UTF-8 character in a byte locale`.

This is an actual native gap, not a matching result: native Bash can return those
raw bytes, while the existing shell argument/value representation is a JavaScript
string. The two C-fragment raw differences stay in the comparison denominator.
The test suite separately asserts the explicit unsupported error; these tests
must not be called native passes. No replacement decoding, locale-per-case oracle,
binary-pipeline conversion or global byte/string architecture change is added.
Other locale/encoding families remain subject to the existing locale classifier;
no general multibyte-encoding support is claimed.

Arrays and list-valued `@`/`*` substring forms are outside this increment and get
an explicit unsupported error. New substring forms are limited to scalar names
and numbered parameters, not every special parameter. Existing arithmetic and
shell-word grammar limitations remain; no general Bash syntax expansion follows.

## Budgets and state

The existing source, command, loop, depth, output and expansion limits remain
shared. Source values, expanded arithmetic text and recursively referenced
arithmetic variable strings are byte-bounded before parsing/slicing. The existing
arithmetic evaluator retains its operation/recursion limits. A read-through
variable adapter preserves readonly writes, cancellation reason identity and
typed limit failures. There is no new Shell/Budget, environment reset or API.

The hard-bounded child has16 checks: command/loop/depth/output/source/expansion
limits, oversized arithmetic-variable and command-substitution witnesses, UTF8
source-byte accounting, binary stdin cursor/origin, cancellation with late
rejection, source export/state, nested syntax prevalidation, unsupported list
forms and readonly protection. It runs with strict unhandled-rejection behavior
and a5000ms process-group deadline. Cooperative finite input only; no first-read
lifecycle or accepted accounting-cohort rerun.

## Native evidence and chronology

`substring-native.json` was frozen before initial product edits: the SAME50 cases
under both complete locale profiles C and en_US.UTF-8, with both pinned GNU5.3
and historical3.2 (200 case executions). Each binary's version and actual locale
character-count witness are recorded: `é🙂` has6 C bytes versus2 UTF8 characters.
OS argv0 is bash and the explicit `-c` source name is shell. Product uses that
same explicit source name uniformly through virtual `bash -c`, including `$0`.
No source-name normalization or per-case native profile is used.

Executables are the existing pinned
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` and `/bin/bash`; their full
hashes/version strings are in the artifact. No native child interpreter/tool is
needed for these cases. Each native process has a2500ms group deadline and256KiB
output bound; main fixtures run in isolated temporary directories with scrubbed
PATH/HOME/locale/TZ and explicit stdin. All groups are awaited and cleaned.

Tuples retain exact stdout/stderr base64 bytes, status and flat regular-file
name/content maps, including writes by offset/length substitutions. Creation
modes are NOT asserted by this cohort: the separately known0666-versus0644
creation-mask gap is unchanged, not converted into a profile pass or fixed here.

Initial `substring-red.json` preserves2/100 author passes and98 failures. During
review, the newly parsed multi-digit positional family exposed `${00}` selecting
an absent slot instead of `$0`. A separate four-case whole-profile C cohort was
frozen before that correction (`substring-positional-native.json`):3/4 virtual
before,4/4 afterward against BOTH native profiles. Its initial pure/no-file
capture used /tmp cwd; the helper was then corrected to isolated directories
and the whole eight-case native capture repeated, byte-identical including the
still-red virtual observations. The earlier scratch capture is retained; no
case/oracle/source normalization or product retry disguised the defect.

## Results

| Check | Result |
| --- | --- |
| Main GNU5.3, C |48/50 exact byte/status/content tuples;2 explicit UTF8-fragment gaps|
| Main GNU5.3, en_US.UTF-8 |50/50 exact|
| Main historical3.2, C |39/50 exact;11 retained differences|
| Main historical3.2, en_US.UTF-8 |41/50 exact;9 retained differences|
| Supplemental positional cohort |4/4 against each complete native profile|
| Author TAP |105/105:100 main assertions,4 positional,1 bounded child; not105 native matches|
| Affected parser/expansion tests |132/132|
| Existing source/eval |86/86|
| Existing current-shell |43 leaves +1 wrapper =44/44|
| Final global/build/benchmark noEmit |0/0/0;1108/308/417 prelisted inputs|

Thus selected primary raw parity is102/104 across the main and supplemental
observations, not104/104. Historical is84/104. Historical losses include negative
length support, nested-parameter operand parsing and fatal diagnostic context;
all raw rows remain in the complete frozen artifacts. No historical behavior is
adopted per case. The initial owned helper TS7034/TS7005 failure is retained in
validation evidence; an explicit observation-array type fixes it without casts,
ignores or weakened compiler options. Final guards report no changed inputs,
import mismatches or unguarded compiler files. Existing current-shell children
also enforce their own per-row source guards.

`substring-validation.json` records actual TS import/source hashes, raw comparison,
both validation attempts, compiler-input counts/digests and detailed scratch guard
artifact hashes. Raw logs/full unique input maps remain at their recorded scratch
paths; the durable runner recreates them. No emitting tsc or dependency install.

```sh
node --import tsx tests/shell/substring-native.ts capture > /tmp/new-substring-native.json
node --import tsx tests/shell/substring-native.ts compare > /tmp/new-substring-comparison.json
node --import tsx tests/shell/substring-positional.ts > /tmp/new-positional-native.json
node tests/shell/substring-verify.mjs /tmp/new-substring-validation.json
```

These commands do not overwrite the committed expectations. The capture helpers
are test-only; product code never spawns a native process or uses host PATH/FS.

Primary source consulted: pinned GNU5.3 `doc/bashref.texi:2397` (substring),
`subst.c:8388` (`verify_substring_values`), `subst.c:9043`
(`parameter_brace_substring`), and `subst.c:3705` (numbered argument values).
These establish unset short-circuit, arithmetic sequencing, bounds, multibyte
selection and numeric positional lookup; the native cohorts establish measured
version/locale differences rather than assuming them from a modern manual.

No env-shebang options/errexit, interpreter allowlist/status, creation mask,
core/FS/contracts/public exports/manifests/dependencies changes. Frozen36/72,
old9 archived diagnostics, five custom first-read and other reconciliation gaps
remain separate. Different-agent acceptance is required after source freeze;
this is not full-shell completion or a superiority claim.
