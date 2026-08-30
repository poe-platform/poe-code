# Scoped inherited-helper adapter: author handoff

August 28, 2026. Ready for Dirac's different review against frozen requirements
bdb49d758809134e5aeb2aef57f8656a580f142e. This is author evidence, not independent
acceptance, proven old EPERM target identification, or gate release.

## Exact source and preserved boundaries

- Source 02a5060019bccdd2a64f9811812104ba09d2aaee; driver reseal
  96daebc077381fb63ab6447a26ab707ce790ff25. Use the latter commit for all shipping
  driver files, not moving HEAD. The source commit contains two files; a failed
  patch-order attempt left the seal unchanged, corrected in the separate reseal
  before any control execution. No unsealed driver was executed.
- Product stays f5e9fc49b6abb38e180cc9de16c95fced102ff75 and package expectation
  c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd.
- New normalized driver SHA256
  2db94b8bf54405e5713b103bd677c873fcc0b153454b3deed13ee8ab4e90583e.
- Unchanged normalized profile
  8c9363ea17f6a319acc783b1e7ec2a4d4dc0a00529692b9f2331f60571ab149f;
  routes b440b32475d24642d0fbe5dc222356ac1f209a11597baa07d63d286b06b68ca9.
- execute.mjs SHA256
  ca3f2f5379539c9b3c10b22bd90500ba1c10b36d8986b98b7777cdc92fe4f275;
  tool-routing.mjs SHA256
  bf8abf7cba221f23fbe79eea143ca718cdc6fa2864d3335e67904504042147f6.
- Exactly those two of37 bound driver members changed. BASELINE.json enumerates
  all35 unchanged member hashes, including OS fence, exact-six projection,
  phase/build/loader/observer protocols, source/profile/package/tool bindings.
  Only these byte-identical portions can refer to97c081ec/7fd7c7ae historical
  evidence; neither seal accepts the new adapter, callsites or driver identity.
- Frozen helper SHA256 remains
  60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db.
  No product, helper, permissions, private checkout, old capture or failed-root
  changes. Consumed8e6b and df89d474 remain0/14, not reclassified or rerun.

## API and scope mapping

Shipping tool-routing.mjs exports
`createInheritedHelperRoute(binding, environment, nativeRoot)` returning
`{ records, assertIdle(), async run(label, callback) }`.
Binding comes from existing createToolPath; run freshly verifies all finite
aliases/native entries/Git-core and exact options before process-local ownership.
Only PATH, GIT_EXEC_PATH, GIT_OPTIONAL_LOCKS="0" are installed. Other environment
keys/object are unchanged and checked for boundary drift. Each own presence/value
restores; all three restoration attempts run even if one fails. Unrestored state
poisons reuse; no test-only reset/injection API is shipped.

Labels and actual source callsites:
- prerequisites: complete awaited privateModule.prerequisites call; includes its
  imports and two internal privateState checkpoints, not independently invoked.
- private-final-sweep: only the outer privateState call, after normal phase guards.
- private-finally: only the already-eligible privateState guard in finally; early
  failures do not fabricate privateBefore or suppress required later guards.

The latter two callsites are source-verified, NOT exercised against privateState.
The existing eligibility condition and catch/error reporting remain. assertIdle
precedes subsequent ambient verification. A sole callback failure preserves its
exact thrown value; multiple failures are an AggregateError with original values
and category records, including installation/drift/restoration verification.

The lock remains through callback await/restoration. Cancellation only matters if
the callback cooperatively settles; there is no adapter deadline race. An observed
deadline/disconnect is not ownership release or child cleanup. The trusted worker
has no concurrently launched phase during prerequisites; this is not arbitrary
host-JS isolation, transient-mutation detection, configuration sanitization or a
universal detached-process guarantee. Observer/loader/build environments are not
rewritten; explicit historical nested environments remain explicit and unchanged.

## Actual author evidence, with harness failures retained

