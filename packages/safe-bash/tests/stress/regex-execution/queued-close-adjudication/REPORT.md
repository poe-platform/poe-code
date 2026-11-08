# Queued-close adjudication — bounded, nonblocking

## Decision

**The retained line123 failure is an obsolete expectation that a CLOSED queued
session acquires a second Worker, not evidence of a registration source bug.**
The exact unchanged test passes before registration and fails at the same
assertion on both the registration commit and frozen current bytes: actual1,
expected2. No production or canonical edit is made; the exact test-only proposal
is in `PROPOSED-TEST-DELTA.md`. Independent review remains separate.

The complete canonical file and relevant old/current executor/session contracts
were inspected. Before registration, session.close memoizes a promise but waits
for queued requests without cancelling them. Registration adds a private close
signal, closes new run admission synchronously, cancels its queued work and drains
owned retirement. The approved contract requires closing acquisition admission,
covering admitted cooperative work and respecting sibling ownership; it does not
require a closed queued request to acquire another Worker or succeed. This finding does not certify
the outer runtime or infer runtime readiness from repository commits.

## Freeze

Actual execution: August27,2026 08:02:59–08:03:00 UTC; scoped typecheck
08:04:11–08:04:12 UTC. Node22.22.2, tsx4.23.12, TypeScript5.9.3, Darwin arm64.
The initial inspected HEAD was `90c1a3cb04a6a01e456544cbac747b327a8dfb1d`;
concurrent unrelated commits advanced HEAD before the recorded freeze.

- Before: registration parent `19669450a3acf869b8885b091db59e0a6e9cb65f`.
- Registration: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Independent review: `0b370e33cdb42128c6585cbebd1f6bad02753285`.
- Approved contract: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- Frozen current HEAD: `71515770018077c1ae511f41f49e3a39c615cce5`.

SHA256 identities (full Git blob identities and all five profiles in
`evidence/freeze.json`; current relevant inputs match their recorded HEAD):

| Input | SHA256 |
| --- | --- |
| Before client.ts | `6745088269d2c9be612cbb55e612fb73d960d1b0df6c02d91e1b8f431f2ef1b9` |
| Registration/review/current client.ts | `1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca` |
| All profiles canonical messageerror.test.ts | `29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214` |
| All profiles protocol.ts | `0b4f9fac518cd31f403c1c0f49e4c7772f783e32df7cfe83ee5d4906426133e6` |
| All profiles command.ts | `9c2f8ecf50def7250b01152a31a45c449109c3ae4d30878252cffe985c6e9df8` |
| All profiles command.md | `8a5426b1e7a30a03dc62f74b28c6eb7bf9b008b78cb7b521eb7de0bc5c59a3f8` |

Only exact canonical/client/protocol/package bytes are materialized in disposable
owned snapshots. Type imports erase; native worker code is never loaded. No
build, dependency installation, public consumer run or Shell command execution occurs.
The working tree has unrelated untracked work; this is a relevant-input freeze,
not a claim that the entire tree is clean. Original reports/TAP/public-five
evidence identities are frozen and unchanged.

## Reproduction and controls

Commands run from the repository root:

```sh
node --unhandled-rejections=strict tests/stress/regex-execution/queued-close-adjudication/run.mjs
node --unhandled-rejections=strict tests/stress/regex-execution/queued-close-adjudication/check.mjs
```

`run.mjs` selects ONLY the exact idle test name with Node's anchored
`--test-name-pattern`, `--import tsx`, test isolation disabled and concurrency1.
Disabling isolation avoids a grandchild test runner. Each exact child has a
10-second kill watchdog, 64-KiB output cap and strict unhandled rejections. The
11 owned fake-transport controls execute separately. `check.mjs` uses local tsc
with strict NodeNext/noEmit on only the owned test and its transitive imports.
Full expanded argv and raw output are retained in each evidence JSON. Evidence
uses exclusive creation; never overwrite it to replay. Use a separate approved
owned evidence destination for any later replay, preserving these files.

| Run | Actual result |
| --- | --- |
| Exact canonical, before | 1/1 pass; child exit0 |
| Exact canonical, registration | 0/1; line123 ERR_ASSERTION, 1 !== 2; child exit1 |
| Exact canonical, current | 0/1; identical failure; child exit1 |
| New bounded controls, current | 11/11 pass; 11 fake Workers retire once; child exit0 |
| Owned scoped typecheck | pass; child exit0 |

The 11 controls distinguish:

- Closed queued owner: no second Worker, rejection is `RegexExecutionError`,
  code `CLOSED`, message `regex CLOSED: invocation is closed`. Two requests of
  that owner receive the identical close-error object. Concurrent/repeated close
  returns the same promise; close stays pending until that exact gated idle
  retirement completes. Late run throws before and after completion.
- OPEN queued owner: a replacement does appear, but only after the failed idle
  Worker's exact retirement. The replacement completes a real protocol reply.
- Active sibling: closing queued ownership neither terminates nor waits for the
  sibling's active lease; the sibling completes and reuses the same Worker.
- Startup/active messageerror: duplicate notifications retire once; code
  `PROTOCOL`, message `regex PROTOCOL: worker message could not be deserialized`.
  A caller abort AFTER the internal request selected PROTOCOL does not replace
  that already-selected error. Close still awaits exact retirement.
- Prior caller abort: the identical errno-shaped Error, false,0,empty-string,null
  survives subsequent messageerror/close and late run admission. This is strict
  identity, not truthy/falsy fallback. Public settlement precedence belongs to
  the separate runtime contract; these direct session controls do not test it.
- Empty-owner synchronous cleanup: shared cleanup promise, no executor.open,
  and a later acquisition attempt rejects CLOSED before any Worker is created.

**Status is not applicable to these direct session rejections.** CLOSED/PROTOCOL
have no exitCode (CLOSED also checked for no status). Canonical child exit1 is
the assertion failure status, not grep/rg status; fake terminate() returning1
is not a utility status. Idle messageerror has no active request to reject with
PROTOCOL: that event retires the idle slot; closing the second owner supplies
its separate CLOSED request rejection. Protocol Error identity is not the
transport event Error identity; prior caller reasons are preserved unchanged.

## Limits and cleanup

The original **99/100**, original **five public cleanup failures (0/5)** and
**110/111** native-fixture profile remain unchanged, unrerun and unresolved as
historical profiles. These three targeted canonical runs are not a new100 gate;
11 new controls do not alter any old denominator. Runtime remains awaiting the
USER-relayed frozen handoff. No runtime acceptance, public cleanup closure,
superiority or duration claim. No risky regex probes, opaque I/O work, native
Workers, broad suites, production/canonical/root edits or dependencies.

All five direct child processes exited naturally, were awaited through close
(or synchronous reaping for tsc), and their exact PIDs were absent afterward;
no watchdog kill or forced cleanup. All11 fake Workers retired once with zero
remaining tracked worker/caller abort listeners. Exact owned temporary snapshots
were removed. Freeze/finish confirm relevant source/test/contract and historical
evidence bytes unchanged; the foreign index was unchanged during execution.
Only explicitly owned new files outside `review/` are staged/committed.
