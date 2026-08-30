# Column current-contract sidecar: scoped evidence, not integration acceptance

Candidate: **`3af3f62890c528bd40da56514e4b08f44b2e6cf0`**. No product,
shared-input, alias, root/export, package, historical fixture, or expectation edits.
Padding author `a809635432f18a235b8fb622a05367bedc54b315` is an ancestor.
Root diagnosis `28f13113` supplies the contract distinction, not an old universal
external-retirement requirement. Root exports/defaults remain **Curie HOLD**;
these results neither accept the shared fix globally nor authorize integration.

## Separate counts

| Cohort | Historical handoff | This exact candidate, final capture |
| --- | --- | --- |
| Original 40 recipe identities | 37 pass, 3 fail | **39 pass, 1 fail** |
| Original recipe-associated variants | 81 pass, 3 fail / 84 | **83 pass, 1 fail / 84** |
| Supplemental variants | 4/4 | **4/4** |
| Combined legacy variants | 85 pass, 3 fail / 88 | **87 pass, 1 fail / 88** |
| Unchanged hidden external-return repro | exit 1 / HOLD | **exit 1 / HOLD** |
| New current-contract corpus, built source | Not applicable | **12/12** |
| Same new corpus, physically moved package | Not applicable | **12/12** |
| Six-file scoped strict runtime suite | Different historical scope | **73/73**, no skip/cancel/TODO |
| Detector mutations | Not applicable | **4/4 detected**, each child exit 1 |

These cohorts overlap; do not add denominators. The old 37/40 and old stronger
S38 failure remain untouched historical failures, not renamed passes. The new
legacy run also literally fails S38. Only N01/N03 evolve to pass, with their
original inputs and expected bytes unchanged, following deliberate padding
evolution. No native binary or new native capture was needed: the original
captured observations and unchanged canonical `stress.mjs`/`safety.mjs` were
replayed read-only. This does not duplicate the other verifier's padding corpus.

## New fixture, explicit existing ownership

`probe.mjs` contains twelve independently authored cases:

- C01: raw return requested once; normal column exec stays pending until release,
  then returns exit 1, empty stdout, and exact input-limit diagnostic.
- C02/C03: raw return rejection preserves the exact Error through column and one
  public `createStandardCommands()` ordinary-grep control. Not whole-alias proof.
- C04/C05: disposal/caller abort interrupts an **unregistered** raw return wait.
  Both public settlement promises are actually awaited before gate release, under
  a failing deadline. Return is requested once; retirement is observed still
  pending; controlled late rejection yields no unhandled event. Caller identity
  is exact; disposal reports `Error: Shell is disposed` on exec.
- C06–C10: existing middleware synchronously registers the same idempotent cleanup
  before resource acquisition. Its normal `finally`, runtime drain, and external
  iterator return share one completion promise and one underlying retirement.
  Closing admission precedes retirement; the trace is registration, acquisition,
  return request, retirement. Exec and both concurrent/repeated dispose callers
  stay pending until release. Normal success/nonzero status, exact cleanup error,
  caller cancellation, and caller-versus-cleanup error precedence are checked.
- C11: the same owned fixture **without registration** permits exec and both
  dispose calls to settle before retirement. This is the decisive negative.
- C12: public-root Shell plus internal column verifies exact VFS input/output
  bytes and shell status/stdout/stderr. Existing legacy S38 owned-VFS probes and
  scoped lifecycle tests provide additional registered-VFS positive coverage.

This is a disclosed fixture revision: cooperative ownership is **explicitly
registered** where a strong barrier is asserted. Nothing registers raw external
stdin automatically or adds a public API. The old fixture is neither copied with
weaker assertions nor patched to turn green. Normal column exec already awaited
raw return; interrupting that opaque wait during disposal was declared policy,
not a registered-cleanup breach. Conversely, swallowing an awaited return error
was a real shared-input bug; this candidate contains its narrow fix.

Positive cases run with `--unhandled-rejections=strict`; final source and packed
results both contain zero unhandled events. Gates are released only after the
observation under test, and final execution/retirement/disposal is awaited. A
deadline or forced process closure cannot create a positive case result.

Mutants modify **only new fixture behavior/observations**, never frozen product:
removing registration fails C07's barrier; wrong output fails C12's exact bytes;
wrong error identity fails C02. A deliberately unhandled sentinel produces the
actual process event and exit 1 under `--unhandled-rejections=throw` with the
listener installed. Its behavioral case is 1/1, but the overall detector run
fails on that event. It is not counted as a passing/no-unhandled product run.

## Immutable source and package binding

| Input | SHA-256 |
| --- | --- |
| Whole candidate Git archive | `55202a0c155a6c40e68033da79876ee5e3970829cdd435e38583c8fe8b31326f` |
| Offline packed tgz | `27ea798e910a97ddaf9b066e6d869967ed5475eaaa98f0151016c4aaf88cf268` |
| Built tree before **and** after | `4fa14ca8be953c154737a8ed6167266a0e87ee6f61d2c565566276fd9868ca83` |
| Shared `src/shell/input.ts` | `56095c5c3092010ee90c64fd4e23d128227eebacf3b6e36b4ad62ae5aab2a602` |
| Original recipes | `e6db28115a575c6da046a9efa81841ed05dc28a04c8860630141c461bf20d2aa` |
| Original native observations | `89515a42ed2e9e634cf1c82ec523f74f6b04c20732a5826d21177f04f7657a79` |

