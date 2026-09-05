# Bounded Mike-profile yq qualification

Status: explicit source and repository-local optional-build profile. This is not
full Mike Farah yq compatibility and does not replace the existing restricted
source implementation. There is no default registration or published npm subpath.

The local optional entry aliases `createMikeYqCommand`, `createMikeYqCommands`,
and `mikeYqCommands` as `createYqCommand`, `createYqCommands`, and `yqCommands`.
It exports their options and limits as `YqCommandsOptions` and `YqLimits`.
The old `src/commands/yq/index.ts` retains its distinct restricted dialect.

The earlier independent and root native-profile cohort passed 236 tests with
zero skips. Its actual compiled/public-host suite passed 21 tests, including commented in-place
updates, compact JSON, shared output-limit rejection, source preservation and
temporary-file cleanup. Strict consumer types pass. Initial declaration emit
failed on an inferred public AbortSignal type; an explicit annotation repairs it
without changing execution. Two initial public directory-list expectations used
strings instead of the filesystem contract's entries; those test-facade errors
were corrected without product changes. Those checks do not qualify later source
changes or the additional cases described below. Native compatibility limits remain.

Commit `3c9bcfe60` also captured a prepared 31-line addition to `edge.test.ts`
during the root stage/`--only` commit window: 17 next-phase observations and one
live native confirmation. Its post-commit cohort was 254 tests: 241 passed and
13 failed, with zero skips. This was an integration-coordination error in the
milestone boundary, not a regression of the earlier 236 tests. The committed
tests and history are preserved; no amend, revert or assertion weakening was used.
The first repair cohort passed all 279 tests with the explicit pinned oracle.
Root subsequently reported native/public and build/optional-compile passes for
that boundary. Carver's next independent review added 36 tests: 29 passed and
seven failed before the corrections recorded below. The current combined cohort
passes 322 tests, including seven further boundary tests. Root compiled/public,
package and independent-review gates must qualify these latest source corrections
separately. Full requested yq compatibility remains unfinished.

## Identity and dependency boundary

- `src/commands/yq/mike.ts` exports `createMikeYqCommand`,
  `createMikeYqCommands`, `mikeYqCommands`, and `MikeYqOptions`.
- Definitions carry `commandRuntimeIdentity`; definitions, factory arrays and
  plugins are frozen. The plugin snapshots its replacement policy. Options accept
  only `replace` (boolean) and `limits` (the bounded overrides below).
- `yaml` is dynamically imported only after argument and expression admission.
  Help/version do not resolve that peer. The lazy-loading test rejects attempted
  `yaml` resolution to verify this boundary. No native product fallback exists.
- The approved installed parser is yaml 2.9.0. Root owns its optional-peer metadata,
  package entries and build exclusions. These tests do not establish published
  package availability or a default-core import/build gate.
- Primary, eval and eval-all help text is captured from the pinned native tool.
  Exact primary help is tested independently of the product's help constant.
  Help necessarily lists native functionality that this bounded candidate does
  not implement; it is not a support inventory.
- Version is deliberately truthful rather than impersonating the native binary:
  `yq (safe-bash; bounded Mike Farah v4.53.3 profile)` plus newline.

## Native prerequisite and evidence

Native suites require BOTH explicit environment variables:

- `SAFE_BASH_TEST_YQ`: executable native oracle path; no default temporary path.
- `SAFE_BASH_TEST_YQ_SHA256`: expected SHA-256.

The qualified reference is Mike Farah v4.53.3, Darwin arm64, with SHA-256
`877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213`.
The harness supplies `LC_ALL=C` and `NO_COLOR=1`. Both variables absent skips
only live native assertions; preserved capture and VFS tests still run. Partial,
malformed, missing-file or hash-mismatched supplied prerequisites fail. The helper
reuses the separately maintained yq-scripting authentication/lifecycle harness:
regular executable admission, 32 MiB executable bound, bounded hashing, two-second
child supervision, separate 1 MiB stdout/stderr bounds, and awaited child close.

