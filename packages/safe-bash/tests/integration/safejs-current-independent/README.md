# Independent SafeJS public-boundary review

August 27, 2026, UTC. **Bounded independent acceptance of the public environment
dictionary fix and the eight authorized fixture corrections.** No product,
private-engine, contract or export changes were made by this reviewer. This is
not broad companion compatibility, whole-engine security, proposal approval or
overall project completion.

## Frozen inputs

- Actual private engine: `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`, copied as
  **264 regular files**, with per-file hashes/modes checked before and after.
- Original product baseline: `b4cde0bf2694c353222e21ebd8f49eeae329401e`.
- Source fix: `866a6a58eb19d7a4271fb924ec4dd103c813d0a5`.
- Final product and refreshed original tests:
  `034a5f0819ed4e06d7035c77340a066eb7121b37`.
- Original public fixtures and mechanical import/reporter/type helpers are
  frozen from `3a2d9ca`; their hashes are identical in all four runs. The original
  public assertions, six strict child routes and expected values were not edited.
- The 38 new public counterexamples are in `boundary.probe.mjs`, SHA-256
  `7dc173986491e09c49b77cb03167db132a83be2f91259e87c44c18cfda0ccfc3`.
  Corrected baseline and final runs use those exact same bytes.
- Final actual package tarball SHA-256:
  `d5119e405c5af202aedc7185f96a577ee75af6dcd226207d7833f6dad0bc77ed`, matching
  the author's separately recorded final artifact.

All product builds, `npm pack`, offline installs, copied engine execution and
type probes occur in new temporary trees outside the private repository. No
private install, build, worktree, symlink, source write or proposal application
occurs. Tools are copied from existing local caches as regular files; no download
or external service is needed. Runtime package dependencies remain empty.

## Independent results

| Cohort | Original baseline | Fixed/final |
| --- | ---: | ---: |
| Unchanged public author cases | **24/26**, 2 failures | **26/26** at both `866a6a5` and `034a5f0` |
| New public counterexamples, identical corrected inputs | **31/38**, 7 failures | **38/38** at `034a5f0` |
| Six original strict-child cancellation routes | **6/6** | **6/6** |
| Original conventional command/stress cohort | not rerun as a whole here | **116/116** |
| Original bridge cohort | not rerun as a whole here | **28/28** |
| Eight old assertions on final product/engine | **0/8**, 8 stale-expectation failures | **8/8** refreshed assertions on that same product/engine |

All enabled cohorts have **zero skips**. Public counts describe assertions and
workflows, not unique engine capabilities. The new38 include35 tests that invoke
the actual engine and three deliberate pre-abort guards that require zero runner
calls. Do not add overlapping cohorts into a guest-success score.

The116 conventional passes comprise **53 actual-engine behaviors, 60 fixture or
configuration cases, one structural type probe and two defect characterizations**.
The28 bridge passes comprise **five actual-engine behaviors, 22 fixture/config
cases and one structural type probe**. These classifications are derived from
the separately replayed unavailable-engine cohort and explicit characterization
names, with every case retained in `evidence/CHECKPOINT.json`.

The two characterization passes still demonstrate defects outside the protected
public command boundary:

1. Raw signalled ordinary environment records lose literal own `__proto__`;
   the command's prototype-free dictionary preserves it.
2. A raw pre-aborted pure run succeeds; the command rejects before invoking it.

Neither characterization is accepted as correct raw-engine behavior.

## What the independent counterexamples establish

The baseline's seven new failures share the reproduced dictionary cause:
plain/null-prototype own `__proto__` values, both key-enumeration cases,
cross-invocation environment preservation, runner-boundary snapshots and a real
`env -i ... safejs | cat` pipeline. All seven clear with the source fix while the
other31 remain passing. There is **no remaining demonstrated supported-public
failure** in this bounded cohort and no newly requested source fix.

Coverage includes:

- Plain and null-prototype dictionaries with own `__proto__`, `constructor`,
  `prototype`, `toString`, `toLocaleString`, `hasOwnProperty`, `valueOf`,
  `__defineGetter__` and Unicode keys. Frozen host descriptors/prototypes remain
  unchanged; guest enumeration preserves the keys as string data.
