# Coherent78 selected composition — author qualification

Status: **ready for DIFFERENT review**, not an independent acceptance, public
release or whole gate. No production files were changed in this task.

## Candidate and original history

- Composition tree: `8437e4eda904e1248c25eeef0d9d455b1d251495` (computed logical
  Git tree, not asserted to be a stored object).
- Original manifest/case preseal: `186804b7ae9d8280aac3ee78e556bfd7c8bba7d3`.
- Original executor: `acc42a2a1c5963928a09e07043a64aceb9a47e7b`; successful build,
  then pre-import Darwin path-spelling failure. Preserved, not a product failure.
- Canonical-path executor: `688ccf86f3c666518a5a3f13a3a264d699dbd7ca`;
  **original source16/18**, C14/C15 failed. Evidence/decision checkpoint
  `bf9f585b24fc9f92007a2c5ef0c584f4f639ab6e` remains immutable.
- ROOT-approved additive v2 profile/executor seal, before new execution:
  `2512822b834ccb0843386b9558d372f654cd142f`.

The original `CASES.json`, `PRESEAL.json`, `TYPES.json`, manifest and captures
are unchanged. `CASES-v2-overlay.json` alone changes the final C15 positive
operand from an invalid high surrogate to U+FFFD. R15 separately reuses the
original input and asserts exact parser refusal. C14 no longer demands abort of
an already-disposed detached request signal; every acquisition, output, return,
disposal, header, pending-read/listener, caller and timer assertion remains.
C13 still demands actual request abort on timeout.

## Exact composition

Base public78 `67eab12e315054907ef4ef435c6bbca2f59e0c36`, with exactly:

| Path | Accepted input |
| --- | --- |
| `src/fs/webdav/webdav.ts` | `ca1d33424b94a21ae0f40a36412fd8191611e2df` |
| `src/fs/webdav/README.md` | same ca1d3342 |
| `src/shell/runtime.ts` | `d2502aae3c8458e0ac92662f2af07e7f9fc3923a` |
| `src/shell/shell.ts` | same d2502aae |
| `src/commands/structured/interpreter.ts` | `74361026502d76b8c2b696f9c60e410ac9b78d95` |

The d250 source pair plus the DAV pair on5137 reconstruct accepted DOTGLOB
tree37ad exactly. `MANIFEST.json` records all268 selected regular inputs,
214 production TypeScript files, source Git blob IDs/SHA256/lengths and revisions.
No moving-HEAD overlays, YQ/XAN additions, arrays, fixed76 gate edits or root
wiring. Root package/export/README bytes stay base67. Other documentation is
historical base67; only the selected DAV README is updated. Documentation is
not presented as a newly reconciled release description.

## Actual v2 results

This was a **fresh reproducible build**; earlier task-owned temporary roots had
been removed. Source-build means execution of emitted code from selected source,
not direct TypeScript execution.

| Layout | Revised positive checks | Separate original-input refusal | Strict types |
| --- | ---: | ---: | --- |
| Fresh source-build, affected checks only | C14/C15:2/2 | R15:1/1 | 2 positive,4 expected-negative,4 positive inversions |
| Full offline-installed package | 18/18 | R15:1/1 | same10 expected outcomes |
| Physically moved installed package | 18/18 | R15:1/1 | same10 expected outcomes |

Original source16/18 is **not** rescored as18/18. Original16 unaffected successful
source observations remain prior evidence; all18 revised cases were actually
executed in each package layout. No old component/native/SafeJS totals are credited
to this composition.

Each behavior layout authenticated **210 distinct actually loaded emitted modules**.
The emitted package contains214 declarations; each of30 consumer compiler runs
listed and hash-authenticated86 actual package declarations, including root and
timeout subpath. Strict NodeNext/exactOptionalPropertyTypes negative cases failed
for their expected diagnostic, and their positive inversions compiled. No source
fallback, `@ts-expect-error`, global typecheck-all or foreign fixture repair.

