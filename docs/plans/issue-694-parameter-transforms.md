# Issue 694: bounded parameter quoting and escape transforms

## Validated scope

Implement the issue's required `${parameter@Q}` and `${parameter@E}` forms.
The previous parser rejected both before expansion. The initial semantic RED
recorded 20 failing positive cases and four passing unsupported-form controls
in `/tmp/poe-694-parser-red.log`. The earlier `/tmp/poe-694-red.log` records a
test-authoring syntax error, not product evidence. The built public consumer
also reproduced the rejection in `/tmp/poe-694-public-red.log`.

`@P`, `@A`, `@a`, combinations with other parameter operators, and prompt
evaluation remain unsupported. No host shell, eval fallback, or new command
capability is introduced.

## Semantics and implementation

The parser records a Q/E operation on the existing parameter word part. Runtime
transforms scalar, positional and indexed-array values through their existing
owned byte representation. Array/positional members are transformed before
the existing `@` field separation or `*` IFS joining. Unquoted results still
undergo field splitting: quote characters produced by Q are data during this
expansion, not newly parsed shell syntax. Unset and assigned-empty values remain
distinct, and nounset handling remains on the existing parameter path.

Q emits single-quoted or ANSI-C-quoted shell text. Apostrophes, controls, invalid
UTF-8 and raw bytes are escaped without replacement decoding. C/POSIX locales
use byte quoting; UTF-8 locales retain printable Unicode scalars and escape
control, format and unassigned characters. E decodes ANSI-C escapes, including
bounded octal/hexadecimal/Unicode forms and byte-oriented control escapes.
Unknown/incomplete escapes retain their literal spelling. The first decoded
NUL truncates the value, matching shell-value semantics. GNU-qualified legacy
Unicode escapes can produce raw non-scalar and five/six-byte sequences; they
are neither replaced nor passed through JavaScript's scalar-only encoder.
C/POSIX surrogate escapes retain their normalized literal spelling.

Zero-member transformed `@` shares the admitted quote-group metadata introduced
for prefix-name expansion. Empty contributions within the same double-quoted
group are suppressed; independent empty quote groups remain present. A real
member transformed by E into an empty value still produces one member.

Inline input now retains `ShellValue` bytes through here-documents and
here-strings. This intentionally corrects the previous command-substitution
behavior that replaced invalid bytes with U+FFFD: the historical heredoc test
now expects exact `FF C3 A9 80 0A C3 A9 0A`. NUL removal and literal Unicode
remain unchanged. Plain string input retains its original append/admission
path, without introducing metadata charges that reject previously valid tiny
byte limits. This is general byte preservation, not an origin-dependent E
exception.

Raw inline input uses a lazily allocated fragment list after the first byte
value, then concatenates once. List/fragment metadata and retained string bytes
are admitted before retention. Plain input keeps string append without that
list. A root probe and focused RED found that repeatedly concatenating the
cumulative raw prefix retained quadratic buffer bytes: a 200,000-byte ASCII
tail failed the default budget only with a raw prefix. The final path retains
linear fragments and preserves the original limits rather than raising them.

## Resource bounds

The dedicated scanner admits input length before copying and counts output in
a first pass before allocating the exact output buffer. A second pass writes
that admitted output. Both passes, input scans and quote classification use
the existing cooperative string-work ledger and original cancellation signal.
Owned input/output copies are charged to the existing value-allocation scope.
Expansion byte/field, parse, output and inline-input limits remain unchanged;
there is no new configuration surface. Live false/object cancellation and
oversized-output tests verify failure before publication or output allocation.

## Qualification and local evidence

GNU Bash 5.2.37 on Darwin supplied the byte/locale/context oracle, not a product
dependency. Records include `/tmp/poe-694-transform-oracle.json`,
`/tmp/poe-694-transform-edge-oracle.json`,
`/tmp/poe-694-transform-unicode-oracle.json`,
`/tmp/poe-694-context-oracle.json`, `/tmp/poe-694-e-locale-oracle.json`,
`/tmp/poe-694-group-oracle.json`, and
`/tmp/poe-694-heredoc-byte-contract-oracle.json`.