Each fresh whole archive authenticates all **26,648 Git blobs**, not a source
subset. Every blob's bytes match Git. The twelve unrelated archived native
symlink-fixture blobs are materialized as **regular link-text files**, with their
original Git modes retained in `SOURCE.json`; no symlink is followed or exercised.
Other archived files are read-only regular files. This preserves all blob bytes,
not executable native-symlink topology; those native fixtures are outside this
scope. The exact original tar itself is retained through authentication.

Complete path/type/mode/hash inventories detect **new entries**, missing paths,
and changed bytes before/after runtime, packing and consumer checks. Build output
and copied development tools have explicit inventories; no live product overlay,
symlinked source, worktree, cherry-pick, private repo or dependency install is used.
The canonical old runner requires a `/tmp/safe-bash-column-*` snapshot, so its
isolated temporary regular-file archives use that prefix; all authored files and
durable captures are confined to this owned review directory.

Locked tools are copied from installed regular-file packages only: TypeScript
5.9.3, tsx 4.23.12, esbuild/platform package 0.28.2, @types/node 22.20.1,
undici-types 6.21.0, fsevents 2.3.3. Versions and installed integrity declarations
match the candidate lock; full reused file inventories match before/after. This
is not fresh registry/signature authentication. Package runtime dependencies
remain empty. Build and scoped strict checks pass, including maintained
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` flags.

The runtime loader restricts imports to the exact probe and candidate `dist`,
recording **181 loaded-file receipts** per execution. Packed execution resolves
`Shell` from public `virtual-bash`, but column from the **internal packed file
URL**; TypeScript resolution trace binds both declaration entries. The unpacked
consumer directory is physically renamed before execution. Package/consumer
membership and bytes remain unchanged afterward. This is not a public column
export test: no `./commands/column` export exists in this candidate. npm packing
uses `--offline --ignore-scripts`; no OS-level network-denial claim is made.

## Preserved initial attempt and environment

`capture-1` remains unchanged: 11/12 in source and package, C10 failed, all four
mutants detected, legacy 39/40, hidden exit 1/HOLD, scoped tests 73/73. C10 had
already correctly observed exact caller cancellation on exec, but this verifier
incorrectly expected concurrent dispose to succeed despite registered cleanup
rejection. Its final awaited disposal masked the assertion with that same cleanup
error. Existing `Shell.#dispose` and lifecycle tests require that error to surface.
The corrected fixture asserts **caller identity on exec and cleanup identity on
both disposal calls**, rather than ignoring disposal errors.

The initial append-proof inventory also correctly failed: the reused runner's
npm-cache environment let packing add fifteen cache entries under the candidate.
`FAILED-AUDIT.json` proves every original source/build/dependency entry unchanged
and records all additions. The corrected runner gives npm an explicit separate
cache path; it does **not** exclude unexpected entries from authentication.
Original first-attempt runner/probe bytes are retained as `.mjs.txt`. These are
harness corrections, not product fixes or an unchanged-all-harness-input claim.

Final capture window: **2026-08-27 15:58:21.740–15:59:00.918 UTC**, Darwin arm64,
Node **22.22.2** (executable hash in `SUMMARY.json`). First capture and final
audit/reporting are additional actual work, not a 72-hour claim. The old column
handoff also used Node 22.22.2; root diagnosis used Darwin Node 24.11.1 and older
frozen source `eaed12f88365e69597994c4f2e6324a020202b66`. The older column candidate
was `38cb670acf0826467e928ea30cdcb0524436d144`. These whole revisions include
intervening work; they are not a controlled single-source-change experiment.

Every bounded child closes without timeout, output cap, signal termination or
spawn failure. The unchanged wrapper then attempts owned process-group retirement;
positive results were obtained before that cleanup. Final exact snapshot removal
is recorded separately in `CLOSURE.json`, after archive/pack/import authentication.
Foreign edits, staging, and temporary artifacts are untouched. No contract defect
remains in this bounded corpus; the preserved stronger-profile S38 failure and
root's shared-fix/padding-review integration decision remain separate limits.

## Reproduction and evidence seal

Run `node tests/commands/column-stress/current-contract-review/run.mjs` with a new
capture directory under this review directory. The bounded legacy runner remains
read-only. The new runner reports the legacy failure rather than requiring all
legacy assertions to pass. Temporary snapshots are retained by the runner for
authentication; remove only its explicitly recorded owned paths after auditing.

`node tests/commands/column-stress/current-contract-review/verify.mjs` authenticates
the exact evidence membership and hashes, Git input identities, import bindings,
outcomes and preserved failures without re-executing product tests. `MANIFEST.json`
is authenticated by the enclosing evidence commit. No full gate, head-to-head
comparison, deployed-provider acceptance, superiority, or global-green claim.
