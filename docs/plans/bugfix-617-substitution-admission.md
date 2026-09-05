# #617: substitution admission and owned byte construction

## Scope and status

September 5, 2026. Integrated into the live checkout after isolated review and
independent root TDD. Root owns Git, full gates, releases and issue disposition.
The previously committed #614/#615 work and filesystem-output contracts are
untouched. This document does not yet establish full-gate or release success.

## Root integration evidence

Before changing production code, root installed the unchanged final test
statements that do not require the new private buffer helper. The actual checkout
produced six behavioral failures and five passes. Root then installed the full
reviewed implementation and test file, and registered its exact canonical path.

- All 20 new tests pass on the actual checkout.
- All 321 tests across the ten adjacent text-program test files pass, with no
  selected-out cases. This includes the existing resource/loop cases omitted
  from the worker's smaller focused selection.
- All 98 maintained input-registration tests pass.
- Root preserves the original RED log, selected-statement hash, and GREEN logs.
  An initial generated-patch formatting error occurred before edits; it is a
  tooling error, not a product regression or a behavioral RED result.
- Full maintained build, unit, lint and type gates remain required before push.

Issue #617's author was verified as exactly `kamilio`. Read-only causal evidence
is retained separately under
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-617-readonly.TefCnW`.
Candidate, copied baseline, logs and integration patch are under
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/issue-617-candidate.vOXeW2`.
`baseline-files.json` authenticates the original scoped source. No Git command
was used to infer a commit identity. Source/test directories are regular private
copies; unchanged dependencies are read-only references to the live checkout.

Exactly six proposed write paths:

- `packages/safe-bash/src/commands/text-programs/regex.ts`
- `packages/safe-bash/src/commands/text-programs/replacement-buffer.ts` (new)
- `packages/safe-bash/src/commands/text-programs/sed.ts`
- `packages/safe-bash/src/commands/text-programs/awk-runtime.ts`
- `packages/safe-bash/tests/commands/text-programs/substitution-admission.test.ts` (new)
- `docs/plans/bugfix-617-substitution-admission.md` (new)

`shared.ts`, defaults, dependencies, README and registry remain unchanged.

## Validated cause and correction

Previously, replacement-template concatenations and the full per-match result
were constructed before `Budget.check` saw their lengths. Increasing a four-byte
result to 128 bytes left matching work at 18 steps and added no checkpoints.
Both sed and awk used that synchronous helper. These are logical construction
and admission observations, not proof of a particular VM rope representation.

The candidate preflights each selected match's unchanged prefix and replacement
size before allocating/copying that match's output. Template inspection, capture
lookup, byte copying, segment allocation, final contiguous copying when needed,
and Latin-1 conversion have explicit work charges. Regex matching retains its
existing work accounting and is not repeated in a second regex pass.

Replacement emission writes source spans and captures into owned byte segments,
not per-match expanded strings or a string-fragment list. The command layer's
existing Latin-1 byte-string representation is preserved. Template inspection
and emission checkpoint every 256 tokens; each token consumes at most two
template code units. Copying checkpoints at each at-most-1024-byte span, and the
outer loop checkpoints before each match search. Post-await checks guard copying
and final conversion. `finally` releases builder-owned scratch on failure.

`substitute` becomes asynchronous; its two production callers await it before
updating sed pattern space or the awk target. The formerly exported internal
`replacementText` helper becomes a private emission routine. Source/test search
found no other maintained caller of that helper. Existing pattern matching,
zero-width advancement, global/occurrence rules and replacement decoding are
preserved. Awk still rejects replacement backreference escapes before substitution.

## Capacity and overlap policy

Let C be the unchanged `maxBufferBytes` logical text capacity, S the sum of owned
segment capacities, and L the selected result length. Every admitted append keeps
L <= C, and segment allocation is capped so S <= C. There is no geometric buffer
growth/copy and no implicit reservation of remaining stdout allowance.

Segments use `Buffer.allocUnsafeSlow`, not pooled `Buffer.allocUnsafe`. A tiny
candidate audit demonstrated why: a 64-byte pooled view retained an 8192-byte
backing store. The final allocator produced a standalone 64-byte backing store
on Node 22 and the existing browser Buffer adapter. This required no dependency
or browser adapter change. Only written ranges are converted or copied.

For a single segment, conversion reads only its L initialized bytes. For multiple
segments, finalization separately admits an exact L-byte flat buffer; S + L <= 2C
is the typed backing-storage overlap bound. It drops segment ownership before
converting that flat buffer to a Latin-1 string. The returned string has logical
length L; conversion overlaps the remaining buffer, and the single-segment path
overlaps its segment with the result string. String representation, VM metadata,
allocator overhead, delayed garbage collection and other interpreter state are
not counted as physical heap bytes by this logical policy.