- `ORACLE_INITIAL.json`: preserved initial help and 45 native observations.
- `ORACLE_EDGE.json`: preserved next 19 native observations.
- `edge.test.ts`: additional explicitly recorded expectations and live comparisons.
- `ORACLE_BOUNDARIES.json`: eight preserved mismatches with contemporaneous source
  hashes and raw native/product outcomes. Its source hashes are historical evidence,
  NOT seals on current product code. Cases 2, 3, 5 and 7 were subsequently repaired
  with failing-then-passing exact regression tests; the original bytes remain.
- `ORACLE_INPLACE_ROOT.json`: root's manual 14-case native filesystem capture,
  copied byte-for-byte with SHA-256
  `ffb6e840b17b284c49f70c0e53e8c90ba1d39e8f3cb164e0aa785832d30f4fff`.
  Tests authenticate its request hash, oracle binding and literal case membership.
  These are preserved native effects, not a live host-fixture unit test.
- Boundary case 6 (slicing) was subsequently repaired with 15 failing-then-passing
  regressions and live native confirmation; its original failure capture remains.
- Legacy merge warnings contain a wall-clock timestamp. The two dedicated tests
  check exact status, stdout and warning body plus a parseable timestamp, NOT full
  stderr byte equality across different invocation times. The product currently
  uses the host-local clock/timezone, not a separately virtualized `TZ` setting.

Official implementation references consulted: tagged v4.53.3 `yq.go`,
`cmd/root.go`, `cmd/utils.go`, eval/eval-all command implementations, and yqlib
assignment, traversal, tag, decoder, encoder, printer and in-place implementations
in the Mike Farah repository. Parser/API reference: `https://eemeli.org/yaml/`.
The native executable is a test oracle only; tests never create host fixture files.

## Implemented and qualified core

- CLI: eval/e, eval-all/ea, `-n`, `-p yaml|json|auto`, `-o yaml|json|auto`, `-i`,
  `-I`, `-e`, `-r`, `-N`, `-M`, `-c`, help/version, `--expression`,
  `--yaml-fix-merge-anchor-to-spec`, associated supported long names, attached
  values, equals values, bool values, short clusters, `--`, and repeated options.
  Base-zero signed integer indent grammar includes octal/hex/binary and legal
  underscores. Out-of-int64 values reproduce tested parse diagnostics; admitted
  values outside safe JS integer range are explicitly refused by a safety limit.
- Input: stdin, explicit `-`, VFS files, multiple documents/files, inferred JSON
  from the first filename and explicit JSON parsing. Null-input does not acquire
  stdin. Eval publishes earlier documents before a later YAML parse error;
  eval-all waits for all documents. All input bytes are bounded before parsing.
- Query: identity, fields/indexes, bounded Unicode/array slices with omitted and
  negative bounds, iteration/recursive traversal, pipes, comma,
  literals, arrays and quoted-key maps, selection/map, basic comparisons,
  boolean/default operators, scalar arithmetic, map merge/sequence concatenation,
  assignments and updates, tag/style operations, length/keys/has, document/file
  metadata, del, and supplied-context env/strenv operations. This is a private
  bounded evaluator, not the shared jq-oriented query-core.
- Assignments retain tested comments, quote styles, anchors and tags. YAML
  integers retain precision; tested int64 arithmetic wraps as native. Explicit
  JSON input follows the native float64 rounding behavior for tested unsafe ints.
  Its integer classification also reproduces the pinned Darwin-arm64 int64
  conversion boundary: rounded 2^63 becomes 9223372036854775807, while larger
  distinct float64 values remain floats. This is not arbitrary-precision JSON
  preservation or a qualification of other native architectures. Float spelling
  uses the tested Go-style exponent threshold and two-digit exponent minimum.
  JSON output retains ordered/duplicate map entries in the tested cases.
