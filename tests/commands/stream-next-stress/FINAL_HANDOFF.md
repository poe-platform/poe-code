# Independent five-command source checkpoint

Final committed product source: `72f780d0dbe73f71702c89c33d29aa614170c403`.
Root verified both original authors and both fresh fixers CLOSED before this
replay. The final source snapshot hash is
`6e9b9be3dbd1f46da98afaca4f26103a842aff8e8d85dfcf68aa3b1aa59d53e3`.
Final isolated execution ran from `2026-08-27T06:30:28.583Z` through
`2026-08-27T06:30:30.993Z`, on Node 22.22.2, TypeScript 5.9.3, Node types 22.20.1.

## Results and denominators

| Measurement | Initial committed source | Final committed source |
| --- | --- | --- |
| MemoryFS frozen 82 inputs, strict | 61/82 | 62/82 |
| Explicit-root RealFS same 82, strict | 61/82 | 62/82 |
| Combined exact strict executions | 122/164 | 124/164 |
| Original weak selected classifier | 164/164 | 164/164 |
| Authorized diagnostic-meaning-v2 | 162/164 | 164/164 |
| Frozen workflows, three per adapter | 6/6 | 6/6 |
| Contract groups, corrected helper | 16/16 | 16/16 |
| Dedicated Node test groups | 18/18 corrected | 18/18 |
| Separate dangling-output regression | 0/2 | 2/2 strict |

The 82 distinct inputs were frozen before author-source exposure. Their 153
native controls comprise 71 GNU9.7-on-Darwin and 82 Apple controls, not 153
distinct inputs. Native repeat capture matched exactly. The same source
executions also yield separate Apple-secondary observations: 52/142 strict,
66/142 weak selected; these are not additional command executions or GNU passes.
The three native workflows mix GNU coreutils with Apple rev. There is no
util-linux rev or GNU/Linux runtime proof.

All final primary stdout, status and namespace/file-byte effects match. The
remaining **40 exact stderr discrepancies across 20 distinct inputs** remain
strict failures, not full native parity. The stronger named category/operand
profile passes all 164 executions, with 25/25 native-negative self-checks and
68/68 synthetic wrong-error/generic-text/wrong-operand mutation rejections.
Those mutations add no native/product input coverage. Exact profiles and raw
bytes remain in `evidence/final/results.json` and `diagnostic-meaning-v2.json`.

## Findings and preserved corrections

- Stable dangling output symlink: initial split refused an existing symlink
  with a missing target. The separately frozen, root-disclosed regression now
  matches GNU and Apple on both adapters: target `ab`, next segment `c`, original
  symlink and input preserved. Fresh split-owner source fix, not reviewer code.
- Invalid seq format: initial stderr omitted `%f %f`; the root-authorized
  stronger profile exposed that omission. Fresh seq-owner fix now matches the
  pinned GNU diagnostic exactly. Original failures remain in the initial evidence.
- Verifier TypeScript optional-key annotation fault: initial preexecution
  compiler failure is retained. A narrow `Actual` annotation fixed it without
  casts, disabled checks, changed expectations or production changes.
- Verifier optional `compareEntry` assumption: original 15/16 contract result
  retained. The failed RealFS subcase never dispatched its command; earlier
  MemoryFS subcases did. Root-authorized helper v2 uses optional comparison or
  actual complete scoped stat identities. Unknown stays a failed capability
  assertion; no pathname-derived identity or invented numeric inode values.
- Harness filename changed byte-for-byte (`6fa5b5e445500e0ab29be962e9c5ac39a7e2e830fc736fd344e0580778c0f3ae`)
  from `independent.test.ts` to `independent.review.ts`. Original global discovery
  changed; the dedicated mandatory command below is not replaced by a skip/pass.
  Root typechecking still includes this `.ts` file. Current scoped noEmit passes.

Full snapshot hashes disclose another change between the two immutable product
commits: regex-execution client/README changed alongside split output/README and
seq source. This is not a claim that only two files changed in the entire tree.
The reviewer edited no production, root export, package, FS, regex, default
registry, canonical full-gate, root README or ledger paths.

## Mandatory reproducible verification

From the repository root, with the already installed pinned native references,
Node >=22 and local TS development tooling:

```sh
node tests/commands/stream-next-stress/run-source.mjs \
  --release-file tests/commands/stream-next-stress/evidence/final/release.json \
  --source-commit 72f780d0dbe73f71702c89c33d29aa614170c403 \
  --verify-release
```

This exact command completed with exit 0. It needs **no preexisting `/tmp`
coordination marker**: source commit, accepted APIs, source hashes, ancestor
requirements and root authorizations are in the committed release artifact.
It checks frozen input hashes, pinned native binaries, Darwin/macOS/locale
profile, committed source ancestry/hashes, then typechecks and builds isolated
emitted JavaScript. It runs all 82 inputs on both adapters, three workflows on
both, 16 contract groups, diagnostic-v2/mutations, and the unchanged supplementary
dangling regression. Any source/strong-profile/regression failure returns
nonzero. Missing/changed reference or profile setup fails clearly before product
execution rather than skipping. Native binaries are neither installed nor built.
Raw files are written to uniquely named ignored `.private` directories; stdout
reports the run path. There is no TSX/source fallback or root `dist` emission.

Scoped current typechecking is also reproducible with:

```sh
node_modules/.bin/tsc -p tests/commands/stream-next-stress/tsconfig.scoped.json
```

**Root/Plato additive wiring request:** retain ordinary project tests/typecheck,
and add the exact mandatory release command above as a separate release job.
The global `*.test.ts` runtime glob no longer discovers this guarded immutable
harness. Until root wires that command, ordinary global tests alone do not cover
this independent release suite. No root configuration was changed here.

## Scope and limits

Actual default factory and initialized default registry stay **60** before and
after; all five names return command-not-found without opt-in. Actual source
plugin imports are `src/commands/stream-format/index.ts` and
`src/commands/split/index.ts`, exposing the accepted create/plugin factories.
There is no root/package-subpath or default-65 integration proof.

MemoryFS and explicitly rooted RealFS only were independently exercised. No
remote-provider deployment, remote capability/performance, hostile external race,
lease, rollback or universal namespace guarantee is established. Historical old
stream diagnostic cohorts and Plato's `e36dab2` full gate remain untouched.
This is a bounded source checkpoint, not a current whole-project gate,
just-bash superiority, product completion, or 72-hour work claim.

All owned subprocesses finished normally. Unique private native/build scratch
is retained for reproducibility, not cleaned through broad filesystem actions.
Original and corrected profiles, helper faults, raw logs, immutable source and
compiler/runtime/dependency hashes remain in `evidence/initial` and
`evidence/final`; frozen inputs were not rewritten to chase implementations.
