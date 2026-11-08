# Final committed-source public consumer acceptance

Source: `6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, explicitly authorized by
ROOT after the author relinquished the write lease. **All product executions
use full committed-source archives, not the live working tree.** This accepts
the measured modern behavior, not latest-live-aggregate cleanliness or complete
Bash/kernel parity. Source, contracts, exports, manifests and old tests/oracles
were not edited by this verifier.

## Exact current counts

| Independent cohort | GNU5.3 primary | Bash3.2 historical | Qualification |
| --- | --- | --- | --- |
| Unchanged public built consumer10 |**10/10**|**9/10**|Real public bare imports and compiled snapshot JS; correct failing statuses also count as exact matches|
| Public consumer host controls |**2/2**|not native assertions|Real literal invoke/shared-command budget and cancellation identity|
| Original expanded kernel36 |**30/36**|**29/36**|Every actual tuple unchanged from f1/3e2b880|
| Original expanded host10 |**10/10**|not native assertions|Every host observation unchanged|
| CORRECTED72 |**72/72**|same unchanged assertions|57 differential plus15 host rows; not72 raw native matches|
| Whole raw invocation57 |**52/57**|**50/57**|All57 actual tuples unchanged|

Each product cohort ran **once**, without retries, skips, xfails, normalization
or denominator changes. No reproducible new functional regression appeared in
these cohorts. The one public historical loss is `conditional-source`: modern
and current produce `source-okdone`, status0, empty stderr and phase bytes
`beforeafter`; historical produces empty stdout/stderr, status1 and phase
`before`. Both retain seeded0644 modes and the unchanged source fixture. This
is retained as a historical semantic difference, not selected away per case.

## Genuine public built-package proof

The original prepared `build-ready.mjs` and consumer ran unchanged. The driver
archives the **entire committed src tree** plus the unchanged manifest and both
root tsconfigs, verifies all176 archived files against6e Git blobs, and builds
in an isolated temporary directory. Build exits0. No live source overlay,
missing-file repair, dependency installation or package/export rename occurs.

- Runtime SHA256:
  `5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb`.
- Parser SHA256:
  `10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e`.
- Unchanged package manifest SHA256:
  `1f9579a9be0c1e1f23f03f38babad319fc1f8af941c7755aa7ca8759584cc2f1`.
- Built-source archive SHA256:
  `17907423d504244555d23462d4243bfa12483a4a4ed99f843678bbfed2880de6`.

The real package name is `virtual-bash`; its public root and contracts exports
resolve to the archived `dist/index.js` and `dist/contracts/index.js`. The
external consumer directory has a package-name symlink to that isolated package
with its unchanged manifest. This is real Node package resolution, not a fake
package manifest, direct source import or rewritten public name.

Existing development modules are linked for the build only; that symlink is
removed **before** the plain-Node consumer runs, with no tsx. Each of12 runs
records its exact resolved file URLs and **142 actually loaded compiled JS
hashes**, all within the emitted snapshot. Every load matches the572-file
emitted artifact manifest; source/config and emitted files remain unchanged.
The loader rejects non-JS product files and paths outside dist, so neither TS
nor a live source alias can masquerade as built output.

The consumer uses actual public `Shell`, `MemoryFileSystem`, `agentCommands`
and `FsError`/`ShellLimitError`, plus an injected plugin through `Shell.use`.
Middleware records actual literal invocation arguments. The real registry's cat
is present; the plugin's setup, commands and disposal execute. The shared-budget
row reaches its intended commands before typed exhaustion, and cancellation
preserves the exact supplied reason while observing late rejection. Product
child-process entry points are trapped before imports; none are called. Fetch
is disabled. This is local public-export proof for the private package, not an
npm-publication or general trusted-host-JavaScript sandbox claim.

`final-built-6e3e316.json` retains the full build/public proof and raw outcomes.
`final-audit.json` independently rechecks committed archived-file hashes,
compiled-load hashes, profile losses and cleanup.

## Full archived kernel replay and native references

The kernel replay uses a **second full6e source archive** with all173 committed
src files, unchanged package/tsconfigs, and committed test/benchmark code needed
for the unchanged runners and compiler checks. Runtime fixtures/helpers and the
31 prior immutable inputs are hash-checked; a111a2a preparation is unchanged.
There are1614 selected committed files plus three hash-recorded additive native
capture helpers. The helpers only select new artifact filenames and use6e for
snapshot HEAD metadata; no native fixture, role or expectation changes.

The snapshot has no live source overlay. Existing dev/benchmark modules are
explicit tooling links for tsx/typecheck, not source aliases. **50/50 phase
guards** pass: three native-capture parents,46 expanded rows and one whole72
runner. Actual source imports are142 for aggregate-backed rows and34 for
invocation; every loaded hash matches the committed archive before/load/after.
The complete selected-file manifest and endpoint remain unchanged. No source
from the concurrently changing live search/rg/export graph is imported.

Fresh native execution covers **all10+36+57 cases under both profiles**,206
case observations, plus four original role controls and six version captures.
Every tuple matches the original frozen reference, with no native drift. These
captures confirm rather than replace the immutable oracles. All native runs use
bounded isolated temp directories, original literal argv/source/$0, scrubbed
C environment, original fixture modes and original projection rules.

Primary binary SHA256 is
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`
at `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`; historical `/bin/bash`
SHA256 is
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
Public controls prove selected nested bash/sh versions and sh POSIX mode.
Original36 controls still prove a **Bash3.2 direct `/bin/bash` child beneath a
GNU5.3 parent**; the actual Darwin `/usr/bin/env` tool is not called GNU/Linux.