The focused transform/prefix/byte/indexed-array cohort passed 282/282 in
`/tmp/poe-694-cohort.log`. A broader inline cohort exposed the old lossy-byte
expectation and two tiny-byte admission regressions; its original 157/160
result is preserved in `/tmp/poe-694-inline-cohort.log`. After the validated
byte-contract correction and restoring plain-string admission, the final
inline/parameter cohort passed 197/197 in 3.59 seconds in
`/tmp/poe-694-inline-final.log`. This includes here-documents, deferred input,
input limits/retirement/independence, parameter depths, positional substrings
and the new transforms.

The subsequent large-inline RED is preserved in
`/tmp/poe-694-large-inline-red.log` (plain control passed, raw case failed).
After the linear-fragment correction, the final expanded inline cohort passed
199/199 in `/tmp/poe-694-inline-linear-green.log`, including exact-byte plain/raw
200,000-byte tails and the unchanged small-limit and retirement controls.

Strict NodeNext source/test checking passed in
`/tmp/poe-694-final-types.log`. Exact integration-test admission passed 100/100
in `/tmp/poe-694-admission.log`. Independent review approved the scanner,
quote-group and inline-byte changes. The root's 66-case source public consumer
passed in `/tmp/poe-694-source-public-final.log`, including safe Q roundtrips
with no unintended command execution.

The root coordinator owns the final normal build, installed Node/Bun/browser/
workerd consumers, visual inspection, guarded lint and delivery. These local
results do not establish those pending stages or publication.

## Final integration qualification

The first full lint run completed its 10,516-file scan but found one
`prefer-const` diagnostic in the two-pass scanner. Its counting-state variable
now explicitly starts as `undefined`, preserving its required transition to the
admitted output buffer. Focused transform tests passed 39/39 after this repair.
The first lint result in `/tmp/poe-694-lint.log` is not a passing final gate.

A repository-wide assertion search also found a stale backtick exclusion test
that still expected Q to be rejected. Its 45/46 RED is recorded in
`/tmp/poe-694-backtick-red.log`. The exclusion now uses invalid `@Q:-x`, and a
positive test verifies Q parsing and execution inside backticks. The combined
backtick/transform cohort passes 86/86 (`/tmp/poe-694-backtick-green.log`).

The initial `npm run build` passed before the declaration repair, including all 71
declared workspaces, 70 build tasks and the root generation, TypeScript and
bundle stages (`/tmp/poe-694-build.log`).

The initial installed candidate consumers passed 74 checks each in Node, Bun, the browser
bundle and actual workerd. These include GNU byte/locale/context cases, safe
quoting round trips, both 200 KB inline-input controls, byte/field limits and
Q/E false/object cancellation with no dispatch and subsequent recovery. All
three strict public-consumer TypeScript profiles passed, as did browser/workerd
graphs with 44/43 inputs. Evidence is in
`/private/tmp/poe-694-public-0ni3osho`; the root visually inspected its
`screenshots/node-demo.mjs.png`. These results do not establish publication.

After the declaration and backtick-test corrections, the final normal build
passed (`/tmp/poe-694-final-build.log`). Strict source/test checking including
the backtick regression passed (`/tmp/poe-694-backtick-types.log`). The refreshed
candidate in `/private/tmp/poe-694-final-nu49ae2t` passed the same 74 checks on all
four runtimes, all three strict type profiles and both graph checks. The prior
visually inspected screenshot remains representative: no output behavior
changed in the declaration repair.

The final maintained `npm run lint` passed in 212.14 seconds, scanning all
10,516 configured files with zero errors, zero warnings and 25 receipts,
followed by successful type and workflow checks. The repository remained
frozen throughout this gate (`/tmp/poe-694-final-lint.log`).
