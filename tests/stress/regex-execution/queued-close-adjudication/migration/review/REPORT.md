# Independent fixture-only migration verification

## Decision and exact scope

The canonical fixture in `10273352f8d65d929cbf5a23e69119414dacee60` agrees
byte-for-byte with the approved proposal at
`6dbd7d06f9c1901602b415773bb33ba1522a1c6e`, reviewed at
`c6bcfe0d7734be0207d67b28a0ece0f12ed8becb`.
That commit changes exactly one file: the canonical `messageerror.test.ts`.
Independent reconstruction replaces only the prescribed CLOSED-queue assertion
block and inserts the exact separate OPEN-queue test. All remaining bytes,
including startup/active/precedence/native tests, duplicate-messageerror checks,
prompt retirement, `clean` and existing `finally` cleanup, are unchanged.

| Frozen object | SHA256 |
| --- | --- |
| Proposal | `ff5d5e3e639b3f5f375920ec85168ce8dbeca7d9000da48a3b531a613aa4962a` |
| Canonical prechange at 6dbd7d0 and registration | `29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214` |
| Reconstructed and committed canonical fixture | `1be27d16a8487dae108d0d80de2a6e443d1f6da0a0913461ebea768a8448a5c3` |

`agreement.json` records the immutable parent, changed paths and equality checks;
`canonical.diff` retains the actual commit diff, not a proposed substitute.

## Independent execution

- **Canonical: 2/2 selected tests passed**, using the exact committed fixture
  copied into an owned snapshot, with an anchored two-name filter. No other
  canonical test body ran.
- **Prior independent replay: 6/6 groups, 8/8 variants passed**, with eight fake
  transports, zero native Workers and zero remaining tracked fake Workers or
  caller/combined-signal/transport-event listeners. These overlapping checks are
  not summed with canonical or author controls as distinct behaviors.
- The prior `review/probe.mjs` body is unchanged: SHA256
  `810f38bf5ab42f9731ddf12f36781e825892fa77b6cf99b66e7d2d61f269107b`.
  Existing compiled client/protocol bytes were copied into a NEW owned output
  destination, checked against prior evidence and local TypeScript emission of
  immutable registration source `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
  No historical `evidence.json` was overwritten. `replay-identities.json` records
  exact source and compiled hashes.
- Node v22.22.2, TypeScript 5.9.3, Darwin arm64; local development tooling only.
  Both children used strict unhandled rejections, bounded output and an exact-PID
  watchdog. PIDs 64144 and 64146 exited 0, without signal, safety kill or IPC;
  both output streams closed and both PIDs were absent after reaping.

`canonical-two.json` and `independent-six.json` retain complete commands and TAP.
`finish.json` confirms all 30 frozen historical/source/control files retain
their hashes, the canonical file is unchanged after execution, and the exact
owned scratch directory was removed. Historical compiled harness inputs were
read/copied, never rewritten.

## Author evidence

The readiness note was absent after a 60.047-second bounded wait and at the
subsequent partial-evidence inspection. `author-inspection.json` freezes that
checkpoint. The available original-fixture copy and author fixture record agree
with the independently reconstructed hashes and fixture-only commit. The author
discloses an initial git-output buffer failure and a later full-index comparison
failure caused by concurrent WebDAV commits; neither is reported as a test pass.
The final author **historical 100+1** cohort and **11-control** replay evidence was
not ready for review. Their outcomes remain unverified here; no broad cohort was
duplicated and no indefinite wait or scope expansion followed.

## Limits and failures

No behavioral test failed in this review. An initial reviewer-runner setup
attempt resolved the repository root one directory too high and failed its
first read-only `git show`, before writing freeze evidence or spawning tests.
The owned runner path was corrected; subsequent freeze and both test runs passed.

Original **99/100** and targeted **before 1/1 versus after 0/1** remain distinct
historical observations, not rewritten green results. There is no claim that
**110/111** is fixed, no full-suite or original/public-five rerun, and no default,
public or runtime acceptance. The six risky probes remain unused.
Runtime source acceptance still awaits explicit root/user frozen Sagan handoff;
neither this canonical fixture commit nor matching live source hashes supplies it.
Only new artifacts under `migration/review/` are authored by this verifier.