Exact default inventory78 passed; zero runtime/optional/peer dependencies.
Curl and SafeJS remain opt-in. Stack/shopt/LET/getopts are builtins, not default
plugin inventory increments. All network/DAV work used explicit injected mocks.

## Full package and bindings

Complete npm tarball: **858 regular files,759089 bytes**. Offline pack/install
used no scripts, dependencies, network service or global/user npm configuration.
After installation the entire package inventory was checked, then the consumer
was physically renamed; its original path was absent during moved execution.

- Whole tarball SHA256:
  `6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`
- Whole installed manifest SHA256 (JSON serialization of `fullInstalledBefore`,
  including all file/directory entries, byte lengths, modes and file hashes):
  `484c1dd76c63f126376cff810b445c8185e791825ec83fd94e996691b2b1eb5d`
- Emitted package inventory SHA256 (`packageInventory` serialization):
  `b398adcba9cda07b0ca9d53d42f891ba9110ac54d872a9b98af085cbeda49db7`
- All214 declaration manifest SHA256 (`declarations` serialization):
  `10fe5b48b753bdceb8dc74cc65932ef6e59a5c60e439200e3c1ba8daa19a28f3`

Full tarball bytes, inventories, actual runtime/declaration loads, commands and
unabridged output are embedded in
`captures/coherent78-author-ZpMIyO.json.gz.base64`; capture SHA256:
`0b785f60c85992a4c73647120492c9ea2f4c8463f96a8fd7f1163d862c040435`.
`CANDIDATE.json` provides machine-readable source/emitted/API/declaration bindings.
This is a complete package proof, not an entrypoint-only projection.

## Controls, effects and cleanup

Five actual controls passed: wrong source-manifest hash rejected before
materialization; altered emitted runtime rejected by loader; outside-consumer
fallback rejected; inverted C02 assertion produced a genuine assertion failure;
missing timeout entrypoint failed module resolution. These are admission/assertion
controls, **not product-mutation coverage**. All intentionally changed package
files were restored and the full post-control inventory matched, including new
entry detection. Selected source and metadata stayed byte-identical.

C13 manually delivered timeout: status124, request signal aborted, one acquired
iterator returned and one response disposed before settlement, no pending read,
listener or timer handle; caller remains live. C14: status0/output`x`, two next
calls/one delivered chunk, one return/disposal before settlement, header retained,
no pending read/listener/timer, live caller. Its completed request signal remained
false, now correctly an observation rather than an assertion. R15 returned exact
status5/empty stdout/column39 high-surrogate diagnostic in all three new layouts.

45/45 Shell instances disposed across new positive/refusal layouts. All40 direct
build/npm/runtime/type/control subprocesses exited naturally; no owned command
was left running. Task-owned root, npm cache/home/config/data and moved consumer
were removed. Cleanup is the observed owned-resource scope, not a universal host
process census. No external service, native oracle, private SafeJS execution,
credentials, XAN activity or timing benchmark.

## Reproduction and different-review boundary

    node tests/integration/coherent78-shell-author-20260828/run.mjs

The runner authenticates immutable inputs, rebuilds afresh and writes a new unique
capture. It never overwrites historical evidence. It uses existing local Node22+
and TypeScript5.9.3 dev tooling only. To inspect/extract the already-tested full
tarball without rerunning, decode the capture's base64, gunzip, parse JSON, then
decode `pack.base64`; validate against `pack.sha256` before use.

Different reviewer should freeze this exact source/manifest/overlay/executor and
full package, replay revised cases/types in isolated installed/moved layouts, and
challenge actual load rejection and cleanup assertions. Keep original16/18 and
new2+1/18+1 denominators separate. Reuse accepted component evidence only with
its existing qualifications: no full Bash/native parity, `/bin/sh`, nounset,
arrays, universal provider ACL, live HTTP/service, timeout accuracy or whole78
gate claim. Fixed76 host-permission HOLD remains unrelated and unresolved here.