- Default YAML scalar unwrapping and JSON quoting, indentation, document
  separators, empty streams/documents, `-e` no-match/false/null behavior, selected
  alias output, custom numeric tags and specified diagnostics have exact cases.
- Merge-key traversal implements both legacy ordering and explicit spec ordering,
  including merged-value assignment to the source anchor and sequence precedence.
  Alias expansion/traversal is bounded, including cyclic merge rejection.

## Resource and cleanup contract

Limits may only be lowered to positive safe integers; unknown limit names fail.
Defaults are:

| Limit | Default |
| --- | ---: |
| maxInputBytes | 8 MiB |
| maxDocumentBytes | 1 MiB |
| maxScalarBytes | 256 KiB |
| maxNodes | 100,000 |
| maxParserNodes | 4,096 |
| maxDepth | 64 |
| maxAliases | 1,024 |
| maxDocuments | 1,024 per invocation |
| maxOutputBytes | 16 MiB |
| maxSteps | 8,000,000 |

Argument admission separately limits 4,096 arguments/64 KiB; expressions are
limited to 8 KiB and bounded parser depth. Node accounting conservatively charges
source nodes, candidates and clones, not just final logical output nodes. Physical
input lines are also bounded by maxScalarBytes. Limit refusals are explicit status-1
diagnostics, not silent truncation or claimed native capacity parity.

YAML input is lexed in bounded fragments with CST/depth/node admission before
recursive composition. A lexical quote-continuation adapter supplies required
indentation for the pinned native parser's accepted outdented quoted scalars;
literal/block content is not rewritten as quoted content. Added workspace is
admitted against input/document/node/work limits before parser materialization.
Thus an original document that exactly fits a limit can explicitly fail if the
adapted parser workspace exceeds it; this is not silent output truncation.
Source offsets are mapped back for diagnostics. Document-indicator errors are
reported at document acceptance, preserving earlier eval output.

JSON framing/depth/byte admission precedes a cooperative ordered-node reader.
Objects become YAMLMap pair sequences directly, never ordinary JavaScript
objects; duplicate members and numeric-looking key order survive. Node admission
precedes container/key/value construction. JSON.parse is restricted to bounded
scalar tokens, with decoded string-byte admission before node construction.
Decoded JSON strings replace unpaired UTF-16 surrogates with U+FFFD, preserving
valid pairs. Native object decoding accepts omitted commas between successive
quoted keys, even without whitespace; the ordered reader reproduces this without
accepting omitted array commas or constructing ordinary host objects. JSON numeric
source spelling is emitted only after JSON-number grammar validation, so a YAML
float such as `!!float +1.5` cannot introduce invalid JSON syntax.
Work yields periodically during scans/evaluation, including empty input chunks
and byte-oriented wildcard matching. Library composition, scalar JSON.parse,
clone and stringify still have synchronous
regions. Their admitted input/node/depth/serialized-size bounds do not make those
library calls asynchronously preemptible or establish a hard RSS/wall-time limit.
Before YAML stringify, a conservative hard 16 MiB projection bounds allocation;
the configured output cap is then checked against actual serialized bytes, so
small exact-fitting output is not rejected merely by the conservative estimate.

Cleanup registers before resource acquisition. It closes admission, returns owned
iterators, drains pending next/write/acquisition operations and late resources,
and is idempotent across concurrent close/finally. Input chunks are copied before
advancing reusable producers. Non-streaming VFS readFile receives maxBytes.
Destination output enrollment/backpressure is respected. Falsey primary sink
failures survive secondary cleanup errors; external cancellation takes precedence.
Uncooperative host promises cannot be forcibly cancelled. Diagnostics have a
separate 64 KiB bound; full stdout limits also apply to help/version.

## In-place effects and outstanding qualification