C remains the result limit, not a newly halved workspace limit. Exact-capacity
results are accepted. Scratch and finalization have separately bounded roles;
this is explicitly not a promise that the entire command occupies C heap bytes.
Regex match/capture storage, source/template strings, sed hold state and awk
retained state remain under their existing policies, not this builder's ownership.

Output remains independently admitted by existing sinks. The counterexamples are
preserved: `sed -n` may discard a 32-byte intermediate with an eight-byte output
allowance, and awk may print only `32\n` after expanding its record to 32 bytes.
Clamping intermediate text to remaining stdout capacity would break these cases.

## TDD and evidence

All commands used escalation, Node 22, private home TMPDIR,
`TSX_DISABLE_CACHE=1`, unset `NO_COLOR` and cleared child Git variables. Private
tests use `TSX_TSCONFIG_PATH=/home/kjopek/project/poe-code/tsconfig.json` to retain
maintained source resolution. The initial loader-only failure (`red.log`) is
retained but is not counted as behavioral RED.

- `logs/red-source-config.log`: nine tests, five behavioral failures and four
  semantic passes before production edits. Reproduces post-construction text
  checking, absent replacement work charges and immediate/queued cancellation.
- `logs/green-initial.log`: all nine initial controls pass.
- `logs/finalization-red.log`: four falsey queued-abort failures exposed missing
  post-await checks in the first private builder. Corrected before finalization.
- `logs/backing-red.log`: 64-byte capacity versus 8192-byte pooled backing RED.
  `logs/backing-support.log` records standalone Node/browser-adapter controls.
- `logs/frozen-focused-green.log`: 90 selected tests pass, comprising 20 new and
  70 existing controls; zero failures, cancellations or skips among selected tests.
- `logs/final-new-tests.log`: the final new test file passes all 20 controls.
- `logs/final-baseline-comparison.log`: 144 direct replacement comparisons and
  14 actual sed/awk comparisons match the untouched private baseline. Largest
  compared result is 61 bytes. Includes captures, missing groups, escaping,
  zero-width/occurrence behavior, raw bytes, awk field/array targets, sed print/
  branch/file/in-place behavior, rejected backreferences and discarded results.
- `logs/final-types-green.log`: zero diagnostics with unchanged actual package
  compiler options, four changed production roots plus the new test and their
  imports, no emit. Intermediate observer typing failures remain in their logs;
  real type guards fixed them without suppression or blanket casts.

The largest new data specimen is 1025 bytes for the segment boundary. Its
allocations are exactly 1024, 1 and 1025 bytes. Builder work boundary controls
accept 9 steps for a four-byte one-segment copy/conversion, and 3077 steps for
1025 bytes including two segment allocations and final copying/conversion;
one fewer step refuses before the final allocation/conversion. Other controls
use tiny strings and no large generated data, CPU/RSS sampling or fatal probes.

Focused runtime command, from the candidate's `packages/safe-bash` directory:

```sh
node --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --test --test-concurrency=1 \
  --test-name-pattern='^(?!sed branch and regex work|awk loops, recursive functions|read command preserves raw bytes)' \
  tests/commands/text-programs/substitution-admission.test.ts \
  tests/commands/text-programs/sed.cases.ts \
  tests/commands/text-programs/awk.cases.ts \
  tests/commands/text-programs/cancellation.cases.ts \
  tests/commands/text-programs/capture-regressions.cases.ts \
  tests/commands/text-programs/file-commands.cases.ts \
  tests/commands/text-programs/getline.cases.ts \
  tests/commands/text-programs/list-command.cases.ts \
  tests/commands/text-programs/lookahead-regressions.cases.ts \
  tests/commands/text-programs/oracle-validity.cases.ts \
  tests/commands/text-programs/quit-regressions.cases.ts
```

The selector omits three existing loop/resource-pressure cases; they remain
unchanged for root's normal gates and are not counted as passes. No native oracle
was executed despite historical names in the retained compatibility tests.

## Handoff and nonclaims

The private `candidate.patch` uses apply_patch format and exactly the six paths
listed above. Root must add the new test's literal registry entry separately.
`frozen-files.json`, `handoff.json` and `evidence.sha256` bind candidate/patch/log
bytes. Patch application is checked against a fresh private copy of original
owned files, never the live repository. Freeze pending root review/integration.

No live repository/Git/README/registry changes, broad gates, release, GitHub posts,
native or Cloudflare execution. No measured 30x amplification, host-heap bound,
fatal-OOM prevention, latency or runtime-preemption claim. Matcher search and
final native string conversion retain synchronous portions; cooperative
checkpoints do not preempt arbitrary host work.
