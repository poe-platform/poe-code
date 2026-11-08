# Independent fixture-validity review: preparation only

Prepared August 27, 2026 by delegated **different independent reviewer**, thread
`01a042ef-2082-7a20-a1b5-c3ba7235ff76`; not the source author, earlier fixture
authors/reviewers, or concurrent validity author. Ownership is only this new
directory and regular `/tmp` scratch. No production, root, package, contract,
configuration, upstream, private, original fixture, or shebang changes.

**Release gate:** STOP after this preparation commit. Do not read the concurrent
`env-split-validity/` inputs/expectations or execute/import the product until ROOT
supplies the author's full frozen fixture commit and releases acceptance. No
polling, watchers, native reruns, build, pack, install, or product replay occurred
in preparation. `verify-preparation.mjs` only reads Git/files, authenticates old
evidence, and constructs an in-memory Git archive. It is not a replay driver.

## Immutable engine and evidence

`pins.json` freezes source `84ab66ca717e0dff21abf57051b41cb553f3c7f3`, complete
source/root archive and captured actual tgz, and the complete historical author,
holdout, and packed-consumer evidence trees at their respective full commits.
The archive has **213 source + 7 root = 220 files**, not just the env delta.
The retained tgz is **630766 bytes**, SHA256
`3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c`;
the old proof records 708 emitted and 710 packed/installed files. Metadata checks
here authenticate that existing proof, not a new build or installed execution.

Do not substitute moving HEAD. Relative to the holdout baseline the full source
also changes package.json, internal.ts, network/body.ts, streams.ts, structured/
jq.ts, src/index.ts and plugins/index.ts, besides the env changes. The source
author also disclosed foreign body/jq changes after its validation guard closed.
Historical source checks cannot certify all inputs of this integrated candidate.

| Historical measurement, not new acceptance | Frozen result |
| --- | --- |
| Original holdout baseline | 1/48 exact, 41 mismatches, 6 unavailable; 0/7 hosts |
| Setup-v2 baseline | 2/48 exact, 46 mismatches; 0/7 hosts |
| Candidate holdout | 40/48 exact, 8 mismatches; 6/7 hosts; all 55 slots ran |
| Candidate command partition | 39/42 exact + 3 strict diagnostic losses |
| Candidate protocol partition | 1/6 exact + 5 strict protocol losses |
| Frozen packed assertions | 0/10 in each whole profile; 0/5 host executions |
| Packed raw tuples, NOT assertion passes | 7/10 in each profile + 3 shebang losses |

The packed hosts have **3 IDs / 5 executions**; their input host has 3 variants.
The hidden 7 hosts are separate. Do not pool these denominators. A possible
43-slot selection means 42 command slots plus the one plain protocol control,
not 43 exact core matches: **39 native-exact + 3 virtual-diagnostic checks + 1
separate plain binding control**. Its diagnostic checks remain native losses.
New author's row/control counts are unknown until its freeze; no guessed score.

Preserve all original 48+7 and 10+5 observations and failures in future side-by-
side replay on the SAME installed engine. Do not replace original 0/10+0/5 with
raw 7/10, or label invalid-host failure as a parser failure. Keep both older
holdout baselines and all original captures, including prior setup defects.

## Three binding corrections: acceptance criteria

1. **Invoke input is ByteSource, not Shell.exec's convenience bytes.** The
   original hidden `literal-invoke-replace-env-parent` supplies raw Uint8Array
   to invoke.stdin. A disclosed correction may supply a genuine async iterable
   of Uint8Array (including zero yields), retaining explicit origin false. It
   must still dispatch bridge -> env -> envcap -> printf through real middleware,
   produce exact `abcparent:private`, literal args `a b` and `$(not-evaluated)`,
   exact child map `{KEEP: 'a b'}`, empty stdin, and unchanged parent local/export
   state. Require status/stderr and effect assertions, not merely absence of a
   throw. Do not change invoke's type, omit the nested call, move to a stub, or
   silently replace explicit empty with default input.