VFS tests cover first-file-only publication, multi-file eval/eval-all, mode/comment/
quote preservation, symlink following, hardlink breakage on ordinary replacement,
rename-refusal copy fallback, failure/no-match preservation, quota refusal and
late-stage cleanup. Staging uses CSPRNG names and exclusive VFS creation. Raw
invalid UTF-8 filenames cannot alias replacement-decoded paths; lexical `..` is
not collapsed before the provider resolves symlinks.

All 14 exact root-run cases in `INPLACE_REQUEST.json` now have preserved native
evidence and passing VFS comparisons: the original nine plus empty assignment,
empty identity, no-match without `-e`, later-document failure and 0444 mode.
Tests compare status/output bytes, regular file bytes/modes, link text, nlink,
complete work-directory namespace and inode-replacement relations. They also
compare owner/group preservation relations for these executor-owned fixtures,
not literal host inode/uid/gid values across different providers. Symlink mode is
preserved relative to each backend's initial mode, not asserted equal between
Darwin's initial 0755 and memory's initial 0777. Clock values are preserved in
raw evidence but not claimed interchangeable with the VFS clock.

Native failure cases `invalid-query`, `invalid-yaml`, `no-match`,
`later-input-failure` and `later-document-failure` leave TMPDIR staging files.
Their exact names, metadata and bytes remain in the capture. The product instead
cleans its staging resources and leaves no extra work/tmp entries; this is an
explicit safety exception, NOT exact temporary-namespace parity.

No additional native fixture captures are currently needed for this 14-case
cohort. Arbitrary uid/gid preservation still has no implemented chown contract;
permissionless provider modes are advisory. Copy fallback is not atomic and a
backend may leave partial target writes after failure. A failed exclusive-create
write that itself leaves a file is not a portable acquisition receipt; no universal
rollback/leak-free claim is made for such a provider. Use filesystem quotas for
memory-backed untrusted scripts, including staging/copy capacity.

In-place output participates in the Shell's shared output budget through counted
admission using the original invocation cleanup identity. Staging five bytes
charges five before exclusive creation; rename charges zero; copy fallback
requires a separate five-byte admission before touching the original. Refused
admission preserves original bytes and removes any already-owned staging file.
Ordinary stdout retains its existing single charge. The command's local serialized
output cap is separate from this shared physical-write accounting.

Cleanup is registered before staging acquisition and waits for its actual writer
receipt even when cancellation makes counted completion reject. Local execution
and close drain staging and fallback writes without relying on Shell's external
cleanup barrier. Four controlled-promise direct-execute regressions cover both
phases with Error and falsey cancellation reasons and no registerCleanup hook.
A late successful fallback write can change the original after cancellation;
the command waits for it and cleans staging, but does not claim rollback.

## Open compatibility boundaries

Full requested yq remains open. Preserved boundary case 0 (outdented multiline
quotes) is now repaired by the admitted lexical adapter; its old mismatch capture
remains unchanged. Cases 1 and 4 still demonstrate non-native malformed-JSON
diagnostics for `1\n{bad` (earlier JSON results publish), and a native negative YAML
indent panic versus a controlled product error.
Native panic addresses/stack bytes are retained as evidence, not imitated.

Other unqualified areas include full Cobra grammar outside supported flags,
all YAML/JSON diagnostic grammar, mixed auto-format files, tag coercions/composite
style flags, complex keys, arbitrary directives/header/formatting round-trips,
full Mike expression operators (variables/reduce/functions/regex/load/etc.),
other formats, colored/debug output, split-file operations, and native -i failure
metadata details. Text input/argument admission is UTF-8-only. No host system/load
fallback, implicit network capability, or published/full-dialect claim is made.

Review repairs distinguish absent read-only assignment matches from explicit null,
copy the right operand for null-left addition, compare scalar lexical text rather
than JavaScript types, and measure scalar length in UTF-8 bytes (including numeric
spellings). The next-phase repairs add byte-oriented `*`/`?` equality matching,
including the native four-question-mark treatment of a four-byte Unicode scalar;
brackets remain literal. Existing-array reads now grow out-of-range positive
indices with nulls under node/work admission, including read-only assignment RHS.
String/numeric and sequence/scalar addition, the tested custom integer tag, and
hexadecimal addition spelling have native regressions. Parenthesized computed
tag assignment remains detached rather than becoming a tag mutation; direct tag
assignment and explicit quote styling preserve scalar spelling. These verified
operations do not establish full expression, tag-coercion or parser compatibility.

