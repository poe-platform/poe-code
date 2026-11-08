# Frozen whole-product gate, August 27, 2026

## Authorization and scope

Root explicitly handed off **e36dab2b6abc216ddc89e5786a0eba76f08a1722** after
preparation. The runner must use that commit, not mutable HEAD. Root reported
integration 3fb1405, expectation-only 81a0ab7, documentation 6db2395 and independent
packed e36dab2; those reports are not this review's acceptance evidence. Later
commits, dirty source, private engines and previously emitted dist are excluded.
Ownership is this new directory only. No product or author fixture changes.

Preparation commit **511a337** is not a full-gate result. The completed frozen run
is **failed: 15,769 pass, 110 fail, 79 skip**; see `REPORT.md` and immutable
`evidence/first/`. No broad compatibility or superiority claim is made.

## Canonical discovery and historical evidence

Static inspection of the handed-off commit finds **470 committed `.test.ts`
files**, including **13 contracts files**, among **7,932 regular tracked files**
(562,123,340 bytes). These are file counts, not executed test-instance counts.
All files are archived, including historical evidence. There are 801 nonmatching
`.ts`/`.mts`/`.mjs`/`.js` programs; their exact paths and hashes are in the discovery
manifest. They are not directly selected by the declared test glob. No matching
test under stress, review, or characterization directories is excluded.

| Gate | Exact command | Per-phase bound |
| --- | --- | --- |
| Global typing | `npm run typecheck` → `tsc --noEmit` | 180s |
| Production build | `npm run build` → `tsc -p tsconfig.build.json` | 180s |
| Whole canonical suite | `npm test` → `node --import tsx --test "tests/**/*.test.ts"` | 900s |
| Contracts subset | `npm run test:contracts` → `node --import tsx --test "tests/contracts/**/*.test.ts"` | 180s |
| Benchmark typing | `npm --prefix benchmarks run typecheck` → `tsc --noEmit -p tsconfig.json` | 180s |

Root typing includes `src/**/*.ts` and `tests/**/*.ts`: non-test TS helpers and
historical TS captures can still affect this gate. Build typing includes only
source. Benchmark typing includes benchmark TS except reports/node_modules.
The declared `npm run benchmark` is a separate comparative experiment, not the
canonical whole-product test command; this gate does not execute it or count
historical intentionally failing standalone `.mjs` probes as canonical tests.
Nonmatching helpers can execute transitively: examples include lifecycle child
probes and `tests/integration/s3-http-exports/verify.mjs`. Those remain intact.

Prior `96db59ac` evidence was a **dirty snapshot**, not a committed-HEAD result:
9,920 instances = 9,686 pass + 164 fail + 70 skip. Global/build typing passed;
benchmark typing failed at `benchmarks/shell-stress/diagnostic-profiles/run.ts:12:25`
(TS2345). Its failures and original logs remain untouched. The independent TAP
accountant replays that exact log; no 9,920 denominator is assumed for this run.

Preflight `98498c1` corrected an exact six-family union (49 versus aggregate52),
which blocked 79 adapter workflows. It instead requires the 22 executable commands
the workflows actually use; `matrix.test.ts` and behavioral expectations were
unchanged. The root integration test, not that preflight, owns aggregate inventory.
We do not reintroduce a brittle old52/56 inventory or waive any adapter workflows.

## Isolation and provenance

`run.mjs` requires `--handoff FULL40HEX --execute NEW_OUTPUT`; it has no HEAD default.
It archives the exact commit, validates every extracted regular file against its
Git blob, then records SHA-256 and mode. Every tracked file is rechecked after each
phase. A tracked-input mutation halts later gates instead of testing dirty inputs.

Canonical `tests/shell-stress/expanded-kernel/replay.test.ts` reads a historical
Git blob. The S3 packed-export test archives HEAD itself. `history.mjs` therefore
copies only reachable Git objects into independent detached metadata beside the
archive: no remote, alternates, shared index, private worktree or later refs. A toy
selftest proves ancestors available and a later commit unavailable. This is not
a pointer back to live source. Historical noncanonical scripts are not executed
merely because their objects are present.