- Inherited properties are not promoted. An empty dictionary does not acquire
  Object methods or ambient host environment. Guest mutations do not persist
  into the caller or next command; argv/cwd/env are snapshots before a legitimate
  observed invocation of the **real** runner.
- Actual Shell `printf | env -i ... safejs | cat` with multi-byte data and intact
  parent exports; BOM-prefixed virtual script files and special filenames;
  subsequent invocation observes completed virtual-FS effects.
- UTF-8 split across three byte chunks at exact five/six-byte input limits;
  combined stdout/stderr output quota; blocked-input timeout/iterator closure;
  original-reason pre-abort for zero, empty string and Symbol; cancellation
  followed by delayed host rejection under strict unhandled-rejection handling.
- Output before a guest exception and already-completed FS writes remain visible
  (no transaction invented); parse errors prevent effects; ambient `process`,
  `require`, `Function` and `eval` bindings are unavailable.
- Standalone public shell bridge receives literal own-key environment through
  actual guest execution and an actual Shell executor with explicit signal,
  virtual FS and `read-side-effect` host policy.

The original26 additionally exercise dataSize quota, retained capability
invalidation, finite bridge budgets and the six immediate-abort/late-reject
routes: command FS, stdin, stdout, console, standalone FS and standalone shell.
All six use strict child processes, make exactly one host call and prevent later
FS effects. The command-stdin child closes its iterator once.

Four command routes retain original cancellation reason identity. Standalone
FS/shell bridges through raw `run` retain the message but not raw Error identity.
Direct bridge pre-abort deliberately exposes sanitized `AbortError`/`ABORT_ERR`,
without private cause leakage. The review preserves these different supported
contracts; it does not reinterpret them as one universal raw reason guarantee.

## Exact eight-fixture audit

`evidence/fixture-delta.json` contains the complete two-file diff, before/after
hashes and both eight-case results. The test-only commit has **no `src` delta**.
The two raw defect-characterization blocks are byte-identical before/after;
all other local-engine cases outside the one thrown-Error case are byte-identical.

| Refreshed case | Required current behavior |
| --- | --- |
| `new Error("constructed").message` | `"constructed"`, successful command output |
| `new TypeError("constructed").message` | `"constructed"`, successful command output |
| `new Map([["key", "value"]]).get("key")` | `"value"` |
| `new Set(["value"]).has("value")` | `true` |
| `new RegExp("^value$").test("value")` | `true` |
| `Array.isArray([])` | `true` |
| `Array.from([1, 2])` | `[1,2]` |
| `throw new Error("constructed")` | rejection message `constructed`; command status1, empty stdout, exact `safejs: constructed\n` stderr |

Each case keeps an unsignalled raw control, a live-signalled raw control and
the public command invocation. The first seven old assertions fail because
the expected rejection does not occur. The eighth fails because the real error
message is `constructed`, not `Error is not a constructor.` The refreshed cases
require exact values/status/output, not broad success or removed cancellation.
This verifies a stale test correction against current engine behavior, **not
eight new product fixes**.

The separate source commit's dictionary fixture/characterization adjustments
are not part of this eight-case refresh. Original public24/26 and new31/38 remain
preserved, rather than being replaced with final expectations.

## External failures and unavailable-engine results remain separate

Replayed without changing the copied engine or applying the old proposal:

| External cohort | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| Original desired raw cases | 8 | 1 | 0 |
| Raw action-abort probe | 0 | 1 | 0 |
| Proposed wrapper invariants | 2 | 7 | 0 |
| Unapproved proposed reason profile | 0 | 18 | 0 |
| Unavailable-engine conventional/bridges control | 82 | 0 | **62** |

The remaining desired raw case is pre-aborted pure-run rejection. Raw action
abort observes outward cancellation but its strict child then crashes on
`host action late rejection`. Both stdout/stderr and structured nested failure
evidence are retained. The proposal invariants/reason requirements are not
silently elevated into mandatory supported command behavior. Proposal `0c1bfe2`
remains **unapproved and unapplied**. The current engine's hashes are recorded
beside the old proposal hashes; no proposed implementation was substituted.
The62 unavailable-engine skips are explicitly **not acceptance**.

## Build, import, types and private-state evidence

