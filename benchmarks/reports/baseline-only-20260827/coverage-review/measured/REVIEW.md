# Independent measured breadth review — August 27, 2026

## Verdict and scope

Independent replay coverage of the unchanged frozen attempt002 corpus is complete:
136/136 attempts, 136 product calls,
135 normal child exits. Author commit: 849dbf18b1e865c7d12927c11f0e20ba0555c540.
This accepts reproducibility of the bounded observations, not broad parity,
superiority, full command coverage, native semantics or completion of the product.
The normal-exit requirement remains unmet for the baseline JS child; do not hide it.

**Publication failure and explicit recovery:** the first reviewer driver launched13
children but durably published only12 captures before apply_patch stalled. Root
authorized termination of that verified owned publisher, and its parent closed
normally. The13th clear-positive.ours result was lost, not reconstructed or called
a product failure. Original replay/ results and harness hashes remain immutable;
their actualAttempts12 field counts published captures, not the13 actual launches.
Root then authorized a bounded continuation with a30s publication timeout:
reuse12 verified captures unchanged, execute123 never-launched rows, and explicitly
repeat only the single lost-delivery case. Thus 124 new
launches and 137 total reviewer launches yield136
distinct complete results, plus one unverified lost-delivery launch. Its product
exec phase/result is unavailable, not an invented137th completed product call.
No other completed row or entire corpus was rerun. See replay/publication-failure.json
and continuation/before.json for the original fault and root authorization.

Historical53 remains three previously measured plus50 formerly unmeasured.
This run covers those exact50 current default targets plus four optional names.
Three historical-overlap recipes, four shared controls and seven direct
reachability diagnostics per engine remain separate. No corpus expansion by reviewer.

## Counts and agreement

| Cohort | Ours exact positive | Baseline exact positive |
| --- | ---: | ---: |
| 50 default target recipes | 0 | 45 |
| All54 target recipes | 0 | 47 |
| All61 primary recipes, including controls | 7 | 53 |

Positive counts require declared intent, complete census and normal child exit,
and exclude help, wait, node and all diagnostic sub-attempts. Both failing never
means parity. Independent predicate recomputation disagreements: 0.
No corrected/replay case is a constructor/configuration failure, missing final
capture, unavailable optional startup or default-disabled baseline feature. The
separate unavailable SafeJS setup is not disguised as a configured runtime loss.
Baseline's47 exact target positives coexist with two functional limitations,
one display-predicate mismatch, one guest-success/cleanup-timeout result, one
documentation-only result, one no-op-limited result and one diagnostic stub.
Author/reviewer exact status, stdout/stderr bytes and entire stable root namespace
agree on 136/136 attempts;
0 differ. Timings, host diagnostic PIDs, timestamps,
opaque IDs and inode allocation remain raw, not deterministic equality fields.
See continuation/results.json agreement rows and raw captures; no hidden retries.
timing-and-api-observations.json preserves both runs' timing fields without a
performance comparison and checks public text/API fields independently of bytes.

All54 compatible names are absent from frozen ours concrete default/optional
configured dispatch: 54 directly confirmed
by primary127 or one of the seven predeclared direct diagnostics. Primary
prerequisite/parser blocks are not mislabeled as reached targets. This is not a
claim that the separately named optional SafeJS capability cannot execute code.
No legitimate runtime exists in the allowed installed roots and none was faked.

## Important distinctions

- Baseline JS executes guest arithmetic and returns exact42-newline/status0,
  then exceeds ten-second host cleanup grace and receives SIGTERM. Arithmetic
  succeeds; lifecycle closure does not. Raw author timeout classification stays
  intact. No disposal API or worker patch was invented, and no SIGSTOP was used.
- Baseline Python and python3 perform arithmetic and exact VFS writes; sqlite3
  creates a database and computes a sum using installed local runtime assets.
  Node is a diagnostic stub, not working guest Node or a host fallback.
- Tree produces the expected hierarchy/counts with hardcoded ASCII connectors.
  Unicode-only expected bytes are an over-specific display predicate. Preserve
  strict mismatch, but do not call this absent functionality or an ours win.
- Compopt returns no requested query output; exec creates after-exec despite
  replacement intent. These are bounded unmet behaviors, not universal failures.