Installed root and benchmark development dependencies are copied to regular
files; every file is hashed, package versions checked against committed locks,
and missing optional platforms recorded. `.bin` symlinks become regular wrappers
preserving their exact installed targets, not newly selected manifest entries.
No install/download or runtime dependency is added. Existing just-bash must be
3.4.2. Node, npm, native binary, source, harness and dependency hashes are recorded.
Files and bin wrappers are checked again after all phases. This records installed
tool bytes; it is not a new independent registry-integrity attestation.

The resolve hook rejects live/outside module fallback and records resolved paths
with hashes; it does not claim every resolved module executed. The hook is
resolve-only to preserve TSX CommonJS behavior and native TAP. Some unchanged
canonical child harnesses deliberately replace their environment; their own
snapshot/packed-import checks remain authoritative, not an invented universal
hook-coverage claim. The existing S3 child harness links only copied development
dependencies inside the owned temporary tree, not live product/private source.

All phases use detached owned children with output/time bounds. The supervisor
samples PID ancestry/birth identity, signals only observed owned processes,
records cleanup and survivors, and treats required forced cleanup as non-clean.
It samples owned TCP listeners for loopback addresses; this observation is not
an OS network sandbox or proof of every short-lived connection. Static inspected
TCP fixtures bind 127.0.0.1; one real-FS fixture uses an owned Unix socket. Only
owned execution trees are removed. Native tests retain their own narrower bounds.

## Profiles, skips and acceptance accounting

The outer environment is Darwin/arm64, Node22.22.2, C locale, UTC, sanitized HOME
and temp/cache directories. Fixtures retain explicit UTF-8 overrides. `/bin/bash`
remains Apple Bash3.2. Separately pinned GNU Bash5.3 is recorded, not substituted
as a portable oracle (expected binary SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`).
Installed rg is copied into the owned native PATH with its hash. No ambient AWS
credentials, optional live-oracle variables, private engine variable or arbitrary
user PATH extensions are forwarded. Native absence/profile skips remain explicit.

`SAFEJS_LOCAL_ROOT` stays unset. Previously reported 62 unavailable-engine skips
are not acceptance; actual-engine independent acceptance **ef1699b** stays separate.
Live stream/GNU-table/bytes controls gated by `STREAM_NATIVE_LIVE`, `GNU_TABLE_BIN`,
`BYTE_GNU_GZIP` and `BYTE_GNU_COREUTILS_DIR` stay unset in the default profile; their
always-runnable frozen vectors remain selected. Final actual skip reasons, not
this historical estimate, determine the reported denominator.

TAP accounting retains every failure/skip/TODO/cancellation with its diagnostics
and reconciles against Node's footer. Truncated output cannot pass. Explicit
upstream SafeJS limitations, Rust regex differences and adapter POLICY
characterizations are listed separately from feature acceptance; ordinary passing
safety guards are not automatically defect characterizations. Manual final
classification will retain fixture/profile differences rather than rewrite them.

## Packed public gate

After a successful fresh build only, offline `npm pack` and offline tarball
installation create a separate consumer with no product source. All declared
literal exports plus expanded contracts wildcard imports must resolve beneath
installed dist. The runner checks zero runtime dependencies, **60 unique callable
default commands**, new tac/expand/fold/strings, optional curl/SafeJS absent, root
and stream-inspection subpath factory identity, and four actual public pipelines.
A strict declaration consumer covers `AgentCommandsOptions.streamInspection`
and root/subpath APIs. These are bounded public checks, not complete tool parity.
Pack, build/import hashes, full command names and exact workflow results are kept.

## Preparation checks and execution

Preparation selftests: initial **7/8** exposed a harness load-hook/TSX conflict;
resolve-only correction gave unchanged **8/8**. Three added quota/loopback/history
controls give **11/11**, zero skips. The original failure and both later logs are
preserved under `evidence/prep/`; they are not product acceptance results.

```sh
node --test tests/integration/full-gate-20260827/selftest.mjs
node tests/integration/full-gate-20260827/run.mjs \
  --handoff e36dab2b6abc216ddc89e5786a0eba76f08a1722 \
  --execute /tmp/full-gate-e36dab2-NEW
```

The second command is now authorized by the explicit root handoff. It must use a
new capture directory. `declaredGateCommandsSucceeded` is a narrow command-status
field, not a claim that skipped or characterized behavior is implemented.