- Node22.22.2, TypeScript5.9.3, Darwin arm64. Every frozen product builds and is
  packed/offline-installed with the actual package manifest. Root public imports
  resolve to the installed package; package source is absent.
- New and original public fixtures use ordinary `virtual-bash` imports. The
  conventional legacy fixtures retain the author's mechanical remapping from
  source-shaped imports to **packed dist**, not live product source. Source-map
  stack paths containing `src` do not represent source loading.
- The frozen author's import guard/reporter are reused as mechanical tools,
  not presented as newly independent implementations. This reviewer checks their
  hashes and all loaded engine hashes against the independent regular-file copy.
  Negative controls reject both private-source and product-source imports. Raw
  import traces are preserved, including strict child PIDs.
- Paired strict consumer checks: **111 baseline diagnostics, 111 integration
  diagnostics, zero introduced and zero removed**. The paired-delta command's
  status0 means no introduced errors, **not a clean strict engine typecheck**.
- Copied-engine project check remains status2 with **eight diagnostics**: six
  missing workspace-module declarations and two related implicit-any errors.
  These are the existing isolated workspace prerequisite failures. They were
  neither suppressed nor attributed to this product fix. The111 stricter
  diagnostics and the eight project diagnostics are different compiler/input
  profiles, not additive unique error counts.
- Before/after private HEAD, index, status, selected metadata and all264 engine
  files match within each run and across the entire observed interval. Existing
  private modifications/untracked paths remain present. This scoped state check
  does not claim hashes of all unrelated `out/`, cache or node_modules contents.
- All four execution trees were removed, and all **68 observed review child
  PIDs** were absent during archival. No private or unrelated process/data was
  deleted. Temporary evidence cleanup is separately recorded.

## Preserved harness correction

Initial new-probe results were30/38 before and37/38 after the fix. Seven failures
were the genuine baseline dictionary regressions. One additional failure in
both runs was this reviewer's missing required `signal` option for
`makeSafeJsShellModule`, rejected before any guest execution. The supported
public contract at `src/integrations/safejs/shell.ts:70` explicitly requires it.

The corrected probe wires one AbortController signal to both the bridge and
actual engine run; its expected bytes/status remain unchanged. An unused local
helper was also removed. The original probe bytes and both original runs are
preserved under `evidence/initial-*`; no product change or expectation relaxation
was used. Final corrected baseline31/38 and final38/38 use identical probe hashes.

## Reproduction and evidence format

Use new output directories, then inspect the reports: a capture exit0 can contain
intentional failing raw/stale cohorts and is not a blanket acceptance result.

```sh
node tests/integration/safejs-current-independent/run.mjs \
  /Users/kjopek/Workspace/poe-code /tmp/NEW_SAFEJS_BASELINE \
  b4cde0bf2694c353222e21ebd8f49eeae329401e
node tests/integration/safejs-current-independent/run.mjs \
  /Users/kjopek/Workspace/poe-code /tmp/NEW_SAFEJS_FINAL \
  034a5f0819ed4e06d7035c77340a066eb7121b37 full
```

`run.mjs` fails closed if the pinned private HEAD, import boundaries, copied-file
hashes or enabled-test skip policy are violated. Its `finally` removes only its
new execution tree and records private state. It never installs/builds in the
private checkout. Engine availability is required for the new probes; they do
not silently skip or substitute a fake runner.

`evidence/CHECKPOINT.json` indexes source/fixture/package hashes, classifications,
interval observations and child cleanup. Each phase's `report.json` is directly
readable. Its `raw-artifacts.json` contains gzip/base64 of a JSON map from original
filename to base64 bytes, with hashes at both levels. This retains exact empty
logs and import traces without adding megabytes of repeated lines. Decode with
Node's `gunzipSync`, parse JSON, then decode each entry with `Buffer.from(value,
"base64")`; verify the recorded SHA-256 before use. No captured script is executed
by decoding it. `archive.mjs` verifies the cohorts and refuses to overwrite an
existing evidence file; it is a capture utility, not a golden updater.

**Handoff:** source866a6a5 and test-only034a5f0 are independently accepted only
within this frozen supported-public scope. The external raw failures, proposal
status, unavailable-engine skips and project-wide limitations remain open.