- The binary shared control exposes baseline bytes00 7f c2 80 c3 bf instead of
  00 7f 80 ff in both stdout and the VFS file. This is not solely a terminal
  string/byte presentation difference. Ours retains the requested four bytes.
- Newly created shared-control files also differ in mode:0666 ours versus0644
  baseline. Bounded content success therefore does not establish full cross-engine
  namespace/effect equality; these modes remain in raw and stable comparisons.
- Help documentation, wait/no-op behavior, history seeded storage, hash map
  retrieval, timeout normal-child dispatch and sleep sanity are narrowly scoped;
  none establish interactive/job-control/cache/expiry/timer completeness.

## All54 target outcomes

Status pairs are ours/baseline primary product status, not child-process exit.
Direct diagnostics retain independent raw records and never earn positive credit.

| Name | Ours | Baseline | Status |
| --- | --- | --- | --- |
| alias | missing-handler | functional-positive | 127/0 |
| builtin | missing-handler | functional-positive | 127/0 |
| clear | missing-handler | functional-positive | 127/0 |
| column | missing-handler | functional-positive | 127/0 |
| compgen | missing-handler | functional-positive | 127/0 |
| complete | missing-handler | functional-positive | 127/0 |
| compopt | missing; primary dependency-blocked | partial-functionality | 127/0 |
| date | missing-handler | functional-positive | 127/0 |
| declare | missing-handler | functional-positive | 127/0 |
| dirs | missing; primary dependency-blocked | functional-positive | 127/0 |
| du | missing-handler | functional-positive | 127/0 |
| egrep | missing-handler | functional-positive | 127/0 |
| exec | missing-handler | partial-functionality | 127/0 |
| expand | missing-handler | functional-positive | 127/0 |
| expr | missing-handler | functional-positive | 127/0 |
| fgrep | missing-handler | functional-positive | 127/0 |
| file | missing-handler | functional-positive | 127/0 |
| fold | missing-handler | functional-positive | 127/0 |
| getopts | missing-handler | functional-positive | 127/0 |
| hash | missing-handler | functional-positive | 127/0 |
| help | missing-handler | documentation-only | 127/0 |
| history | missing-handler | functional-positive | 127/0 |
| hostname | missing-handler | functional-positive | 127/0 |
| html-to-markdown | missing-handler | functional-positive | 127/0 |
| let | missing-handler | functional-positive | 127/0 |
| mapfile | missing; primary syntax-blocked-before-target | functional-positive | 2/0 |
| nl | missing-handler | functional-positive | 127/0 |
| popd | missing; primary dependency-blocked | functional-positive | 127/0 |
| printenv | missing-handler | functional-positive | 127/0 |
| pushd | missing-handler | functional-positive | 127/0 |
| readarray | missing; primary syntax-blocked-before-target | functional-positive | 2/0 |
| rev | missing-handler | functional-positive | 127/0 |
| seq | missing-handler | functional-positive | 127/0 |
| shopt | missing-handler | functional-positive | 127/0 |
| sleep | missing-handler | functional-positive | 127/0 |
| split | missing-handler | functional-positive | 127/0 |
| sqlite3 | missing-handler | functional-positive | 127/0 |
| strings | missing-handler | functional-positive | 127/0 |
| tac | missing-handler | functional-positive | 127/0 |
| time | missing-handler | functional-positive | 127/0 |
| timeout | missing-handler | functional-positive | 127/0 |
| tree | missing-handler | display-profile mismatch; hierarchy/counts present | 127/0 |
| typeset | missing-handler | functional-positive | 127/0 |
| unalias | missing; primary dependency-blocked | functional-positive | 127/0 |
| unexpand | missing-handler | functional-positive | 127/0 |
| wait | missing; primary primary syntax failure; direct diagnostic missing | no-op-not-operational-proof | 2/0 |
| which | missing-handler | functional-positive | 127/0 |
| whoami | missing-handler | functional-positive | 127/0 |
| xan | missing-handler | functional-positive | 127/0 |
| yq | missing-handler | functional-positive | 127/0 |
| js-exec | missing-handler | guest semantics positive; cleanup timeout | 127/0 |
| node | missing-handler | baseline-stub | 127/1 |
| python | missing-handler | functional-positive | 127/0 |
| python3 | missing-handler | functional-positive | 127/0 |

