# SafeJS bounded runtime release matrix — 2026-09-15

Observed 2026-09-15T05:05:45.581276+00:00. Owner: `verify-runtime-support-matrix`. **OPEN / RELEASE BLOCKED**. This is qualification evidence, not permission to redefine runtime support or the language target.

## Source and contract

Local branch main, HEAD `ea02a95be39a4dcb2ae2c491b0096a3d26e8c1bb`. Fresh remote main was `4693f5f75b5eec61a63c07e7195824ddb22d3e92`; local main is behind remote and has pre-existing modifications. Tested local built source is identified by original local per-file fingerprints, receipt hash `6550e9ff14ad47028a7c29917c8ec00e115b381055443aa0bb8e3c8d0f9fd4f8`. No local-source result is attributed to pristine HEAD or remote main. Initial staged diff SHA-256 `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`. Applicable root AGENTS.md inspected; no nested safe-js AGENTS.md found. No runtime repair, assertion/budget/timeout change, README edit, engine change, stage, commit or push by this task.

Target remains [ECMA-262 edition 16](https://262.ecma-international.org/16.0/) and [ECMA-402 edition 12](https://402.ecma-international.org/12.0/), June 2025, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Official-source pins are retained in the original local ledger. Previously pinned Temporal, weak upsert, Atomics.pause and resource-management extensions remain separate; this probe samples Temporal and Float16 and does not qualify every extension.

Actual support derives from root package.json engines `>=18.18`, README Node 18.18+ / ESM, scripts/package-safe.mjs generated engines `>=18.18` and bundle target `node18.18`, private safe-js exports, root `./safe-js` exports and installed public manifest. Exact minimum is **18.18.0**, not latest Node18. `.github/workflows/release-safe.yml` runs Node22 / ubuntu-latest and Bun; root release runs Node22 / ubuntu-24.04. Retain Node18/20 despite upstream EOL. Previously established newer admitted lines 24/26 remain required; exact patches below are bounded representatives, not coverage of every patch satisfying the unbounded manifest.

No OS restriction is declared. Qualification therefore retains representative macOS arm64 (available), Linux x64 (CI platform), Windows x64 (no fresh runner). OS/architecture selection is a bounded release gate, not a newly invented support exclusion. Additional architectures and future majors remain unsampled rather than intentionally unsupported.

## Required cells and dated disposition

Every row below covers ESM public `.` `/core` `/cli`, compatibility `/fs` `/fs/core` `/fs/node`, CLI aliases `poe-safejs`/`poe-safe-js`, and type contracts. Import results alone do not prove CLI execution or all repaired-feature behavior. Node/ICU/V8 metadata is literal runtime output. Bun is 1.3.11 (runner reports canary.1+687700d84); its Node compatibility metadata is not the Bun version.

| Runtime  | Node / ICU / V8                      | macOS arm64                                   | Linux x64                | Windows x64        |
| -------- | ------------------------------------ | --------------------------------------------- | ------------------------ | ------------------ |
| v18.18.0 | 18.18.0 / 73.2 / 10.2.154.26-node.26 | BLOCKED: weak symbol                          | BLOCKED: no fresh runner | BLOCKED: no runner |
| v18.20.8 | 18.20.8 / 74.2 / 10.2.154.26-node.39 | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |
| v20.20.2 | 20.20.2 / 78.2 / 11.3.244.8-node.38  | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |
| v22.23.2 | 22.23.2 / 78.2 / 12.4.254.21-node.56 | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |
| v24.21.0 | 24.21.0 / 78.3 / 13.6.233.17-node.53 | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |
| v26.8.2  | 26.8.2 / 78.3 / 14.6.202.34-node.28  | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |
| bun      | 24.3.0 / 74.2 / 13.6.233.10-node.18  | Selected probes pass; full qualification OPEN | BLOCKED: no fresh runner | BLOCKED: no runner |

Workerd 2026-09-15, compatibility date **2026-09-01**, macOS arm64: installed public `/workerd` bundled with workerd condition, served in real workerd and returned HTTP200. Six selected probes pass. `nodejs_compat` explicitly requested (runtime says default since 2026-08-04); guest process/fetch remain absent. `process.versions.node=22.19.0` is compatibility metadata, ICU/V8 values are empty, **not established metadata**. Full checkpoint/replay, host-admission, filesystem-adapter and all-extension qualification remains BLOCKED by missing evidence. Linux/Windows workerd cells remain BLOCKED: no executed runners. Command discovery initially found no binary; `npx --yes workerd --version` successfully resolved it, so it is not marked unavailable. Host ICU/V8 identification still needs an authoritative workerd build receipt.

Intentionally unsupported contracts: Node below 18.18, direct CommonJS `require` routes (only ESM `import` exports; dynamic import from CJS remains ESM), browser condition for SafeJS interpreter/root/core/CLI/workerd (`browser:null`), ambient DOM/Node/process/fetch/import/filesystem authority. Portable safe-fs browser routes are separate surfaces, not browser SafeJS execution. Explicit workerd host adapters must not be mistaken for native Node filesystem authority. These are capability/packaging boundaries, not language defects. No intentionally unsupported OS has been documented or introduced here.


## Reproduction and current evidence

See [fresh qualification report](safejs-runtime-support-fresh-delivery-20260915.md) and its committed command/metadata/assertion logs. Earlier dated observations above are predecessor evidence. This bounded matrix is delivered as documentation only; no current remote-source qualification or successful publication is implied. The earlier pending local whole-suite gate was subsequently closed by its dated terminal receipt (30806 passed /52 skipped); skips remain nonpasses. Minimum weak-symbol failure and all listed absent platform/full-feature/artifact gates remain release blockers.
