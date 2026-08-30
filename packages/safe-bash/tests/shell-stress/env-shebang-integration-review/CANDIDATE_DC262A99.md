# Independent candidate review — August 27, 2026

Candidate: `dc262a99da8910d082ce7051e811952639588209`.
This reviewer is neither the implementation author nor the frozen-corpus author.
Only new candidate review/evidence files were created; no product, old test,
sealed harness, original capture, package, private checkout or prototype changed.

## Decision and denominators

**Not a 30/30 acceptance.** The exact frozen replay has **27/30 raw and qualified
passes, three retained failures**: 19/20 shebang, 4/4 direct-env, 4/6 host cases.
All 30 structured observations are available. No assertion or oracle was changed.
The three failures expose acceptance requirements not delivered by the restricted
internal-interpreter design. Two directly conflict with the recorded closed
bash/sh-only authorization; the third concerns internal middleware visibility.
Do not relabel these failures as passes, remove their denominator, or silently
broaden production dispatch to make this corpus green.

The original baseline remains **7/30 raw, 6/30 qualified, 23 failures and one
non-proving raw pass**. Its original setup failure remains 0/30 observations,
not 30 product failures. Both baseline archives and their reports remain intact.

| Independently rerun, committed candidate inputs | Actual outcome |
| --- | --- |
| Frozen compiled-public-entry corpus | 27/30; no timeout or overflow |
| Existing new author tests, unchanged | 29/29; no skipped/cancelled/TODO tests |
| Existing env core/invoke controls, unchanged | 125/126; one original refusal assertion fails |
| Existing script/interpreter controls, unchanged | 203/210; seven original refusal assertions fail |
| Source-only builds in both archives | Both succeed |
| Strict primary native tuple comparison | 16/23 available references |
| Actual Darwin kernel observations | 20 attempts, including unknown-interpreter launch error |

The same eight failures reported by the author were reproduced independently;
the author's marker was read for routing, not accepted as proof. Seven old
refusals are contradicted by finite native observations; the eighth is obsolete
under the authorized closed-target policy but **is not native parity**. No new
implementation defect within that closed-target scope was established by these
eight failures. This is narrower than accepting the whole feature or corpus.

## Frozen failures and weak-assertion qualification

`candidate-dc262a99/report.json` retains exact input, output bytes, errors, effects,
middleware observations, references and assertions for every row.

- **s20: executable VFS delegate.** Expected status 0 and
  `delegate:<./script>|<tail>\n`; actual status 127, empty stdout,
  `env: ./delegate: command not found\n`. The native primary succeeds and all
  file effects remain unchanged. This is a real unsupported semantic case, not
  a native fixture-path defect. `runtime.ts:1156` intentionally rejects every
  target except literal bash/sh. It implements the recorded authorization, which
  explicitly prohibits arbitrary VFS/registry/PATH interpreter dispatch. ROOT
  must resolve the mismatch between that authorization and the frozen requirement.
- **h04: middleware observation.** The live, one-byte-high-water-mark pipeline
  actually returns status 0, exactly `ab`, and empty stderr. Observed commands are
  producer, script, consumer and `cat`; the frozen `env` middleware witness is
  absent. `runtime.ts:1145` calls the accepted env definition internally, without
  the middleware dispatcher. This is an observability acceptance gap, **not**
  evidence of buffering, backpressure failure or pipe corruption. The existing
  generic invoke contract preserves middleware, but the new reserved internal
  interpreter bridge is not that generic dispatch path. Do not silently decide
  that this frozen witness is either mandatory public behavior or a test defect;
  ROOT must specify the boundary. The row remains failed.
- **h05: registered target and exact replacement witness.** The registered probe
  is never invoked; captures are empty and stderr reports it missing. The outer
  command still prints the unchanged parent value. This does not prove the
  intended child environment/input/provenance assertions. The same closed-target
  guard causes this gap; the ordinary `CommandContext.invoke` implementation was
  not changed. ROOT must explicitly authorize a broader target policy before
  requesting this behavior; do not route arbitrary names through normal dispatch.
- **h06: now a qualified pass.** Unlike the baseline's diagnostic-only false
  positive, actual middleware observations show `./script`, `./inner`, `printf`
  before `ShellLimitError(maxOutputBytes)` under the two-byte limit. The unchanged
  nested body is the three-byte output producer. This independent route witness
  supports the intended assertion without modifying its weak executable check.

Strict primary losses remain seven: s03/s17/s18/d02 have exact stderr differences;
s12/d04 have physical `/private/tmp` versus virtual `/tmp` stdout spelling; s20
has the unsupported delegate result. The two path spellings are fixture namespace
limitations, not demonstrated cwd bugs. No normalization was applied. Four
diagnostic-policy losses in this new cohort must not be confused with the prior
**three CLI diagnostic-prefix differences** in the accepted direct-env evidence.

## Eight unchanged original failures

Raw TAP is in `candidate-dc262a99-controls/{core,scripts}.tap`. Supplementary
compiled-public-entry observations retain the original source bytes in
`original-assertion-observations.json`; native invocations, raw bytes, timeout,
effects and authenticated binary hashes are in that directory's `report.json`.
These supplementary observations do not modify or replace the original tests.

