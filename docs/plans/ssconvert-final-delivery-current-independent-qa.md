# Current independent ssconvert delivery QA

Executed by a different delegated agent on 2026-09-21 against the live compiled
public exports. Root retains runtime, integration, export and Git ownership.
No native utility, LLM, host fixture, runtime edit, README edit, commit or push
was used. These deterministic checks are bounded semantic evidence, not a
performance measurement or full Gnumeric parity certification.

## Procedure and reproducible original fixture

Run `node --import tsx packages/ssconvert/tests/public-consumer.mts`. Run Node
ESM stdin probes importing `createEngine` and `createResourceIO` from
`poe-code/ssconvert`, `Shell` and `MemoryFileSystem` from
`@poe-platform/safe-bash`, and `ssconvertCommands` from
`@poe-platform/safe-bash/commands/ssconvert`.

Inject no additional codecs, empty environment, locale C and timezone UTC.
Use limits inputBytes 10000, outputBytes 100000, cells 1000, sheets 10 and
operations 100000. Seed the in-memory VFS `/in.csv` with these original bytes
and `/keep` with `keep`:

```text
"a,b","quoted ""value""",雪
-0,1.25,
```

1. Run `ssconvert -T Gnumeric_stf:stf_csv /in.csv fd://1`; compare stdoutBytes
   with direct SDK stream input/output conversion using the same export ID.
   Retain output chunks with owned Uint8Array copies. Assert both exit 0,
   command stderr empty and SDK diagnostics empty.
2. Run `ssconvert -T Gnumeric_XmlIO:sax:0 /in.csv /checkpoint.xml`, then replay
   using `ssconvert -T Gnumeric_stf:stf_csv /checkpoint.xml fd://1`. Assert
   both exit 0 and replay bytes equal the original command bytes.
3. Run `ssconvert --not-a-real-option /in.csv /keep`; assert exit 1, empty
   stdout and exact unknown-option diagnostic plus help suggestion.
4. Run `ssconvert /missing.csv /keep`; observe exporter preflight exit 2,
   empty stdout and the exporter-guess diagnostic. This deliberately verifies
   preflight ordering; it does not reach the missing input read. Run again
   with `-T Gnumeric_stf:stf_csv` to reach missing input: exit 1, empty stdout,
   stderr `E /missing.csv: No such file or directory\n`.
   Assert `/keep` and `/in.csv` retain their original bytes.
5. Abort an SDK conversion before invocation using an original Error object.
   Assert rejection contains that identical object and the sink is never called.
6. Set inputBytes to 2 and convert original bytes `1,2\n`. Assert SDK rejection
   has code `resource-limit`, exitCode 1 and message
   `ssconvert input bytes limit exceeded`; assert no sink write occurs.
7. Create resource I/O with only injected VFS methods; read
   `https://untrusted.invalid/data`. Assert `capability-denied` rejection and
   zero VFS calls. Create a separately injected transport whose first response
   redirects allowed.invalid to blocked.invalid; reject the blocked destination
   in authorize. Assert exact event order: authorize allowed, request allowed,
   authorize blocked; no blocked request or VFS call. No real network occurs.
8. Abort while an original async source advances from its first `1,2\n`
   fragment to a second `3,4\n` fragment. Assert identical cancellation reason,
   zero writes and source iterator finally completion. Separately reuse a single
   mutable four-byte fragment for `1,2\n`, then `3,4\n`, then zero it when the
   producer finishes. Assert actual CSV output retains `1,2\n3,4\n`, exit 0.

## Results and candidate binding

The maintained public consumer exited 0 without output. Final assertion probes
passed eleven bounded checks with zero validated product failures. Command/SDK
and checkpoint/replay output was exactly:

```text
"a,b","quoted ""value""",雪
0,1.25,
```

The conversion normalizes negative zero in this CSV fixture; no native numerical
parity claim is inferred. The preflight stderr was exactly:

```text
Unable to guess exporter to use for 'file:///keep'.
Try --list-exporters to see a list of possibilities.
```

Entry-point SHA-256 at execution:

- `packages/ssconvert/dist/index.js`:
  `d0c56a1047c278ad9a2115be72a273eaefacbf42561ed933fd27799b514a17e6`
- `packages/safe-bash/dist/commands/ssconvert/index.js`:
  `b831e7617095fea7d0a50c205328c4859a0afcd7eb05c693a174fa8a74fe25f8`

These authenticate entry points, not the entire dependency closure. Root's fresh
full build is pending at this writing, so a later rebuild requires rechecking
the public consumer and these bindings before attaching this result to it.

Initial probe attempts were incomplete: one inline JavaScript parenthesis error
prevented execution; another incorrectly expected missing-input exit 1 without
an explicit exporter and stopped after observing exit 2; another incorrectly
expected a returned SDK budget result and stopped on the actual structured
rejection. Corrected, separate probes reproduced and asserted the observed
contract above. These runner assumptions are not validated product defects.
They are retained rather than counted as product passes or concealed failures.

## Coverage and delivery review