2. **Parent locals need one exec.** The old packed setup and final parent probe
   are separate exec calls; locals are per exec. A correction must put setup,
   tested dispatch and reachable parent observation in the same exec, or retain
   raw native rows and add a mandatory equivalent same-exec invariant companion.
   Check both local value and absence from exported maps, exported PUBLIC value,
   cwd, child dispatch and effects. Do not merely delete the assertion, accept an
   empty local, seed SECRET as an export, or interpret a fresh exec as a session.
   Extra shell commands change command/source/output charging; disclose that and
   keep the original raw tuple and budget witnesses separately observable. No
   stdout stripping or bigger budget just to hide a new setup charge. Aborted
   exec cannot reach a trailing probe: record reachable parent-context snapshots
   without claiming that a later fresh exec proves retained local state.
3. **Replacement is per invocation boundary.** Original input variants must
   still reach env's immediate child `forward` with exactly `{KEEP: 'value'}`.
   Omitted/false replaceEnv at forward -> sink retains the existing merge/PWD
   behavior: exact `{KEEP: 'value', PWD: '/packed'}` there. True requires exactly
   the supplied map, or `{}` when omitted. Test both branches; do not change the
   old default call to true and call that the same scenario, allow arbitrary
   extra exports, or drop the immediate replacement assertion. Retain real cat,
   middleware args/counts, cwd, origins, and exact binary bytes `00ffc3a90a`.

Authority: frozen `src/contracts/command.ts:5`, `src/contracts/io.ts:4`,
`src/contracts/command.md:3`, `src/shell/shell.ts:133`,
`src/shell/runtime.ts:1328`, `src/shell/input.ts:14`, and
`src/commands/execution.ts:85`; not inferred new APIs or lifecycle promises.

## Three diagnostic-only rows

Use the complete tuples in pinned `core-review-84ab66c.json`, including exact
original native stderr, stdout, status, before/after bytes and modes. Add only
separately labeled virtual diagnostic assertions, each with its exact final LF:

| ID | Status | Exact virtual stderr before final LF |
| --- | ---: | --- |
| packed-non-s-single-operand | 127 | `shell: line 1: argvprobe two words: command not found` |
| missing-command-negative | 127 | `shell: line 1: env-split-never-a-real-command: command not found` |
| nonexecutable-command-negative | 126 | `shell: line 1: ./nonexec: Permission denied` |

No substring-only/errno-only test or blanket stderr waiver. Assert no target
dispatch/injection effect and preserve `effect=original` mode0644 and the
nonexec file bytes/mode where present. Each remains a strict native nonmatch.
The remaining hidden losses are four env-S126 refusals (`split-errexit`,
`split-assignment-and-clear`, `split-long-plus-option`, `split-quoted-marker`)
and `non-s-packed-bash-option`126 versus native127. Packed shebang losses are
separate: two env-S refusals and non-S policy126 versus Darwin-kernel native0.
Do not swap the single-optional and actual-kernel reference profiles.

## Independent targeted control plan, frozen before seeing revisions

At most six small control groups beyond original/revised replay; no new parser
benchmark or duplicate broad author suite. Planned, **not run**:

| Control | Positive and negative witnesses |
| --- | --- |
| C1 parent state | Same-exec private local/exported PUBLIC survives nested env success and ordinary nonzero result; capture post-child exports to exclude local promotion. Separate cross-exec negative demonstrates local reset while constructor exports remain. Mutation of either parent value/export membership must fail assertions. |
| C2 input binding/cursor | Valid empty async source with explicit false; default-empty true, explicit-empty false, binary false remain distinct. Consume one chunk then transparently invoke env and sink; assert the exact remaining suffix, no replay/drop, and unchanged origin. Compile a separate intentionally invalid raw-Uint8Array invoke input and require its specific public-declaration type error. |
| C3 environment boundary | Actual forward -> sink calls with omitted, false, true+map, and true+no-map options. Compare exact maps at both boundaries, unchanged cwd/parent exports, literal argv, middleware order and counts. Wrong extra PWD on true, missing PWD on default, or an inherited SECRET must fail. |
| C4 shared commands | Actual bridge -> env -> child: maxCommands2 rejects before child; 3 admits it once. Retain packed original4/first-not-forbidden witness separately. A fresh nested budget or missing env dispatch must fail. Preserve unchanged hidden expansion4096 rejection/no-dispatch evidence rather than add a new growth requirement. |
| C5 cancel/cleanup | Enter a real nested waiter once, register idempotent cooperative cleanup before resource admission, abort with the exact FsError ENOENT object, and gate cleanup completion. Public rejection waits for admitted cooperative cleanup and preserves identity; dispose closes ownership. Observe a deliberately late handler rejection, clear timers/listeners, and record parent exported-context snapshots. Do not wait for opaque host work or require post-abort child dispatch. |
| C6 output accounting | Real nested output plus tail: awaited sink sees exact abcTAIL at7 bytes; at6 the typed maxOutputBytes rejection preserves exact abc partial bytes. A gated sink proves writes/settlement are awaited; no lost/duplicated chunks or double charging at env's forwarding boundary. |

Use only actual installed public Shell/registry/plugins/contracts. Capture owned
copies of retained byte chunks, real command traces, outcomes and effects before
asserting so an unrelated later failure cannot overwrite abort identity or hide
the original result. Keep passing and failing control evidence; no retries for
green. Small in-memory observation mutations may test assertion sensitivity,
explicitly labeled harness controls, never counted as product/native passes.

## Acceptance handoff after ROOT release

1. Receive full fixture commit and author thread ID; verify identity differs,
   inspect scoped instructions, freeze all new inputs/helpers/expected tuples,
   and produce old -> revised row/assertion crosswalk. Reject unrelated changes,
   weaker/no-op assertions or undisclosed semantic changes; report, do not repair.
2. Reauthenticate pins. Prefer reconstructing the existing exact base64 tgz;
   audit tar checksums/paths/types/links/duplicates before extraction. A fresh
   exact-candidate archive/build/pack is an explicitly recorded fallback, never
   a live-source overlay. Pin every source/root/compiler input and emitted file.
3. Use existing authenticated plain Node22 and offline local-tgz npm installation
   in a fresh regular `/tmp` consumer; ignore scripts, isolate HOME/config/cache,
   disable audit/fund/update/network, and keep runtime dependencies empty. Install
   no root/private packages. Physically move the consumer before execution and
   verify realpath/bare `virtual-bash` and `virtual-bash/contracts` resolution
   after moving. No fake package, symlink alias, tsx/source fallback or TS stubs.
4. Authenticate installed files against all710 captured hashes before/after each
   run; record actual compiled JS loads and public declaration resolution. Arm
   product child_process/fetch denials before dynamic import. Controller-only
   tooling may spawn bounded children; hooks are not a trusted-JS sandbox claim.
   Check positive and negative declaration consumers against actual installed
   exports; a compiler prerequisite failure is not a successful negative test.
5. Replay all original slots and disclosed revised strong-core assertions on
   that same installation/hash; retain raw failures and assertion failures next
   to corrected outcomes. Hidden primary is the whole GNU9.7/Darwin aligned
   profile (42 command + 6 single-optional rows); its Apple/Bash3.2 history stays
   separate. Packed10 rows reuse BOTH whole GNU-env profiles with Bash5.3/3.2.
   No fresh/per-case oracle, native quote/status change or output normalization.
6. Set 20s/8MiB bounds per product child, 60s per tooling child; retain partial
   failures/timeouts as failures. Run sequentially, record/reap every owned child
   group, close sources/sinks/cooperative cleanup, remove only owned scratch and
   verify absence. Record source/input/install guards again. Report exact counts
   separately; source bugs or weak revisions go to ROOT without source repair.

Preparation validation command (no product execution):
`node tests/shell-stress/env-split-validity-review/verify-preparation.mjs`