Preseal a929990a4e3e113b39bfbabe94bb8c80080b3a89 preceded source. Harness
f9f58d82a377803c3a82ba36586162a69c5f776d executed the ten groups at
/private/tmp/unified76-inherited-author-9algcW from09:52:16.867Z to09:52:22.762Z.
RUN-V1 retains9PASS/1FAIL/0unexecuted,35 successful checks, CLIexit1. G09's first
direct Git fixture read succeeded, then a harness schema assertion failed:
scopeInputs has Git blob/bytes, not sha256. Bare-name dispatch was unreached;
that attempt did not retain its per-dispatch telemetry. Do not invent it.

Separate harness-only correction/preseal0fac0091adf454f586f07908523d111ed5bbb8ff
compares existing exact Git blob identity/length and saves dispatch telemetry
before/after. RUN-V2 used /private/tmp/unified76-inherited-author-P7D602 from
09:54:22.345Z to09:54:24.180Z: G09 alone1PASS/0FAIL/9NOTRERUN, two checks.
Its control worker exited0; coordinator CLI still exited1 because its return
expression recognized AUTHOR_PASS but not AUTHOR_FOCUSED_PASS. That historical
exit is retained. A subsequent reporter-only correction is checked offline by
eight controls; no third native run or fresh ten-group result is claimed.

The scoped evidence is35 retained checks plus2 actual G09-v2 checks, not a newly
executed10/10 command. reporter-controls.mjs rejects the original failure,
unknown status, missing groups, failure count, forced cleanup, nonzero child and
false full-rerun claim. REPLAY-BINDING.json describes the corrected current
harness; it is PREPARED, NOT EXECUTED. Historical harness bindings remain in Git
and AUTHOR-BINDING{,-V2}.json; do not use their hashes for current source.

All11 control workers closed naturally, no timeout/signal/output intervention.
Four v2 synchronous Git children completed status0, signalnull, empty stderr;
one additional v1 direct read precedes its assertion failure. No whole process
image/survivor guarantee is inferred from synchronous completion. New owned
roots remain for review. No active author child/session remains.

## Actual dispatch proof and limits

The exact frozen authority-map excerpt SHA256 is
41e8bbf0e913189bf8b273a93499ac597515928b264cc52ac5c86b151a3d5cd7.
It executes in a bounded VM with a narrow exec binding allowing only the two
fixed `git --no-replace-objects show f5:<authority-path>` vectors/cwd. The binding
adds5s/2MiB bounds but does not supply env for the literal bare-name calls.
There is no import/call of prerequisites or private engine code.

Fresh selected source matches fixed Git blobs ba1392fcadfe2b89764d5e0638ece105871b6f43
(8968bytes) and885d7c83fcfaae3fece2a1b7e6b8a7f3bc620932 (6197bytes).
Two direct setup reads then two bare-name reads return byte-identical content.
Before and after each dispatch, finite PATH/alias/Git-core and executable verify.
Actual effective PATH is the recorded G09/native:G09/tool-bin only; resolution is
/Applications/Xcode.app/Contents/Developer/usr/bin/git, SHA256
10f9c1df894525ae4c7454258febab6d3d25071062b42cb48dbb1842cdffd2a9.
Receipts include argv/cwd/resolved path/hash/PID/status/signal/bytes and explicit
error-null; failure fields code/errno/syscall/path/spawnargs are retained when
available. This is pre-dispatch unique-route evidence, not a kernel exec trace.
It does not establish the historical EPERM executable or success inside the
shipping OS fence; these author controls did not invoke that fence.

## Review and next permission boundary

Independent bdb49d75's12families/33cases remain its own unexecuted cohort until
root grants its review. Our coverage includes three source scopes, fresh routes,
success/falsy/sync/async failures, delay/cancel/overlap, drift/object replacement,
partial install, multiple restoration failures/poison, and actual bare Git.
OS-fence/private/phase-composition claims remain inherited source proof only.
Both changed shipping modules passed Node24 --check; no product build/types ran.

After independent acceptance, proposed next bounded setup check: one NEW
shipping-fenced worker running only this exact authority-map subset on fresh
selected files (four fixed Git reads,60s worker,5s/2MiB each read,1MiB per worker
output stream), using the existing outer observer/protocol. No full archive,
privateState/prerequisites/privatecopy/A10/phase execution; fail closed on any
unknown route, fence, output or cleanup issue. This check is NOT authorized or
implemented here. A real complete setup/gate would need separate root approval,
fresh bindings and resource bounds; no consumed GO transfers.
