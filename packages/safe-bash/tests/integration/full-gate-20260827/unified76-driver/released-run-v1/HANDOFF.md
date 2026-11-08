# One authorized fixed76 attempt — setup refusal, no retry

**Terminal exit1 / HOLD_OR_QUALIFIED_RED.** Exactly one actual CLI `--run` was
issued under fresh root authorization8e6b40ecd2cec2b6dcaf2ce80c0cff477d39e6eb.
Receipt SHA256 is
`f29a198d05e113a2a0b913a57bd7a2b088a7f731d6121947527652c40d2b8e74`.
It binds packetd9dd698a/7e40e84c, accepted driver review97c081ec and metadata
review7fd7c7ae to unchanged productf5/driver25ee/profile8c93/packc109/routesb440.
The actual `requireRelease` passed;46 committed source/evidence records were
authenticated before launch. No old GO was inherited. This one-attempt policy
is not a consumed-token mechanism and does not authorize another invocation.

## Actual outcome

- Tool session92296 executed the exact sealed LAUNCH.md command once. Inner setup
  began2026-08-28T09:20:27.564Z and ended09:21:12.112Z; outer worker elapsed60,383ms.
- Mandatory preflight admitted with no issues:51 native asset bindings and
  existing readable tools/dependencies verified. These are identity checks, not
 51 native-semantic test passes.
- Setup authenticated37,397 logical /37,392 physical candidate entries, exact
  five metadata-only instruction omissions, plus the sixth benchmark omission.
  It transferred452,090,184 opaque Git bytes with `checkoutPerformed:false` and
  copied the declared dependencies/native staging before the failure.
- **0/14 phases executed,0 production builds,0 canonical tests and no package
  rebuild.** All14 outcomes are NOT_EXECUTED in `TERMINAL.json`. Canonical
  pass/fail/SKIP counts are absent, not a fabricated0/0/0 suite. The internal
  `fullGateLaunched:false` means the phase cohort had not begun; it does not deny
  that the authorized outer CLI invocation was actually consumed.
- The setup sentinel, final source/package/private sweeps and complete binding
  were not reached. Historical whole-suite scores and all previous failed or
  accepted scoped cohorts remain unchanged.

## Concrete route failure

```
Error: spawnSync git EPERM
  .../support/tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs:22:22
  .../launcher-v3/execute.mjs:73:44
```

The staged helper is5589 bytes, SHA256
`60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db`, matching
the fixed profile support binding. It receives `environment`, but line22 calls
`execFileSync("git", ..., {cwd: repository})` without passing that environment.
The full runner constructs and verifies a finite PATH/GIT_EXEC_PATH as a local
object; this direct helper call consequently uses inherited `process.env`, not
that object. The helper's `privateGit` at lines10–11 similarly reads process.env,
but this later path was **not reached**. No helper/source drift was found.

This explains an untested full-setup boundary rather than a product command
failure or an A10 replay failure. A10's admitted child receives the finite
environment; it does not exercise this direct full prerequisite call. The bare
Git EPERM is consistent with the blocked `/usr/bin/git` selector route, but no
absolute target receipt exists for the failed exec: do not claim that specific
resolved executable was dynamically observed. No fallback/permission widening or
second attempt was used.

Possible next author scope, **not implemented or authorized by this result**:
propagate the already verified finite routing into the dedicated worker context
used by implicit helper subprocesses, including the later privateState path;
retain all selector denials and frozen product/helper bytes. A separately
versioned driver patch needs direct full-prerequisite-route and inherited/empty-
environment controls, different review, rebound packet and fresh root release.
This handoff does not choose or implement that repair.

## Cleanup, private scope and preserved artifacts

The worker closed naturally with process-clean:true, no signals, no timeout or
output overflow and zero observed survivors. The observer's owned groups also
had zero survivors. **Aggregate fence-clean and phase-protocol-clean are false**
because none of the13 expected phase processes ran. Do not translate natural
worker reaping into completed gate cleanup or a hard kernel-drain guarantee.

Private SafeJS reached only the264-file metadata would-copy check, with zero
instruction entries. The error precedes privateState, private-before/after
capture, engine body copy and guest execution; the engine-copy directory is
absent. Thus there is no actual-engine pass or private pre/post identity proof
from this attempt, and no private write performed by its reached code.

Retained exact roots (not another materialization):

- Inner output: `/private/tmp/full-gate-unified76-f5-fe15-finalroutes-20260828-r1`.
- Outer receipt: `/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/unified76-supervisor-lAnYPa`.
- Owned work: `/private/tmp/unified76-os-write-c6k6am`.
- Execution tree: `/private/tmp/unified76-os-write-c6k6am/tmp/unified76-execution-fPdjwB`.

`RAW-INDEX.json` authenticates seven original output/receipt files,19,036,819 raw
bytes, streamed into lossless `raw-v1/*.gz` with source pre/post identities and
decompressed hash verification. No full source archive or instruction body was
copied into this evidence. `TERMINAL.json` records exact14 unreached phases,
failure, private limitations, process closure and roots. The six expected
instruction paths are absent; all38 shipping files remain byte-identical. These
bounded terminal checks do not substitute for unreached full final sweeps.
No foreign process was signaled, index staged, production file repaired, global
typecheck run or current200 inventory injected into fixed192.