## TDD record

Initial stub: 46 failing tests, one unavailable-native skip. Subsequent preserved
red cohorts include the lifecycle admission/race defects, 11 edge mismatches,
9 alias/diagnostic/accounting failures, 6 merge failures, 9 indent/CLI failures,
2 factory/JSON-admission failures, 10 tag/scalar failures, 3 partial-output/file
diagnostic failures, 4 repaired-boundary failures and 15 slice failures. Slicing
also exposed temporary-result assignments incorrectly replacing the source root;
root candidates are now explicit and slice assignment operates on detached nodes.
All 14 root in-place effect cases passed on their first addition, so no product
repair or fabricated red phase is attributed to those additional coverage tests.
Test-fixture corrections
were explicit: cancellation timer begins after producer acquisition, and plugin
registration rejection is awaited through Shell.exec rather than expected
synchronously from Shell.use. The prior leaf cohort was 184 passed. Socrates added
30 unchanged independent review tests: nine failed (five shared-budget and four
expression defects). Counted in-place admission repaired the five budget failures.
Seventeen adjacent expression cases plus their live native confirmation then ran
red: five passed and thirteen failed, including the passing native confirmation.
The evaluator repairs make these and all four reviewer expression cases pass.
The four direct writer-drain tests were green when added; they establish additional
coverage, not an invented additional defect or red phase.

The earlier 236-test cohort passed with the explicit pinned oracle; without
prerequisites it had 224 passes and 12 live-only skips. The additional committed
18-test cohort ran red with five passes (four controls and live confirmation) and
13 failures. Repairs address all 13 without modifying their expected results.
Nine quote-boundary tests then ran with three passes and six failures before the
adapter repair. Two further failures exposed premature later-document diagnostics
and case loss under quote styling; their native confirmation passed. Both were
repaired. Eight ordered-member/wildcard controls and four resource-admission tests
passed when added; no fabricated additional defect is attributed to that coverage.
One further safety regression ran red when repeated malformed quoted documents
allocated later diagnostic records until maxNodes replaced the known first syntax
error. The adapter now stops at the first known quote error and defers its delivery
to document acceptance; the regression passes without losing earlier output.

The first frozen repair boundary passed 279 tests with the pinned oracle and zero
skips; without prerequisites it passed 263 with 16 live-only skips. Carver's next
unchanged 36-test review reproduced seven failures: int64-boundary JSON output,
exponent spelling, omitted object-comma acceptance, unpaired surrogate decoding,
custom-tag exponent and hexadecimal addition, and multiline-key diagnostics.
Those repairs passed 36/36 independently and 315/315 with the earlier cohort.

Six additional boundary tests initially passed four and failed two: signed YAML
float output exposed unsafe raw numeric spelling, and signed custom hexadecimal
addition exposed over-permissive coercion. Both were repaired. A seventh test
then exposed a multiline-key diagnostic pointing before whitespace rather than
at its colon; it also ran red before the position correction. These controls
include explicit native confirmation, int64/exponent thresholds, valid surrogate
pairs, and nested ordered objects without commas. No review assertion changed.

Current leaf plus both unchanged independent review files: 322 passed with the
pinned oracle and zero skips; without prerequisites, 279 passed and 43 live-only
skips. Source and all seven test files pass strict types; declaration-only emission
into memory succeeds for all eight native-profile modules. These are not a new root compiled/public, whole-package,
lint or release gate. Reviewer assertions, shared helpers and sealed captures are
unchanged. The complete user-requested yq remains the goal, not this tested subset.
