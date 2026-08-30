# Independent date / sleep / printenv review

August27,2026. **Date/sleep advertised-subset acceptance is blocked by eight
unchanged holdout failures.** Printenv passes the scoped selected GNU/virtual-own-key
checks; Apple multi-operand behavior differs and is not called parity. Production,
author tests, root exports/manifest, private checkouts and default integration are
untouched. No runtime dependency or installation is added.

## Exact freeze and counts

The tested source is `d904ca986fa945df8aef6e11b4165e2c2a63f814`, including the
earlier `df780f6` family. The source/config/test archive SHA256 is
`bb0cb4d96ef8bea502b4a298299a7f039da5e5e190970d12d4208d84de25a47f`, identical
to author evidence `1966945`. Every216 input hash matches the author's snapshot;
318 existing development dependency files are copied as regular files and checked
unchanged. Later dirty runtime cleanup/root integration work is excluded.

Final replay: **2026-08-27T08:00:54.837Z–08:01:05.722Z**, Node22.22.2,
TypeScript5.9.3, Darwin arm64, ICU78.2/tzdb2025c. Full native executable hashes,
GNU9.7 version output, primary archive/source hashes, command statuses, exact
hex output and source/build identities are in `evidence/final/`.

| Cohort | Pass/total | Remaining failures |
| --- | ---: | --- |
| Unchanged author suite, each of three replays |223/223|none; zero skips/TODOs|
| First reviewer capture |278/288|8 product,1 setup-count,1 Apple profile|
| Second reviewer capture |295/305|8 product,1 stale-count,1 Apple profile|
| Final reviewer capture |296/305|8 product,1 Apple profile|
| GNU9.7 Darwin date holdouts, final |233/239|6 advertised formatting cases|
| Exact sleep arithmetic, final |4/6|2 upward-rounding cases|
| GNU9.7 Darwin printenv named/byte cases |5/5|none|
| GNU9.7 Darwin bounded sleep cases |5/5|none|
| Apple epoch-date and finite-sleep profile |4/4|none|
| Apple multiple-name printenv profile |0/1|retained profile disagreement|
| Actual Shell sleep cancellation/isolation |8/8|none in this scope|

Counts are test assertions, not positive command-support counts. In particular,
five gap/fold rejection checks and one explicit unsupported-hex check are included
in the296 passing assertions; these do not establish native parity or supported
features. Invalid-calendar and quota/error controls likewise test rejection.
The223 author total includes150 top-level tests,72 native subtests and their parent
wrapper; it is not223 new independent vectors. Repeats are separate, not pooled.

## Concrete source follow-up

`EARLY_FINDINGS.md` contains minimal reproductions and byte-preserving expected/
actual examples reported before any source edits. Six GNU formatting mismatches
use `-d@1704164645.123456789` in UTC: `%12F`, `%#c`, `%-z`, `%_z`, `%_12z`, `%^P`.
They exercise advertised width/padding/case behavior, not an excluded grammar or
ICU-label case. Expected output is the independently executed pinned GNU oracle;
it is never rewritten to match this product.

Two exact1ms sums request2ms from the injected scheduler:
`0.0009999999 0.0000000001` and `0.0004999999 0.0005000001` seconds. The source
rounds each operand upward to nanoseconds before summing, then rounds to timer
milliseconds. The expected1ms comes from exact decimal arithmetic, not noisy
native wall-clock timing. This is conservative **over-waiting**, not early return
or a safety-undercharge claim. Follow-up source ownership must be assigned by root;
this read-only verifier has not repaired or waived either family.

## Covered behavior and limits

Date controls include leap/nonleap centuries, years0000/0001/0099/9999, negative
fractional epochs, ISO weeks/ordinal dates, C-format flags and bounded widths,
nanosecond truncation, numeric POSIX offsets including seconds, IANA transitions,
New York/Lord Howe gaps and folds, Apia's skipped day, UTC precedence, RFC/ISO output
options, invalid clocks, one-clock sampling, absolute-input clock bypass and
negative-mtime VFS symlink references. Native comparisons use numeric offsets
separately from ICU labels; full GNU grammar, ambiguity selection and libc/ICU
zone labels remain explicit limitations, not inferred parity.