All eight first fail `assert.equal(result.exitCode, 126)`. The same source lines
also demand empty stdout and an `unsupported interpreter` stderr match. The core
row additionally demands only the script in `/work`; that namespace assertion
would still hold. Every supplementary candidate script remains byte-identical,
and no marker/effect file is created.

| Original assertion location / exact header suffix | Candidate status / stdout | Native expected observation in declared profile | Classification |
| --- | --- | --- | --- |
| `env-split-author/resume-host.ts:94`, `bash -e` | 127 / empty | 127 / empty; literal missing command | Obsolete 126 and old diagnostic; no body effect |
| `errexit-host.test.ts:131`, `bash -e` | 127 / empty | 127 / empty | Obsolete refusal status/diagnostic |
| `errexit-host.test.ts:131`, `-S bash -e` | 0 / `BAD` | 0 / `BAD`, empty stderr | Obsolete refusal and empty-output assertions; the body contains no failing command |
| `expanded-gaps-env-host.test.ts:7`, `bash -e` | 127 / empty | 127 / empty | Obsolete refusal status/diagnostic |
| `expanded-gaps-env-host.test.ts:7`, `-S bash -e` | 0 / `forbidden` | 0 / `forbidden`, empty stderr | Obsolete refusal and empty-output assertions |
| `expanded-gaps-env-host.test.ts:7`, `python` | 127 / empty | 127 / empty with explicitly python-free PATH | Obsolete unsupported-header guard; no Python support inferred |
| `expanded-gaps-env-host.test.ts:7`, no optional argument | 127 / empty | No settled status; recursive execution hit the deliberate 300 ms deadline and was killed | Old 126 guard obsolete under closed target policy; retained native divergence/nontermination, **not** a native match |
| `expanded-gaps-env-host.test.ts:7`, `bash\r` | 127 / empty | 127 / empty; CR remains in the missing command name | Obsolete refusal status/diagnostic; no CR normalization |

For all finite missing-command cases, candidate stderr is exactly
`env: TARGET: command not found\n` (literal CR in the final target). Native stderr
uses GNU missing-file diagnostics; packed bash/CR cases include the shebang `-S`
hint. Those byte differences are retained, not treated as exact stderr parity.
The no-optional candidate diagnostic names `/script`. Native supplementation
uses the same source bytes at an isolated physical `./script`; kernel re-entry
uses Darwin's `/usr/bin/env`, not a fictitious Linux kernel. Its timeout proves
only bounded non-settlement here, not mathematical infinite execution, errno 126,
or an expected native 127. No oracle switch was used to obtain a passing score.

ROOT may authorize precise test reconciliation later: keep literal non-S/CR
refusals as 127 with an explicit virtual diagnostic; replace only env-S refusal
expectations with their actual execution outputs; separately document the
closed-target policies for unavailable names and no-optional recursive entry.
Do not merely change every 126 to 127, drop stdout/effects checks, or rewrite
these eight historical test failures in this review.

## Source and contract audit

`candidate-dc262a99-audit/source-scope.patch` is the exact candidate-parent runtime
diff. The commit changes only `src/shell/runtime.ts` and adds the two author test
files. Runtime changes are confined to the execution-family import, optional
loaded-source forwarding in `interpreter`, a private reserved bridge, and
`scriptFile`. No normal invoke/executor/discovery, root/public exports, package,
contracts, private runtime or ownedOutput code changed. The baseline-to-candidate
archive also includes an intervening **grep-aliases** change; it is disclosed in
the audit, not misattributed to this three-file candidate commit.

- **Reuse:** `execution.ts` and `env-split.ts` are byte-identical to the accepted
  baseline. A cached env definition is obtained from `executionCommands`; no
  parser or environment implementation is copied. There is no new eval, native
  process, host filesystem, ambient credential or PATH interpreter resolution.
  The frozen product deny hooks record zero attempts, within their scoped limits.
- **Literal argv:** `runtime.ts:1146` passes zero or one entire optional suffix,
  then script and user operands. Only the accepted env-S parser splits it. Full
  selected argv reaches the existing interpreter; non-S packed input remains a
  missing single command. The registry bash/sh override still refuses 126.
- **Environment/cwd:** the handler expands against incoming exported values,
  then handles clear/unset/assign/cwd using its unchanged semantics. The bridge
  copies its computed environment into a null-prototype map and updates isolated
  state cwd as well as context cwd. `processState` separately initializes child
  Bash variables/PWD and clears inherited functions/options. Parent state is not
  modified. This does not promise that Bash startup exports equal a generic
  command-entry replacement map; the existing command contract distinguishes it.
- **Flags and source:** `-c`, `-s`, `-e`, `+e`, `--`, argv0 and positionals use
  the existing interpreter. Already charged text is reused only if the selected
  resolved VFS path equals the loaded source path. Changed cwd/alternate file
  selection reads and charges that actual file; command strings charge their
  own bytes. Only direct executable entry applies the env dispatch. This is not
  host Bash's complete option set or general executable interpreter support.
