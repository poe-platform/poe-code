# Static regex execution inventory

## Scope and evidence

Static source/documentation review only, August 26, 2026 (America/Chicago;
August 27 UTC). **Dynamic probes executed: 0. Dynamic probes verified: 0.**
The preceding dynamic task stopped at a tool safety check immediately after
repository instructions were read: no harness, regex test, or dynamic finding
resulted. This review did not repeat it. No product imports/execution, native
utility probes, regex benchmarks, adversarial patterns, or test runs occurred.
Shell utilities were used only to inspect text/Git metadata and write/commit
these reports. No production, existing tests, dependencies, historical results,
or structured-command artifacts were changed by this reviewer.

Source statements below are **static observations/inferences**, not measured
latency, safety, compatibility, or parity findings. External documentation facts
are identified by research IDs in `RESEARCH.md`. `SOURCE_MAP.json` records exact
paths, line anchors, SHA-256 values, snapshots, and unverified items.

Initial HEAD: `e64ce50e1e45c6cf5e3e3686ce7424cbf0fa50df`.
Final source-snapshot HEAD: `280815c7b7106abf9bdca8b9294c811eb80b1846`.
Hash window: `2026-08-27T03:11:51.127Z` to `2026-08-27T03:14:47.812Z`;
the shared core helper was added to the hash inventory at `03:13:04.962Z`.
These are non-atomic working-tree observations, not a clean-HEAD validation.
Both snapshots were dirty; full observed status listings are in the JSON.
Of 48 hashed source/documentation files, shell `parser.ts` and `runtime.ts`
changed. Other workers also committed unrelated work. No repeated drift chase.

## Per-tool findings

| Tool | User-controlled matching path | Current checks and limits | Profile and unverified boundary |
| --- | --- | --- | --- |
| jq | `parser.ts:27,169` permits `split/1`, explicitly rejects `split/2`; `interpreter.ts:249` calls `split.ts:3`. Nonempty separators use a prefix-table literal scan; empty separators iterate Unicode code points. No supplied regex reaches native RegExp in this path. Fixed parser/number-validation regexes process text as data, not as regex syntax. | `limits.ts:20,53` supplies logical input/value/output/source/depth/step/result/collection limits; `tick` yields after roughly 1,024 charged steps. `split.ts` charges preprocessing/scanning and aggregate result size. Command output/result checks: `jq.ts:171`; input accounting: `input.ts:219`. | Literal split only; regex-library gap remains. `values.ts:127` also implements string division with native **literal string** splitting, a separate synchronous path. No wall-clock or full jq guarantee. |
| core grep | `grep.ts:4` translates BRE/common classes; `:48` selects BRE/ERE or escapes `-F`; `:51` constructs native RegExp (`g`/`gi`), `:59` calls `exec`. Fixed strings still use escaped RegExp, not an independent literal engine. | Regex translation caps source at 65,536 units (byte-view strings), rejects special groups. This check is not on the `-F` branch. `:82` checks abort between records; `internal.ts:151,165` caps pattern-file collection/lines at 32 MiB. Shared writes observe signal; Shell may cap aggregate output. | Local docs explicitly disclaim full POSIX leftmost-longest and hard regex budgets. No matcher-loop step budget, inner yield, or direct-command output quota is visible. Native compile/match latency and complete option/dialect behavior are unverified. |
| rg | `search/rg.ts:17,132` collects patterns; `matcher.ts:38,53,70,88` constructs native Unicode RegExp and executes it. `-F` escapes into that engine. User globs/ignore rules also become RegExp in `glob.ts:51,57,61`. | 1,024 patterns, 8,192 UTF-8 bytes per pattern, 100,000 matches per line; pattern files 1 MiB. Defaults: line 1 MiB, file 64 MiB, output 16 MiB, 100,000 files. `shared.ts:31` yields every 128 ticks; `rg.ts:54` ticks before record matching. No signal/step parameter inside `Matcher.matches` or `Glob.matches`. | Local profile is JavaScript Unicode regex, not Rust regex/PCRE2. Rejects selected backreference/lookaround forms; unsupported syntax list is not a proof of a bounded engine. Documentation explicitly makes no catastrophic-regex safety guarantee. Empty-pattern byte enumeration is a special path, not general literal matching. |
| sed | `sed.ts:64,141` constructs custom `Pattern` for addresses/substitution; `:249,314` uses `find`/`substitute`. Patterns do not become native general-purpose RegExp. | Shared instruction machine: source 8,192 bytes, nesting 64, interval bound 1,000, compiled instructions 16,384; matching instructions and backreference byte comparisons charge `Budget.step`; state queues/visited state have buffer checks (`regex.ts:197,217,231,234,240,249`). Default invocation budget 5,000,000 steps, per-buffer 32 MiB; statement checkpoints yield every 256 calls. | C-byte BRE/ERE subset, earliest-start/longest-whole matching and capture tracking. Fixed native regexes remain for lexical/class tests, not user pattern execution. Compile and individual `find` calls are synchronous. Step accounting is not a proven linear-time, total-memory, or deadline guarantee. |
| awk | Literal regex tokens (`awk-syntax.ts:99`) and dynamic strings (`awk-runtime.ts:104,113`) use the same `Pattern`; operators, `match`, `sub`/`gsub`, multi-byte FS and regex `split` use it. `:114` uses fixed whitespace regex, byte-field iteration, or literal string split for special separators. | Same shared step/buffer limits as sed; statements yield at `awk-runtime.ts:346`. Regex cache is 256 entries; split fields capped at 100,000. Input/program/output helpers carry signals; program source capped at 1 MiB. | Byte-oriented ERE subset, not Unicode/Oniguruma. Single-byte/paragraph RS is separate; regex RS is documented unsupported. No command-wide output-byte quota in the text-program options; shell output limits are a separate layer. |
| shell | `case` and pathname globs use `pattern.ts:69,79`: custom wildcard token/retry matcher. Only bracket tokens use generated one-character RegExp (`:59,95`); fixed parser regexes are not user regex execution. **Parameter patterns changed during review**, detailed below. | Tokenization and matching debit `PatternWork.remaining`, yield every 1,024 loop steps, and check signal. `runtime.ts:47` budgets commands, loops, source and output; `types.ts:17` declares expansion/pipe limits, not regex milliseconds. `interruptible` races promises against abort; it does not add checkpoints inside synchronous calls. | Glob syntax is not ERE. Parser rejects `[[` at its unsupported-keyword guard (initial `parser.ts:618`); no supported shell `=~` path was found. Native Bash documents that feature [R9]; this is a compatibility gap, not an executed failure. |