The original36 uses OS argv0 bash and `$0=shell`, with its declared native
canonical cwd→`/fixture` projection only. Original57 preserves OS argv0 bash,
`$0=outer` and the original one-line bash/sh role prelude; no source-name or line
normalization is added to improve raw results. Public consumer source is
unchanged and uses its distinct explicit name without a role-function prelude.
The original baseline saver failure/recovery remains historical; this final
native capture uses the already-disclosed harness-host-PATH arrangement while
actual oracle environments remain scrubbed. No final native retry occurred.

## Remaining exact kernel losses and shebang policy

Primary36 losses remain `header-execute-no-read`, `env-single-kernel-argument`,
`env-injection-text`, `env-missing-target`, `env-unsupported-interpreter`, and
`parameter-substitution-order`. Primary57 losses remain `path-only-denied-126`,
`path-missing-127`, `path-unsupported-shebang-policy`, `path-binary-policy`, and
`path-invalid-utf8-policy`. Additional historical-only losses are
`header-noexecute`, `stdin-eof-syntax-prior-effects`, and
`child-environment-isolation`. All raw statuses/bytes/effects are retained in
the additive kernel `FINAL_ROWS.md` and `final-rows-6e3e316.json`.

**The unchanged env-single row stays red.** Its `#!/usr/bin/env bash -e`
executes on actual Darwin and creates `marker=should-not-run`,0644, with status0
and empty output. Current6e instead returns126, no marker, empty stdout and
`shell: line 1: ./script: unsupported interpreter: /usr/bin/env bash -e\n`.
ROOT's approved protocol intentionally treats the optional argument as one
literal string, without shell splitting/quote evaluation; env literal
`bash -e` remains unsupported. This preserves a real raw capability/protocol
loss, not a waived pass. It is no longer evidence that ordinary real `-e` is
missing: the separate unchanged public consumer now verifies that behavior.

Other losses retain their previous classifications: diagnostic source/profile
differences,126-versus127 interpreter-allowlist boundaries, explicit invalid
UTF8/native-binary refusal, and virtual0666 versus native0644 creation mode.
The marker's exact `patternreplacement` bytes and `XbX` output still agree;
creation-mask policy is not fixed by a local expectation change.

The source design allows existing direct `/bin/bash` and `/usr/bin/bash`
bindings with a single literal supported e option, no new direct `/bin/sh`
allowlist, no env-S or shebang-c. Explicit bash FILE does not reapply a
recognized header option. These are ROOT's scoped design boundaries, not a
claim that this public10 independently covers every shebang form. No new
consumer shebang fixture was added after freeze. No ERR trap, inherit_errexit,
SHELLOPTS, nounset, creation-mask, lifecycle or fresh-budget policy claim follows.

## Compiler results — failures retained

| Check, exactly once | Exit | Actual prelisted inputs | Guard/result qualification |
| --- | --- | --- | --- |
| Isolated public-package emitting build |0|actual build input hashes retained|Only emits into its disposable committed archive|
| Frozen kernel global noEmit |**2**|1075|Six self-package/declaration-prerequisite errors retained|
| Frozen build-config noEmit |0|309|Stable fixed inputs; no live source aliases|
| Frozen benchmark noEmit |0|424|Stable fixed inputs; recorded development dependencies|
| Additional qualified live global noEmit |**2**|1970|One foreign test TS7053 retained; no fix/retry|

The frozen global check is **not an all-green completion gate**. The second,
source-only kernel archive did not contain emitted dist declarations required
by `tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts`.
It reports TS2307 for `virtual-bash` and `virtual-bash/commands/table-text`,
then four TS7006 implicit-any cascades. This runner lacked that generated
prerequisite in this separate archive; it is not a demonstrated product-source
regression. The first public archive did build successfully and proved actual
exports. No live dist overlay or second global attempt was used to make this
check green. Its exact six diagnostics remain in the artifact.

The live check reports TS7053 at
`tests/commands/stream-next-stress/independent.test.ts:91:95`: `keyof Actual`
can include `thrown`, absent from the indexed result type. Its observed HEAD
is `4244e9a3ef180f1ab819ec7028013c8c0f3083aa`, before/after;1970 listed inputs
are stable. This is an additional qualified live observation, not6e acceptance
or latest-live-tree certification. No foreign source/test is repaired.

All four noEmit input guards are valid, with zero input drift/unlisted inputs
or snapshot-to-live source aliases. **Guard-valid does not mean compiler-pass.**
TypeScript reads source for typechecking; its listed inputs are not mislabeled
as executed product imports. Raw logs, input maps and HEAD qualifications are
in `final-snapshot-6e3e316.json`.

## History, isolation and stop point

Original29/36→30/36 and historical28/36→29/36 remain preserved; this final
replay stays30/36+29/36. Earlier raw51/57+49/57 and later52/57+50/57 are not
rewritten. Original72/72 then71/72 and separately CORRECTED72/72 retain their
distinct provenance. No truthful registered command is relabeled builtin.

The separately owned hidden108 modern observations, historical results and
host4 remain separate ROOT-reported evidence, not this verifier's denominator
or oracle. Hidden cases were not inspected for additional expectations.
Accepted accounting, OLD9, CUSTOM firstread5, independent seven and broad224
were not rerun. Concurrent legacy five-row corrections were neither needed
for these frozen cohorts nor edited by this worker.

All362 recorded owned process groups are absent. Both built and kernel source
snapshots and native/trace temporary directories are removed. No SIGSTOP,
watcher, source write or waiting for another worker remains. Commit only the
additive owned evidence, preserve foreign staging and stop. Measured modern
errexit/public integration is accepted; global typing and documented raw
kernel/profile/policy limits remain explicit.