- **Budgets:** the bridge asserts open invocation scope, ticks the existing
  command budget and checks field count/per-argument expansion bytes before
  selection. Script/interpreter processing shares the existing source, depth,
  loop, input and output machinery; it creates no new Shell or Budget. Frozen
  command/depth/output witnesses and unchanged source/loop/expansion tests pass.
  Source limits precede decode; alternate source reads retain VFS access checks.
- **Streams/lifecycle:** streams and `stdinIsDefault` are forwarded; no new
  collector, output owner or resource acquisition is introduced. Frozen live
  pipeline bytes pass even though its middleware assertion fails. The typed
  callback failure is retained and rethrown after the env wrapper; signal abort
  identity takes precedence. Frozen cooperative cleanup is registered and
  completed exactly once at exec settlement. Unchanged archived author controls
  additionally cover errno-shaped aborts, delayed rejections, input return, sink
  cancellation and cleanup failure identity. None proves forcibly stopping opaque
  host promises or universal cleanup of uncooperative host work.

Runtime SHA256:
`10c962649d4486f564aee7362a2913af86ad4dfdb3a5b3ecc0cb49f482d40243`.
Execution SHA256:
`61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6`.
Env split SHA256:
`b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4`.
Git blobs, all archive inputs and emitted hashes are retained in JSON evidence.

## Integrity, profiles and actual cleanup

The exact requested command ran 14:55:38.366–14:55:57.140 UTC:

```sh
node tests/shell-stress/env-shebang-integration-review/run-v2.mjs capture dc262a99da8910d082ce7051e811952639588209 candidate-dc262a99
```

The source archive has 225 authenticated inputs and 5,220 authenticated JS module
loads across 30 plain-Node public-entry children. GNU env 9.7 and GNU Bash
5.3.0(1)-release are actual hash-authenticated Darwin executables. Primary
references explicitly model Linux's single optional argv element; actual Darwin
kernel runs remain separate. There was no Linux runtime qualification.

Archived scoped controls ran 14:58:41.900–14:59:12.390 UTC using 480 authenticated
committed source/build/test/fixture inputs. They import archived TS through the
existing tsx dev install; the supplementary observer imports that archive's built
public entry. No mutable-live fallback, dependency installation or fixture edit
occurred. Source/dist/tool hashes are stable before/after both runs. The archive
includes selected historical native data as data, not a whole-TypeScript-input
qualification or a whole-repository gate. Original captures were checked against
`d5716c46`; original and v2 seals were reverified against their freeze commits.
All three new reviewer scripts pass `node --check`; evidence manifests and both
baseline audits pass. `git diff --check` flags whitespace in verbatim TAP and
the exact source-diff capture. Those raw bytes are deliberately preserved, not
formatted; the authored report and reviewer scripts pass the scoped check.

Frozen cleanup records **75 actual owned process groups absent** and its scratch
root removed (76 process records include the no-PID launch failure). Scoped
controls record **13 owned top-level groups absent**, with their scratch removed;
the unchanged host tests also check their child settlement. One supplementary
recursive native probe intentionally times out and is killed; it is not a frozen
corpus timeout and receives no success credit. All three reviewer runners have
finished. No owned waiting worker/watchdog or dormant process is left running.
Authenticated pre-existing oracle installations are not reviewer-owned scratch
and were not removed.

Primary manuals were consulted via web.run on August 27, 2026: GNU Coreutils
env invocation (split-string and status meanings), Linux man-pages execve(2)
(single optional argument), and GNU Bash Invoking Bash (source/argv selection).
The current Coreutils web manual identifies 9.11; it is supporting documentation,
**not** substituted evidence for the authenticated 9.7 executable. Source locators:
`https://www.gnu.org/s/coreutils/manual/html_node/env-invocation.html`,
`https://man7.org/linux/man-pages/man2/execve.2.html`,
`https://www.gnu.org/s/bash/manual/html_node/Invoking-Bash.html`.

No packed-package acceptance, full suite, strict all-input typecheck, new
whole8670 gate, provider qualification, performance win, superiority claim or
72-hour completion is made. Whole8670 stays immutable. Prior five GNU/three
Darwin protocol losses and three CLI diagnostic-prefix differences remain
historical, separate evidence, not retroactively repaired by this replay.

## Minimal ROOT routing

Keep candidate acceptance open at 27/30. No source patch is requested for the
eight obsolete old-guard assertions; reconcile them separately only with the
row-specific qualifications above. The two closed-target acceptance gaps cannot
be fixed within the recorded no-arbitrary-dispatch authorization. ROOT must
choose an explicit scope change or retain a documented unsupported gap, without
changing this frozen result. If internal env middleware visibility is required,
authorize a narrowly scoped observed internal stage that retains the closed
interpreter bridge, shared budgets and cleanup; do not replace it with unrestricted
registry/PATH invocation. Preserve all failing evidence before any subsequent
source or separately versioned acceptance work.
