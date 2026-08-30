# Actual SafeJS lifecycle execution — bounded non-pass

**August 27, 2026. No prototype promotion or production-gate verdict.** One
released run of the frozen eleven rows completed at
15:19:20.267–15:19:34.804 UTC. No retry, added case, budget/input/expectation change,
product patch or guest re-execution followed the failures.

Inputs: `c8df5cf2819d7ad9d54c2a70800258c7c200665a` (14 immutable files).
Versioned implementation was hash-frozen and committed **before the first guest**:
`91464989ff4c563195330cc3a7cacc4500c0bad0`.
Receipt release: `07a7dae5db51612a23e74d1d164d33723d4d61b6`, with report-only
correction `db139ae983ad66364e0367f9fb1ed0262ee61f63`.

## Exact denominator

| Row | Original recorded result | Qualified interpretation |
| --- | --- | --- |
| L01 aliases | PASS | Actual stdio/command aliases, accounted writes and cleanup |
| L02 budget-positive | PASS | Same finite Promise callback reaches both writes |
| L02 budget-exhausted | PASS | Actual steps budget stops second host write; status124 |
| L03 callback-live | PASS | Supported shell Promise continuation produces exact file/output |
| L03 callback-after-lifetime | PASS | No late host effect after facade lifetime closes |
| L04 explicit-children | PASS | Guest-reachable explicit graph, sibling isolation and late refusal |
| L05 caller-error | PASS | Exact caller Error wins; cooperative release and secondary error observed |
| L05 execution-error | **FAIL** | Assertion remains failed; intended selected-execution predicate is **UNPROVED** |
| L05 cleanup-error | PASS | Successful guest followed by exact sole cleanup Error |
| L06 curl-open | **INVALID_FIXTURE** | Frozen network-limit configuration rejected before guest admission |
| L06 curl-consumer-closed | **BLOCKED** | Positive prerequisite invalid; never launched |

Raw counts: **11 rows / 6 workflows; 10 children; 9 actual guest runs; 8 PASS,
1 FAIL, 1 INVALID_FIXTURE, 1 BLOCKED**. The raw report's `valid:9` counts guest-run
PASS/FAIL rows; it does not validate the failed row's intended selector premise.
Qualified coverage is eight passing rows, one unproved precedence target, one
invalid fixture and one blocked target. **The failed original assertion is not
waived, rewritten or counted as a pass. The complete cohort is not green.**

## Failed assertion: selected execution was not established

Finite input is the unchanged `../guests/precedence.ajs.data`: emit `admitted\n`,
then a Promise callback emits `selected\n`. Actual public command is
`outer.exec("owned-guest", ...)`; the registered fixture uses literal
`context.invoke("safejs", ["-e", exactGuestBytes, "--"], ...)`.

In L05-execution-error the second host write rejects with the single host Error
`execution:L05-execution-error`. Its public diagnostic sink also rejects with
that same Error. Cooperative cleanup rejects with the different single Error
`cleanup:L05-execution-error`. Caller is not aborted.

The exact journal is:

1. Accounted second write10 → host write rejection11 → facade abort12.
2. Actual diagnostic sink rejects13/14; actual engine rejects15.
3. **Actual nested safejs invocation returns status1 at16**, not a rejection.
4. Shared close enters17; resource release finishes19, rejects cleanup20;
   explicit close observes that same cleanup rejection21.
5. Another actual diagnostic sink rejection22 is followed by public settlement23.

Public outcome is a rejection with **the identical cleanupError**, stdout exactly
`admitted\n` (`61646d69747465640a`), stderr empty. The identity assertion expected
executionError and fails. The original failed assertion, Error objects' captured
messages/stacks, all diagnostic attempted bytes and journal remain in
`evidence/attempt-01/L05-execution-error.json`.

Pinned TEMP source explains why this is not evidence of an operation-precedence
bug: `src/shell/runtime.ts:510` unwraps ordinary command failures; lines522–529
attempt the utility diagnostic, catch a diagnostic sink failure unless aborted,
and return the selected command status. `invokeScoped` at1351/1384 routes through
that command path. `src/shell/shell.ts:94` separately preserves an actually
selected execution rejection, otherwise applies cleanup failure after draining.
This fixture did not establish the former. A real host sink throw alone was an
insufficient selector; the planned prerequisite remains unproved.

This is explicitly **not** a newly discovered raw-error product bug, an oracle
correction, or a proposed production fix. No parser-selector substitute or new
precedence row was run. ROOT may route this unsupported fixture premise; this
reviewer stops with its original failure intact.

Pinned source SHA-256:
- `src/shell/runtime.ts`: `d352c421177b82bd0a6f77ebc8cc9ab4b490e54cb39b685bb72871388a9fcb03`
- `dist/shell/runtime.js`: `dd5847a047829d2f5593ffb095c32316cc4102bb74d32950a68d772b23efd118`
- `src/shell/shell.ts`: `136bbf577a0b12c4998e942cc07c1ace52c1db328d093919a10b885b7041cb7a`

## Invalid curl fixture and blocked companion row

The frozen `CASES.json` supplies `maxRedirects:0` and `maxRetries:0`. Actual
`src/commands/network/shared.ts:7` requires every host limit to be a safe integer
**at least1**. `createCurlCommand` calls that validation during registration.
The first rejected key is maxRedirects. Actual Shell result is status1, empty
stdout and exact stderr:

```text
shell: line 1: Invalid network limit: maxRedirects
```