The existing final JSON explicitly sets semanticParityEstablished false and
retains whole-obligation unmeasured counts separately from implementation and
unit-case inventories. Its zero failed/unsupported whole-obligation fields are
qualified by countingRules and do not erase historical mismatches or unsupported
subcases. Historical root test failures, incomplete first lint run and focused
rechecks remain separate, with no focused rerun claimed as a completed broad
gate. These are appropriately bounded claims; the current root gate outcomes
still require root's fresh run and must not be inherited from this probe.

Unverified here: all upstream format/version/record variants, graphics/printing,
numerical domains, activated optional native/plugin/locale profiles, actual
remote services, deferred opaque-host cancellation/cleanup races, complete dependency/realm
isolation, screenshots and full repository gates. Injected transport checks
establish authority ordering only. No native fallback or mock can clear those
obligations. The README approval blocker, no-push/no-release authorization and
separate local/remote/publication reporting remain required.

## Postbuild recheck

After root reported `TURBO_FORCE=true npm run build -- --no-cache` finished
with exit 0, reran the maintained public consumer: exit 0, no output. Reran
all eleven independent bounded assertions above in one Node ESM invocation:
exit 0, eleven passes, zero failed assertions. Both compiled entry-point hashes
were unchanged and equal the recorded bindings. No native utility or disk
fixture was used. This supersedes the pending-build qualification for these
consumer/probe results; it does not clear root test/lint gates or any unverified
matrix cell.

## Minimized advanced-distribution work investigation

After the fresh maintained suite timed out in the existing
`R.QTUKEY(-1000,3,10,1,TRUE,TRUE)` case at its unchanged 5000 ms limit, root
assigned independent investigation without runtime-edit authority. Direct
compiled `advancedDistributionValue('tukey','q',-1000,[3,10,1],true,true,host)`
with an original counting tick host and limits.cells 10000 produced
`7.186959238596907e-108`, 557149 ticks and 88 distinct CDF abscissas. There were
no duplicate abscissas to memoize. Two bounded isolated measurements were about
1.9 and 2.3 seconds; these timings are environment-dependent measurements,
not a deterministic timeout guarantee. Negative controls at log probabilities
-10 and -100 took 906603 and 825500 ticks respectively (approximately 8.3 and
5.8 seconds in this execution). No native oracle was used.

At q=1e-10, cold/warm quadrature calls returned identical
`-47.34027274490966`. The warmed cache retained 13 intervals but reduced ticks
only from 21440 to 21232 (approximately 201 to 194 ms). Thus caching static
quadrature nodes does not remove the repeated range-probability integration.
At q=1e-50, cold/warm results were identical `-348.07422818786284`, with 640/432
ticks. Retain these minimized deterministic work observations separately from
the elapsed measurements and the actual maintained-suite timeout.

Inspection found a candidate lossless local optimization: each range quadrature
node calls normalInterval(v-w,v), whose small-interval branch evaluates the
right endpoint normalDensityExponential(v). The integrand immediately evaluates
that exact same density(v) again. Reusing a precomputed right-endpoint density
can avoid duplicate expensive capturedExp arithmetic without changing CDF
abscissas, rounded numerical expressions, inverter ordering or host tick
guards. Recursive reflection, zero/infinite endpoints and the large-difference
normalInterval branch require explicit regression coverage. This is a proposal,
not an implemented or verified fix. Root must first establish a failing
regression and rerun appropriate fresh gates after any repair; focused success
does not clear the recorded broad-suite failure.

## Independently validated forged-PWD diagnostic mismatch

Created only an in-memory VFS with distinct directories `/work` and `/fake`,
`/work/in.csv` bytes `1,2\n`, and `Shell({fs,cwd:'/work',env:{}})` with the
same explicit C/UTC ssconvert configuration. Independent compiled reproduction:

- Baseline `ssconvert -T Gnumeric_stf:stf_csv in.csv out.csv`: exit 0, empty
  stderr and exact `/work/out.csv` bytes `1,2\n`.
- `PWD=/fake ssconvert in.csv out.invalid`: exit 2 and exact stderr
  `Unable to guess exporter to use for 'file:///fake/out.invalid'.\n`
  followed by `Try --list-exporters to see a list of possibilities.\n`.
- Negative control `PWD=/fake ssconvert -T Gnumeric_stf:stf_csv in.csv fake.csv`:
  exit 0, empty stderr, exact `/work/fake.csv` bytes `1,2\n` and no
  `/fake/fake.csv` file. Thus diagnostic URI resolution and actual injected I/O
  resolution disagree. This is a validated product mismatch, additional to the
  earlier eleven bounded passing cases, and remains open at this writing.

Primary Gnumeric source `src/ssconvert.c:1295-1296` creates both input/output
URIs through go_shell_arg_to_uri. Captured GOffice source
`goffice/utils/go-file.c:521-540` calls g_file_new_for_commandline_arg for
ordinary paths. Independently acquired the official GLib 2.84.4 tag source from
`https://gitlab.gnome.org/GNOME/glib/-/raw/2.84.4/` only into
`out/ssconvert-independent-cwd-source`. The profile records GLib 2.84.4; this
inspection does not authenticate downstream distribution patches or execute a
native oracle.

