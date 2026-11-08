# H11.2 supervisor repair — author handoff

2026-08-28. Review-ready, not independently accepted and not a gate release.
Original independent `aea23327` remains **38 PASS / 0 FAIL / 2 UNEXECUTED**.
Mapping `77f80adc` identified an inherited supervisor failure, not an e35
regression or an observed real survivor. Original consumed attempts stay 0/14.

## Exact bindings and write scope

- Preseal: `0f41d342`; source: `f03c260269dfd8ee10666f7fd2560655f8e14a38`.
- Harness-only typed-tool correction: `63aae753af1ce5d8fa26160b596d6203e264e970`,
  after preserved capture and pre-execution amendment `b7da0ec2`.
- Supervisor SHA256:
  `3e624d9dd62d30a134540078a0ee3df4b8fdbd16d3f817c75f9583ba60dbcd08`.
- Normalized DRIVER SHA256:
  `aca88337d644351888659e4364f0610da0219eb3697de45fa808b509bfbc3424`.
- Effective historical-eligibility profile SHA256, unchanged:
  `fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510`.
- Fixed product: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; expected package:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  Neither was materialized, built or executed for these controls.

`SOURCE-CANDIDATE.json` authenticates all 41 shipping bindings to source-commit
Git blobs, modes, lengths and hashes. Among the 40 runtime bindings, only
`launcher-v3/supervise.mjs` changes from e35; the other 39 stay byte-identical.
`launcher-v3/DRIVER.json` is resealed separately. No product, frozen helper,
permission, profile, observer protocol, private-finally or other shipping file
changes. The old whole supervisor and DRIVER are retained as inert test inputs.

## Repair and receipt semantics

Observation faults after child creation are recorded and wake supervision;
they cannot bypass mandatory known-owned-child teardown. Cleanup retains its
watchdog/listener ownership while teardown and capture completion are attempted.
The bounded 5000ms cleanup window includes observations with a reduced remaining
timeout. Only the owned direct ChildProcess handle or freshly observed matching
descendant identities are targeted; stale or foreign identities are not guessed.

The receipt records ordered typed `faults`, `faultCount` and `faultsTruncated`
(first 256 retained). Non-enumerable `faultCauses` preserves raw in-process
references, including thrown null and undefined. JSON retains typed descriptors,
not cross-process object identity. Earlier faults survive later failures or a
recovered final observation. A failed capture/drain or terminal observation is
not clean merely because the child exits zero.

New explicit fields include `observability` (`FINAL_SNAPSHOT_OBSERVED` or
`UNKNOWN`), `survivorsKnown`, `teardownAttempted`, `cleanupAllowanceMs`,
`captureClosed` and per-capture closure records. Unknown final observation is
not converted into an authoritative empty survivor list. A nonclean receipt is
returned after post-spawn faults; pre-abort still throws its exact reason before
acquisition. These fields do not establish universal OS process-tree draining.

## Executed cohorts, kept separate

| Cohort | Actual result | Qualification |
| --- | --- | --- |
| v1 S01–S13 | 13/13 PASS | Complete shipping modules linked to synthetic dependencies; original faulty module is never run with a real child. |
| v1 actual-child admission | coordinator exit1, zero R cases | Harness counted Node's executable record and its MachO inspection record as duplicate executable identities. |
| v2 manifest-role controls | 1 positive + 4 negative PASS | Select exact `EXTERNAL.tools`; missing, duplicate, changed hash and linkage-only substitution refuse. |
| v2 R01–R03 | 3/3 PASS, coordinator exit0 | Three actual harmless owned Node children using the complete repaired module, with declared observation injection and independent outer teardown. |

The v1 report is preserved in `results-v1`, raw SHA256
`7cc5e7058a29f9c7424ec032b7a38c6ecb8ee24ecdeffac83cdd82162ebc3e99`.
The v2 mode authenticates and carries those 13 synthetic results; it does not
rerun them or relabel the original coordinator failure. No actual child was
retried. Both physical roots remain retained.

v2 ran from **12:37:31.548Z to 12:37:32.620Z** on August 28, 2026:

- R01 PID68152: natural exit0, exact 15-byte `owned-positive\n`, empty stderr,
  no signals/faults, both captures closed, final snapshot observed, clean=true.
- R02 PID68158: shipping owned-child SIGTERM delivered; close and both captures
  completed. First null then undefined observation faults remain ordered;
  observability=UNKNOWN and clean=false. The outer observer independently saw
  the tracked identity absent afterward. Outer rescue was unused.
- R03 PID68161: natural exit0, no signals, both captures closed; post-close
  observation errors remain recorded, observability=UNKNOWN and clean=false.

All three tracked child identities were absent at outer completion; no remaining
owned children. R02 is an intentional signal termination, not a natural exit.
The v2 raw report has 13,804 bytes, SHA256
`890b6695038a6ffd7caa89e9b8582794445dc286feecbbc9292665535252d688`.
`results-v2/SEAL.json` also preserves all six stdout/stderr capture hashes/bytes.
The report includes actual signals, exit/close, observation faults and outer
identity checks. Node and ps identities were checked before and after use.

## Tool routes, commands and bounds

Only admitted Node24.11.1 and `/bin/ps` execute in the real controls:

- `/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
  `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
- `/bin/ps`, SHA256
  `1e46cdb824858eb32e4c85ca920ba31b4541a814a133980d8b3484f39942276c`,
  argv `-axo 'pid=,ppid=,pgid=,lstart=,command='`.

The recipe fixes each child program/environment, ps output/timeout, child
capture64KiB, total control capture2MiB, total run45s, child supervisor1500ms,
cleanup5000ms, outer rescue2s and outer close bound7s. Signals never target
unowned groups. Actual invocations, from the repository root:

```sh
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --experimental-vm-modules tests/integration/full-gate-20260827/unified76-driver/supervisor-fault-v1/controls.mjs /tmp/supervisor-fault-author-20260828-f03c2602-v1
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --experimental-vm-modules tests/integration/full-gate-20260827/unified76-driver/supervisor-fault-v1/controls.mjs /tmp/supervisor-fault-author-20260828-f03c2602-v2 --remaining-real-v2
```

These are historical execution records, not authorization to repeat either run.
The whole module is linked through `vm.SourceTextModule`; this is not source
extraction, a supervisor reimplementation, or shipping OS-fence acceptance.

## Remaining boundary and next action

Different Dirac review must assess the actual H11 repair and receipt/cleanup
boundaries before any release packet or fresh GO. Prior A10/protection proofs
are bound-only, not rerun. No actual native chmod, private engine copy/checkpoint,
setup, production build, package or gate phase ran. No failed gate root, frozen
case body or peer source was changed. Existing 632 canonical paths remain intact.

H06.3 is explicitly **SOURCEQUALIFIED / actual dual-private-error UNEXECUTED**:
`report.error` A and `report.privateGuardError` B are preserved if terminal save
succeeds. There is no durable-capture guarantee if save fails, and no real
private-behavior proof. Outer terminal persistence/observer failures are not
universally repaired by this narrowly scoped supervisor change. Historical
NA-2755/NA-6755 remain evidence-bound unsupported/unqualified, and the prospective
eligibility verdict stays nonzero while those obligations remain. Full gate HOLD.
