# Independent curl zero-host-cap review

## Verdict and boundary

Accepted for the scoped zero-count change at immutable candidate
`bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29`, not a whole-repository gate.
This independent verifier implemented and ran its own holdout without delegation
or reading author new tests. Initial contract freeze commit: `0123c83d`.
Production, existing tests/configuration, author evidence and historical S1
prototype material were not edited. No source defect found in this scope.

Candidate diff against parent `219790c55c0214e6d46524bbdced63c18c360f62` contains
only `limitsFor` in network shared.ts, network README, and the author's new test.
The validator changes only the exact two count minima to zero. Safe integers,
all other positive minima, timeout ceiling, defaults, merging, error text and
freezing remain. Curl executor/body/args/transport/types also match the frozen
pre-change baseline. Author test contents were not reviewed as an answer key.

## Independent results

| Cohort | Passed | Failed | Skipped | Meaning |
| --- | ---: | ---: | ---: | --- |
| Original baseline | 234 | 2 | 66 | Two independent stdout oracle mistakes, preserved |
| Qualified baseline | 236 | 0 | 66 | Zero constructors rejected; not zero execution proof |
| Exact candidate archive | 604 | 0 | 0 | Final `candidate-isolated/runtime.json` |
| Packed, installed, moved candidate | 604 | 0 | 0 | Final `candidate-isolated/moved-runtime.json` |
| Mutation controls | 7 detected | 0 missed | 0 | 14 deliberately failing executions |
| Current canonical node:test | 2 | 0 | 0 | Matrix plus mutation wrapper; not 604 node:test cases |

Each final matrix has **53 runtime profiles × direct/Shell × root/network
namespace = 212 executions**, plus **392 constructor validator checks**.
The packed matrix repeats those same inputs: 1,208 executions/checks across two
environments do not mean 1,208 distinct cases. Exact default-object equality and
freezing assertions also run but are not added to the tabulated denominator.
The marker's author-reported 138 new tests and 63 regressions are separate,
not independently rerun or counted as independent results here.

The original profile remains byte-identical. `BASELINE-CLARIFICATIONS.md` records
why stdout on positive retries accumulates earlier bodies and why exit-7
transport injection uses public CurlError rather than an arbitrary Error.
Original failures remain in `baseline-original/`; no diagnostic assertions or
zero expectations were relaxed. Earlier successful candidate captures remain
beside the final permission-restricted replay rather than being overwritten.

## What was exercised

- Counts 0/-0/1/default/MAX_SAFE and invalid values; other limit minima and timer
  ceiling. CLI huge values cannot raise zero or positive-one host ceilings.
- 307/308 with -L at zero returns 47 before next authorization/transport/upload.
  Positive-one and default-ten redirect controls still follow and enforce caps.
- 429/503 at zero preserve initial body/status and exit 0, or exit 22 under
  --fail/--fail-with-body with the appropriate body. Retry-After 600 cannot turn
  the initial result into a timeout. Positive-one/default-five controls retry.
- Synthetic binary VFS upload: opens, chunk reads, exact bytes, request counts
  and no zero-cap replay. Both-zero two-URL execution makes two initial requests.
  Redirect and retry caps do not improperly disable one another.
- Initial/redirect/retry authorization denial, per-hop provenance and attempts,
  cross-origin credential stripping, sentinel transport exit/message preservation,
  cooperative abort rejection identity, and exactly-once response disposal calls.
- Root and network-subpath public factories; real Shell.use(networkCommands()),
  status/exit/retry/redirect writeout, plus strict typed consumer execution.

Mutation variants reject zero construction, raise either zero to one, refuse
positive redirects/retries, ignore authorization, or omit disposal. All are
public host-option/response-wrapper mutations in the test harness; candidate
source and installed package bytes are never mutated. The two retry-to-one
negative executions intentionally time out at the positive 2-second host limit.

## Packaging and integrity

`verify.mjs` extracts exact Git inputs: all src plus package/package-lock and
TypeScript build configuration. It does not overlay live source or archive the
entire repository. An isolated build emits outside the immutable input tree;
npm pack/install run offline with scripts disabled. The installed consumer moves
before execution; original archive/build/tarball are deleted before moved replay.
Only virtual-bash is installed, with zero runtime dependencies and no src tree.

Moved runtime uses plain Node with filesystem reads restricted to the moved
consumer and writes restricted to its receipt. Both imports resolve inside the
installed package. No tsx, source fallback, external data, fetch, native network
transport or product subprocess is used. Ambient fetch/HTTP/socket/DNS and child
process entrypoints are trapped. Strict NodeNext compilation uses external
development TypeScript/@types/node only, with strict/noUncheckedIndexedAccess/
exactOptionalPropertyTypes/verbatimModuleSyntax and **without skipLibCheck**;
the emitted consumer then runs under the same filesystem restriction.

Final `candidate-isolated/receipt.json` records matching before/after full
namespace+content digests: archive 265 entries; installed package 776 entries.
Enumeration detects added entries, not merely changed originally-known files.
Marker and harness hashes also match before/after. SHA-256 anchors:

- Frozen profile: `8bc90dfe73daebb944f406c5a53f506879c3ff0db5e05b5c7fa919c6a860d67c`
- Candidate Git archive: `d522ed4b8fe8722e0bded68fd9f7c67ae3bc3612e4312d7c5c0c0338195ff9dc`
- Packed tarball: `f95992dc28da5578343b8984414ebbc5cf33b6fc8a8f6dda63cc9ca3321d2598`
- Immutable marker: `85dbbcbe8be177b9b27de29ee944577f04b3c4d6c7b03255adf00b4c9aa7620e`

## Reproduction and limits

Canonical tests never write captures:

```sh
node --import tsx --test tests/commands/network-zero-caps-review/holdout.test.ts
```

Explicit version-bound capture requires the immutable published marker at
`/tmp/curl-zero-caps-author-candidate.txt` and a new unused receipt directory:

```sh
node tests/commands/network-zero-caps-review/verify.mjs candidate bb7f5972dd54df3ae9c05e745bfab1f1c38a0e29 new-capture-name
```

Final isolated capture ran August 27, 2026, 16:31:27–16:31:38 UTC on Node
22.22.2 with TypeScript 5.9.3. `current-checks.json` separately records successful
live scoped tests/strict checking at HEAD `a3febbee84e2c1c871376a9d5d30baddb96dae68`,
16:31:53–16:31:59 UTC; its 223 source files matched before/after. Current live
results do not substitute for immutable candidate acceptance.

No Linux/native-curl parity, deployed-provider acceptance, superiority rescore,
full gate, 72-hour duration, or opaque host-work hard-preemption claim is made.
Disposal fixtures complete immediately; this does not certify arbitrary delayed
or uncooperative disposer settlement. All bounded children finished and owned
scratch was removed; no loopback servers were created. Unrelated concurrent
work remains untouched, so repository-global cleanliness is not claimed.
