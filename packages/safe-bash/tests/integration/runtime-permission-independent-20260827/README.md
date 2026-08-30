# Independent permission repair review — bounded blocker

## Verdict and root routing

**The permission admission/denial repair works in the tested scope, but do not
treat the Node24 consumer replay as ready: its TAP-count parser has a separate
runtime-profile blocker.** Reviewed external verifier revision
`774644f9ea39b41f824db4c829e7a97e6e1386be`; product/package remains frozen
`8670ebe8f0d39966c2de2638780437398e5f8490`.

- Unchanged author replay: **26/26** (its 23 executable/three source-policy controls).
- Independent cohort: **29/30**. The sole failure is the Node24 default reporter
  mismatch, not a failed permission fence or a startup option mistaken for denial.
- Separate reporter repair feasibility neighbors: **2/2** actual bodies, one per
  installed runtime, with read/write fences retained. No source fix was applied.
- Full 16 runtime groups, aggregate release and whole gate were **not executed**.
  No formerly blocked body/group is promoted to passing based on these controls.

### Concrete additional blocker

`scripts/verify-current-consumers.mjs:117` launches node:test-based consumers
without choosing a reporter. Lines 121–126 require `# tests ...`/`# pass ...` TAP
summary lines and exact nonzero assertion counts.

Using the actual admitted Node24.11.1 binary and unchanged permission arguments,
this complete bounded program runs successfully:

```js
import { test } from 'node:test';
test('real-body', () => {});
```

But the captured output is `✔ real-body ...`, followed by `ℹ tests 1`,
`ℹ pass 1`, etc., not `# tests 1`. The current parser therefore yields NaN and
fails its count check even though the body ran. Node22.22.2 emits matching TAP in
the same control. This is a second compatibility issue exposed after fixing the
earlier `--experimental-permission` startup9; no full group run is needed to
demonstrate the parser mismatch.

Route a narrow follow-up to **Curie, `scripts/verify-current-consumers.mjs`**:
select an explicit compatible TAP reporter for the node:test consumers before
launch, preserving existing exact test-count/zero-skip/error requirements and
all permission flags. Do not count empty/spec/unrelated error output as success.
`reporter-neighbor.mjs` confirms `--test-reporter=tap` with the same permission,
worker and strict-unhandled flags yields exact 1/1 bodies on both binaries while
still denying source reads and writes. These are feasibility probes, not an
implemented or independently accepted follow-up patch.

## What the permission review actually establishes

Both actual installed Darwin arm64 executables select stable `--permission` and
pass positive/negative permission probes:

| Runtime | Binary SHA256 |
| --- | --- |
| Node22.22.2 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Node24.11.1 | `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0` |

The independently executed moved package uses public Shell/agentCommands and
MemoryFileSystem: exact70 registered commands, actual grep worker pipeline,
VFS write/read, source-read denial, host-write denial, and an actual allowed
Worker round trip. Each uncaught read/write/source-import denial separately
requires status1, `ERR_ACCESS_DENIED`, the correct permission kind and exact
resource path. Unknown flag status9 is explicitly rejected as denial.

Removing permissions and widening the read grant are behavioral mutants: both
execute and fail the required forbidden-source assertion on both profiles.
An actual copied Node binary qualifies by content/behavior; changing its bytes
after admission or deleting it makes per-launch binding refuse78. The installed
binaries are never modified. Invalid admissions and wildcard grants also refuse.

The actual `currentConsumers` function was invoked in a bounded child with a
controlled no-mode executable selected through its host `process.execPath` input.
It refuses78 before any build step or the planted harmless build marker executes.
That is an executable ordering control, not an untrusted-host confinement claim.
Aggregate/public CLI catch propagation is additionally source-checked; those full
release entrypoints were not run. Experimental fallback is not positively
qualified on an older native runtime by this review.

## Frozen product versus external tooling

The author source is staged from Git, never imported from mutable live helpers.
The independent consumer verifier is external to the frozen product tree. Its
**only** transformation replaces five relative helper imports with authenticated
file URLs to the **8670** helper graph (including original consumer mappings,
runtime coverage and snapshot/finish). The source hash and full import map are in
`attempt-2/RESULT.json`; reversing the map recovers the reviewed verifier exactly.
No product source, config, consumer inventory or package file is overlaid.

The retained package tarball has SHA256
`96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1`.
Its package.json is byte-equal to Git8670. More importantly, its entire moved
`dist` inventory is independently **byte-equal to a fresh 8670 production build**
using 314 authenticated tools. `FRESH-DIST.json` records that inventory; its JSON
digest is `1d1899870b37b51824f7d23c7c5e11255418f4555679373e62d33409de566252`.
No full consumer compilation/group execution is inferred from that build.

Package inventories before/after detect new files/directories as well as changed
bytes. Staged helper checks cover the enumerated files only; they are **not** an
append-proof audit of all scratch. The final evidence seal checks exact files
and directories, including newly added entries. Both installed binary hashes and
the original tarball are checked again afterward. All owned children closed and
temporary trees were removed. No private checkout access, install or network
service was used by the tests.

## Primary-source qualification and retained attempts

The exact-version official permission documentation was read independently:

```text
https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/permissions.md
https://nodejs.org/download/release/v24.11.1/docs/api/permissions.html
```

Both document stable permission mode as a restriction for trusted code, not a
malicious-code sandbox. Actual execution here, not version guessing, establishes
the selected flag and tested fences. This does not establish race-free binary
leases, arbitrary worker/host confinement or support for every Node >=22 build.
The product minimum is not raised.

`attempt-1` preserves a reviewer setup error: the unchanged author runner requires
a lexical `/tmp/` output prefix, while the reviewer supplied its canonical
`/private/tmp/` spelling. No controls ran. Its exact runner and child rejection
remain captured. `attempt-2` corrects only that argument spelling and retains the
real reporter failure; its interval is
`2026-08-27T15:58:41.198Z`–`2026-08-27T15:58:53.461Z`.

Replay only this bounded review with unique outputs:

```sh
node tests/integration/runtime-permission-independent-20260827/run.mjs /tmp/UNIQUE-permission-review
node tests/integration/runtime-permission-independent-20260827/reporter-neighbor.mjs /tmp/UNIQUE-reporter-neighbor.json
node tests/integration/runtime-permission-independent-20260827/verify.mjs
```

The review runner intentionally remains exit1 for the retained real reporter
failure. The static evidence verifier is not a fresh execution or release pass.
