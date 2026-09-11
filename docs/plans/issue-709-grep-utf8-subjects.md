# Issue 709: ordinary grep on UTF-8 subjects

## Required behavior

Ordinary grep with supported ASCII BRE/ERE patterns must search valid UTF-8
subjects containing accented text and emoji. Reproduce both reported HTML
searches with and without `LC_ALL=C` before implementation. Preserve original
output bytes, line numbers, selection status, and extraction byte offsets.

Define the bounded matching profile explicitly, including wildcard and bracket
semantics, invalid UTF-8 and NUL rejection. Keep unsupported pattern dialects
and case folding outside this issue. Do not add native regex fallback or alter
the independent expr and shell regex profiles without concrete necessity.

## Resource requirements

Retain request work, allocation, state, input, result and match-count bounds.
Charge subject validation and any offset mapping before retaining allocations;
avoid repeated full-subject conversions during enumeration. Preserve anchors,
empty-match progress, cancellation, disposal and output backpressure.

## Ownership and validation

The provider worker owns implementation and direct regression tests. The command
worker owns shell regressions and narrow profile documentation. An independent
reviewer checks matching semantics, offsets and resource accounting. Root owns
this plan, the exact test inventory, maintained public fixtures and delivery.

Run focused failing tests first, then passing regressions and adjacent checks.
Validate strict types, maintained workspace tests and normal build output. Run
guarded root lint serially after all source edits and competing checks finish.
Verify packaged Node, Bun, browser and actual Workers consumers and inspect a
terminal screenshot. Commit explicit paths, push main, monitor every triggered
release, verify fresh registry consumers, then close the issue.

## Reproduction and selected profile

Direct provider regressions and all seven initial command cases fail against
current source with the explicit ASCII-subject refusal. Native macOS grep
prints the expected original HTML line for both reported searches, including
the `LC_ALL=C` case. Logs: `/tmp/poe-709-provider-red.log` and
`/tmp/poe-709-command-red.log`.

Use locale-independent Unicode scalar subjects with the existing ASCII pattern
grammar. Dot consumes one scalar; positive ASCII sets/classes remain ASCII,
while their complements include non-ASCII scalars. Convert internal scalar
boundaries to original byte offsets using one budgeted map per subject. Do not
normalize text. Invalid UTF-8, NUL and non-ASCII regex patterns remain refused;
expr and shell regex subject restrictions remain unchanged.

## Focused validation

Provider, portable-executor and ERE accounting checks pass 114 tests. Command
regressions pass 24 tests, including scalar extraction, original bytes,
malformed-input refusal, cancellation, backpressure and output budgets.
Independent review passes 13 additional tests and approves the private scalar
representation and byte mapping. Strict TypeScript checks pass for these suites.
The exact integration inventory passes all 100 checks.

The normal `npm run build` completes successfully. The initial complete
`npm run test:unit --workspace=virtual-bash` passed all 303 runner checks and
advanced beyond 300 test files without a reported failure before deliberate
cancellation in response to the user's request to accelerate issue delivery.
That run is incomplete and is not claimed as a passing suite.

Use the existing exact-file `scripts/test-reporting.mjs` route for the final
focused gate: regex execution, grep, search, aliases, ERE accounting, shell
security, expr and repeat-history tests. This covers the changed matcher and
its affected consumers without rerunning unrelated command families. Root
packaging behavior is unchanged; the maintained public fixture is extended and
executed against installed artifacts separately. Guarded root lint and published
artifact validation remain required. No test-runner or lint-policy code changes
are needed for this narrower validation scope.

The final focused gate passes all 1,083 tests with zero failures, cancellations
or skips in 55.24 seconds. All 17 package lint rules also pass. The broader
interrupted run is retained separately at `/tmp/poe-709-workspace-unit.log`;
the completed focused result is `/tmp/poe-709-focused-gate.log`.

Candidate packages at `0.0.0-issue709` pass 42 checks each on Node, Bun,
a browser-conditioned bundle executed on Node, and actual workerd 2026-09-04.
All three strict type profiles and the current maintained browser fixture pass.
The browser graph contains no external imports or native worker provider.
These checks qualify candidate artifacts, not a published registry version.

The terminal screenshot `/tmp/poe-709-utf8-grep.png` is visually inspected:
accented HTML, C-locale searches, scalar extraction, no-match status and invalid
UTF-8 refusal render clearly. The direct screenshot route does not trigger a
build, and its asserted demo uses the current built public API.