`gio/gfile.c:7640-7697` resolves relative arguments through g_get_current_dir.
`glib/gfileutils.c:2967-2971` uses PWD only if stat('.') and stat(PWD) have
matching dev and ino; otherwise it falls back to getcwd. Therefore the distinct
forged `/fake` directory must not affect the diagnostic URI in this POSIX
source profile. A symlink-equivalent logical PWD is an explicitly separate
unverified runtime cell, as are Windows current-directory semantics.

Acquired source SHA-256:

- `gio/gfile.c`: `24f605cce114cfaea7fbaea7fdf5ea26af0add1ab4eda82b955df458a05df548`
- `glib/gfileutils.c`: `dc714490f4bfcf231722f365954be42629aebd37a6aac239d9277400e5d71b3e`

No runtime, integration, README or Git edit was made. Root owns any failing
regression, repair and fresh gate rechecks; these observations do not clear a
broad gate or authorize delivery.

## Fresh broad SafeJS checkpoint timeout investigation

Read the still-running maintained root log
`out/ssconvert-final-delivery-current/root-test.log` without starting a competing
test process. It reports `packages/safe-js/src/interp/in-operator.test.ts`:
29 cases, one failed, file duration 14598 ms. The case
`keeps lint and completed checkpoint replay consistent` took 13913 ms and
failed its unchanged 5000 ms timeout. Nearby individual membership cases took
18–47 ms; the following traversal-budget case took 66 ms. This is an actual
broad-gate failure, not an unavailable optional-profile skip or ssconvert pass.

The minimized source already in the failed test is:

```js
const object = { value: undefined }; return ["value" in object, "missing" in object];
```

The failing case contains exactly these stages: lint(source), await run(source),
await dump(the completed result), JSON.parse(the dump), and await
run(source,{snapshot}). It has no injected host callback, import, snapshot
backend, explicit timer, native utility or fixture I/O. Static inspection of
dump confirms a completed result containing snapshot goes through immediate
serialization and Promise.resolve, rather than waiting for a future checkpoint.
Lint uses 23 statically imported rules and reparses the small source; no external
service or subprocess is involved. The interpreter host-turn checkpoint normally
yields only after 4096 nodes, and this fixture contains no user loop or await.

The existing log does not identify which stage consumed the time or distinguish
compiler/rule traversal, restore/serialization, garbage collection and host
scheduling. No deterministic runtime defect or safe repair has been established.
Do not relabel the timeout as pre-existing, increase its limit or count the
surrounding passing cases as clearance. After the broad process settles, the
next bounded investigation is to measure these exact five stages separately
with the original in-memory source, assert lint [], both results [true,false],
and replay snapshot consistency, then run the maintained focused 29-case file
with its unchanged timeout. Such focused evidence still cannot clear the failed
broad gate. No competing test process or runtime change was made during this
investigation.

## Postbuild focused SafeJS and stage recheck

After root reported its final forced uncached build completed exit 0, ran
`npx vitest run packages/safe-js/src/interp/in-operator.test.ts`: exit 0,
one file and all 29 cases passed, zero skips. Reported tests duration was
847 ms and full process duration 3.31 seconds. The unchanged 5000 ms case
timeout was retained. This focused pass does not clear the failed full npm test,
whose later SafePython/ssconvert stages and automatic posttest were not reached.

Next ran a separate Node ESM probe importing lint/run through the compiled public
`@poe-code/safe-js/core` export and dump from the compiled dump module (dump has
no inspected package subpath export). Used exactly the original minimized
source above, no injected bindings/extensions, no filesystem fixture and no
native oracle. Asserted lint [], successful first/replay results [true,false]
and identical first/replay sourceHash. Exit 0. Measured stages, in milliseconds:
lint 12.63; first run 59.94; completed dump 20.97; JSON parse 2.00; replay run
89.03; sum 184.57. The completed serialized snapshot was 991108 UTF-8 bytes;
the fixture's small source does not imply a small serialized runtime graph.

These are bounded elapsed observations, not worst-case timing guarantees.
Neither execution reproduced the broad-run timeout, so no deterministic
stage-specific cause or runtime repair was validated. Garbage collection,
scheduling and larger serialized runtime work remain candidate explanations,
not findings. Retain the broad timeout unchanged and unresolved.

Compiled entry-point SHA-256 for this follow-up:

- `packages/safe-js/dist/core.js`:
  `4cc55346638c8794d1ccff4f2f670143a8dda7d42ecffc0bffa3cbc663c62583`
- `packages/safe-js/dist/run.js`:
  `33eb5f1bc3339090283b0a276f768fe8ea9ce41d1d6b5cf7556d5001113f4399`
- `packages/safe-js/dist/snapshot/dump.js`:
  `1da836811e7d8d2e47135806f4243052cff35765f240bcc155d899e22d5f980c`

No test/time-limit/runtime edit, commit, push or release was made.