Printenv uses only own virtual environment properties, including __proto__,
constructor, toString and nonenumerable entries; inherited values are absent.
Missing/empty/repeated names, Unicode/newlines and NUL output preserve status and
bytes. Enumeration is compared as records without a portable ordering claim.
Apple printenv emits only the first named value for the measured multi-name input;
that result is retained beside GNU behavior, not treated as a GNU product defect.

Sleep controls include fractional units/sums, extremely small finite exponents,
huge chunked delays without waiting for them, early wakeups, pre/during abort,
primitive and errno-shaped reason identity, native short sleeps and independent
concurrent Shells. Six public in-flight-abort repetitions observe zero pending
timers and zero command-signal abort listeners at exec/dispose settlement; a
separate preabort creates no timer. Cancelling one Shell leaves its sibling's
timer alive until that invocation completes. Sleep clears its timer synchronously
in the abort handler: these probes do **not** reproduce or close the regex-worker
premature-settlement defect. New registerCleanup runtime work is not consumed.

Compiled real Shell pipelines exercise replaced env/parent preservation, binary
NUL VFS output, date output files and reference symlinks. Family byte quotas,
shared Shell output limits, owned <=16384-byte output chunks and awaited
backpressure are checked. Clock reads when date is invoked are expected and
allowed; no host clock, process environment, TZ or global scheduler is modified.
The child intentionally has host TZ=Pacific/Honolulu while default virtual date
still formats UTC. Native utility subprocesses are test oracles only.

## Public integration requirements

Leaf factories are `createTimeEnvCommands(options?: TimeEnvCommandsOptions)` and
`timeEnvCommands(options?: TimeEnvCommandsOptions)`. Options are **optional**:
clock defaults to Date.now, defaultTimeZone to UTC, scheduler to monotonic
performance.now plus cancellable Node timers. Only own virtual TZ overrides the
configured zone; -u wins. Types also expose SleepScheduler and TimeEnvLimits.

Exact frozen default inventory is **65**, excluding all three new names. The
author's built-consumer stdout also says65; its handoff prose saying60 is stale.
The verifier first waited too little for setup, then trusted that stale count;
both failures remain archived. The final check compares an explicit literal65-name
set verified against frozen composition, not an expected set generated from it.
No claim about the moving live registry follows from this freeze.

Existing compiled root and leaf APIs are used, guarded against Workspace-source
fallback; all product imports resolve in the isolated dist tree. Strict consumer
types and whole frozen-source declaration/ESM build pass. The three unchanged
negative consumer cases produce exactly two TS2322 and one TS2741 diagnostics.
The first capture's two reviewer sink-typing errors are preserved separately;
correcting async sink signatures changes no product expectation.

This is **compiled-leaf acceptance evidence, not a packed public leaf-export proof**.
Root value/type exports, a package subpath and aggregate options/default wiring
remain integration-owner work after source acceptance. No speculative export is
added here. No complete repository suite/current-clean-tree inference is made.

## Reproduction and resources

```sh
node tests/commands/time-env-stress/run.mjs /tmp/new-time-env-review
node tests/commands/time-env-stress/seal.mjs --check
```

The runner's completion is capture completion, not a behavioral all-pass: final
independent consumer exits1 and the negative TypeScript child intentionally exits2.
Use the captured command statuses and `holdouts.json`, not just the outer exit.
Primary GNU9.7 documentation/source were reviewed from the official release and
tagged coreutils repository; source/archive hashes are retained. GNU9.7 here is
the actual Darwin build, not a universal GNU/Linux claim. Apple binaries have
their own hashes and read-only argument mapping (`date -r` is epoch there, versus
the product/GNU VFS-reference option). Infinite native sleep and clock-setting
operands are never executed. No fresh package install is needed.

All supervised children exit with no survivors; every owned snapshot, copied
tooling/native executable, tmp HOME and build tree is removed in finally blocks.
Outside output directories contain evidence only. Native oracles use isolated
environment/cwd and no private checkout. JSON is compacted losslessly with original
and archived hashes; raw TAP text is retained, including any original whitespace.
No blanket skipping, expected-output rebaseline, source fix or whole-product
support/superiority claim accompanies this evidence commit.