L06-open had **zero guest runs, zero authorization calls, zero transport calls,
zero upload/response bytes and no required body/header files**. Its owned wrapper
resource and inner Shell still close before public settlement. The dependent
closed-consumer row remains BLOCKED under the frozen positive-prerequisite rule.
Neither result proves streaming, independent file/header/stderr retention or a
guest membrane property. No limit is raised and no new trial is performed.

Pinned `src/commands/network/shared.ts` SHA-256 is
`7adab18b67c7584b646b3a6508729d7ab0672e7a0808f512f74ae16464f8842f`;
compiled `dist/commands/network/shared.js` is
`636549c0e9b1175658f9d58f9cb02b39e7e68ce86f42e62767eae15034be041e`.
No external network, native curl, DNS or ambient credential access occurred.

## Supported observations, not a general membrane verdict

The actual public package root and `virtual-bash/contracts/output` resolve the
same createOutputOperation function. The guest sees existing fs/stdio/command,
plus the explicit public shell facade in bridge rows. Command has no exec/invoke
API; literal invocation remains a host operation. No raw sink/operation/signal or
cleanup/acquire/release callback is injected into the guest.

The optional capability actually used is `ownedOutput.consumerClosed` plus
`ownedOutput.write`; no accountedWrite field or new public API exists. A trusted
fixture explicitly opts in before acquisition; **SafeJS itself does not opt in**.
The capability-write positive observes two writes and exact binary bytes
`616c6961730a007fff0a`, independent stderr and guest-set status7. In the budget pair,
the same finite source succeeds at200000 steps and fails at2049 against limit2048
before `after-budget\n`, with exact budget diagnostic/status124.

The detached lifetime row records engine return16, production facade abort17,
cooperative hold release18, hold resource release19, inner executor settlement22,
inner disposal30 and public settlement32. Its live positive creates `late\n`;
the detached row creates no late file/output/admission. This is effect containment
through those real facades, **not proof that no pure guest instruction executes
after return**, nor a reflection/property enumeration audit.

The explicit graph's child release, sibling write and parent closure checks all
pass before settlement. Parentage is declared with child(), not inferred from an
opaque sink or all pipeline stages. The host-only late acquisition/child callbacks
do not start; the guest's later registered command reaches the same closed parent.

Caller Error identity and sole cleanup Error controls pass. In the caller row,
resource release and its registered shared cleanup rejection are already recorded
before public settlement20; a losing handler's finally-close observer logs its
same rejection at21. No resource release occurs there. This does not assert an
opaque handler/underlying engine Promise must settle before public return, and
does not turn that late observer into a drainage bug or add a posthoc join.

Native default invocation abort is recorded as its actual AbortError, not literal
undefined. No synthetic literal-undefined override or reinterpretation of
AbortSignal.any backing reasons is used.

## Identity, guards and closure

Source identity remains
`6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea`:
213 source files, 940 candidate files, 708 compiled outputs. S2=S1; no later
source patch or live product overlay. Independent retained source/package routes
and the shared original preparation tree match before and after this run.

All **2,240 import records** verify against copied file identities: 1,580 public
package records, 630 actual-engine source records and30 harness/tool records.
There are224 unique logged files including63 unique engine files across10
children. Guard and unchanged-loader bootstrap bytes are separately frozen and
checked; this is not a claim that pre-hook bootstrap reads appear in import logs.
Actual hooks are run, Budget, makeFsModule and declareHostOperation from regular
copied definition modules. No private barrel or hidden live fallback is used.

Twenty-two immutable-copy checks re-enumerate complete included regular-file sets
and bytes/mode/mtime/ctime: before/after every launched child and at boundaries.
They detect new regular files and symlinks, **not new empty directories**; no
unqualified append-proof-tree claim. Private inventory excludes .git,
node_modules, dist, .cache and .turbo within its engine walk, as disclosed before.

Fresh private HEAD/tree/index/status/staging, six metadata files and all264 engine
files match before/after, using GIT_OPTIONAL_LOCKS=0. HEAD remains
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, index SHA-256
`2dc2ac516c19864f952c493eb39374db1a2946f359d31dfb6fd02a5fccfb6bc2`.
Preexisting dirty private state is preserved, not called clean. No private build,
install/cache/config write, worktree, symlink write or upstream patch occurs.
Live public source inventories are separately recorded and equal during this
short run; this equality is provenance, not candidate identity or a future lease.

All10 known case children close naturally (eight exit0, two exit1), with no signal,
watchdog, output-limit containment or rescue. All child guard reports have zero
created worker/subprocess/socket handles, zero remaining tracked timers and no
unhandled rejections. Shell disposal settles in every child, including invalid
registration. No foreign process is killed. After durable proof, only this
worker's `/private/tmp/safe-bash-owned-output-lifecycle-execution-cy2eHd` is removed.
The shared preparer/verifier snapshots are neither changed nor removed.

## Limits and stop

This audit establishes no actual new prototype defect from the two non-pass
observations: one selector premise is unproved and one configuration is invalid.
It also does **not** establish that no defect exists. The original failed assertion
remains a required non-pass item; streaming/file retention remains untested here.
No source fix, assertion migration, new fixture or expanded exploit is authorized
or attempted. Surface review remains separate.

Historical first-read5 prototype1/5 and captured baseline0/5, distinct opt-in5/5,
Q1 32/32, integration5009 18/19 and migrated656ee2/independent1602a 19/19 remain
history, not this run's scores. Frozen production8670 admission58130545 and
Faraday's dispatch work remain outside scope. Stop after sealing owned evidence.