Paths in the table are under the relevant command directory except explicit
`internal.ts` (`src/commands`) and shell files (`src/shell`). Precise paths are
expanded in the JSON. Limits describe visible accounting, not all allocation
costs or a measured bound on one operation.

### Concurrent shell change

Initial runtime SHA-256 `c26cb2035f76ced93319bbe50fc59c37de15eaad7285d49aa027c21a3f433101`
matches the initial HEAD blob. Its parameter prefix/suffix removal invoked
`globExpression` at lines 1538/1544, with native `RegExp.test`; the compiler was
at lines 1682–1700. The inspected moving implementation instead has
`parameterPattern` at line 1551, calling existing `compilePattern` at 1558,
charging attempted slice lengths, yielding every 256 attempts, and checking
signal; it also handles parameter replacement. Final runtime hash is
`e8c61eb96c76999b0ac61a956312fce7d2e6077f1b2c55fcd9c15d4d50b40123`.
This is concurrent unaccepted source, **not remediation authored or verified by
this review**. Parser drift likewise prevents treating initial line numbers as
stable final anchors. Both hashes and line counts are retained rather than
overwriting the initial observation.

## Contract versus hard execution guarantee

`src/contracts/command.ts:20` requires `signal`, byte streams, and VFS; it does
not declare a hard regex timeout or universal CPU budget. The command contract
markdown concerns literal invocation/environment replacement, not synchronous
preemption. `src/contracts/io.ts:132,173,200` observes abort around async I/O,
including late settlement; these helpers cannot undo host effects. The root
rules explicitly make that distinction. Shell command-count/output limits do
not instrument arbitrary code inside a registry command.

The local grep and rg docs disclaim hard regex execution guarantees. Text-program
docs describe synchronous step-bounded matching, not a timed interrupt. Jq docs
describe logical limits and non-preemptible synchronous builtins, then advise a
deadline signal: that advice is not a documented hard preemption mechanism.
Node scheduling/AbortSignal docs [R1–R3] explain why a pending signal or promise
race alone is not evidence of synchronous interruption. **No observed individual
regex operation violated a deadline in this task; no such operation ran.**

## Existing reuse and conditional choices

1. If a byte-oriented BRE/ERE subset is approved, reuse the existing sed/awk
   `Pattern` instruction machine rather than proposing a rewrite. It already
   has captures, backreferences, earliest/longest selection and explicit work
   accounting. It is coupled to the text-program `Budget`/error types and byte
   representation. Any reuse needs semantic and accounting review, not a claim
   that it is a generic linear engine or a drop-in grep/rg replacement.
2. If the intent is literal matching, preserve/reuse the jq split prefix-table
   approach; if the intent is shell glob matching, reuse `shell/pattern.ts`.
   Neither implements a general regex language. Case folding, byte offsets,
   multiple patterns, word boundaries and empty-match rules remain consumer-specific.
3. If native JavaScript matching must remain and off-thread execution is approved,
   a small pure-matching `node:worker_threads` boundary is a zero-runtime-package
   option. Keep VFS/effects with the host and bound transferred data. Node documents
   asynchronous termination as soon as possible, not an exact real-time deadline;
   resource limits are not whole-process memory limits [R4]. No worker or process
   was created here. Stronger host isolation would require a separate approval
   and resource/effect contract, not silently introducing product subprocesses.
4. V8's historical experimental non-backtracking flags [R5] are host/version
   dependent, with documented syntax/flag restrictions; do not assume they are
   enabled or usable with current rg's Unicode mode. No runtime flag availability
   was checked. These are conditional design choices, not proven remediation.

### Jq split/2 boundary

Official jq 1.8 distinguishes literal `split(str)` from regex `split(regex; flags)`
and uses Oniguruma Perl NG [R6]. Current local parser explicitly rejects the
second signature. Existing literal split remains useful for split/1 and its
budget/result handling, but is not a regex implementation. Sed/awk `Pattern`
could only supply a separately agreed subset: byte offsets versus Unicode
code points, leftmost-longest versus flag-dependent selection, jq flags/null
flags, inline modes, Unicode/classes, captures/lookaround, zero-width splitting,
argument-generator ordering and error/quota propagation all require explicit
semantic decisions and later evidence. Do not map jq flags onto JavaScript
flags mechanically, silently narrow jq's contract, or label a reused subset
full split/2 parity. No API, feature, engine, or new payload is supplied here.

## Blocked/unverified dynamic questions

Native compilation/matching latency, event-loop delay, cancellation delivery,
work-budget exhaustion behavior, peak memory/output accounting, cleanup/effect
preservation, and per-dialect/Unicode/empty-match results remain unmeasured.
The changed shell paths also lack acceptance from this review. No benchmark,
deadline failure, successful probe, full-runtime safety, full parity, or
superiority conclusion follows. **Executed 0; verified 0; empirical findings none.**