## Freeze and evidence boundary

Frozen source165files SHA256:
30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732.
Pinned installed just-bash3.4.2 and Node22.22.2 are identified with complete source,
dependency, loader, worker-asset, symlink/canonical-path and executable hashes.
Same author inputs/config/argv/environment and fixed loopback port are reused,
not regenerated from moving source. Before/after files and raw loaded-file
evidence are in continuation/. All observed loaded paths match freeze: true.
Snapshot package/tsconfig are hash-checked; TSX_TSCONFIG_PATH explicitly selects
the snapshot. Live product work elsewhere is excluded, not overwritten.

First author attempt remains separate132-launch harness-fault evidence.
Root-approved second attempt adds only two declared reachability diagnostics,
awaits IPC completion, removes unused /fixture/tmp, uses supported curl limits,
binds snapshot configuration and limits trace registration to the main child.
All61 primary scripts/expectations remain unchanged except the new fixture port.
The frozen namespace prose still mentions fixture/tmp; actual correctedSetup,
child code and census omit it. This documentation defect is not silently edited.

Only synthetic env/memory VFS/local installed assets and exact authorized
loopback GET are used. Network uses public SecureFetch transport injection for
baseline and explicit networkCommands for ours, not command replacement or
allow-all networking. 2 fixture requests recorded across the
prefix and continuation; both servers closed:true. Curl's two
prefix captures were reused, not repeated. No external writes, ambient user data, new dependency,
native product replacement, new unique cases beyond the declared corpus, or
product implementation. Main-module/CJS trace is not a complete worker/syscall
trace; worker loaders/data are statically resolved and byte-hashed. Hashing is
not proof against transient concurrent tampering or installed tarball attestation.

Every raw capture retains product channels/status, host channels, full VFS
namespace/type/bytes/symlinks/modes/available metadata, and census failures.
Baseline stderr is UTF-8 derived from its public string API, not fabricated raw
bytes. Unavailable metadata stays absent. No wall-clock performance claim.

## Next engineering batches

These priorities are engineering judgment about agent workflows, not telemetry.
No implementation is included, and root assigns actual code ownership separately.

1. **Lowest coupling: stream transforms and grep aliases.** rev, tac, nl, fold,
   expand/unexpand, strings, split, egrep/fgrep. Reuse byte-stream/VFS contracts,
   cancellation and bounded output; validate actual useful pipelines, not names.
   Smallest first author assignment: egrep/fgrep only, after inspecting existing
   grep mode/option behavior; root/integration retains aggregate registration.
2. **Inspection and small execution helpers.** file, du, tree, printenv, which,
   date, expr, seq, sleep, time/timeout; keep virtual identity synthetic and
   distinguish logical/allocated size, display profiles and actual deadline expiry.
3. **Structured ingestion and reports.** yq, xan, html-to-markdown and optional
   sqlite; prioritize local format/VFS workflows, explicit dependencies and
   runtime availability, avoiding a dependency-heavy default bundle.
4. **Shell state and invocation.** aliases, declaration/array readers, directory
   stack, completions, getopts/hash/history, exec/wait. Higher parser/state coupling;
   require distinguishing before/after effects, job lifecycle and parent isolation.
5. **Legitimate optional guest runtimes.** Explicit SafeJS integration first where
   authorized host hooks exist, with documented name compatibility; guest JS/Python
   only with legitimate available runtimes and worker disposal evidence. No stub
   renaming, private checkout access, native fallback or automatic enablement.

## Historical and normative limits

Original18fails, table21gaps, SGID6 and originaldiff8 remain independent historical
profiles, not closed by this cohort. Normative1f2aa30 applies: Node status0/mode0707
versus GNU9.7/Darwin status1/unchanged are six strict selected-profile observations,
not demonstrated POSIX bugs. They alone justify neither a permission API nor SGID
production changes. Environment ordering is POSIX-unspecified; the native GNU
capture is Darwin/libSystem, not Linux. No permission/native rerun occurred here.

The user's full goal, broad head-to-head superiority and72-hour work requirement
remain unproven. No marketing, telemetry, speed claim, universal parity or claim
that these54 small recipes constitute complete Bash/tool/backend coverage.
