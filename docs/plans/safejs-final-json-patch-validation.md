# EXEC-PATCH-4: final JSON Patch validation

## Scope and publication boundary

This is a portable, agent-executed Markdown QA procedure for exactly four profiles: `data-pipelines:patch-sequence` (`standard`), `patch-backward-move`, `patch-root-replace`, and `patch-failed-test`. It does not execute EXEC-CLONE-1, which belongs to Aquinas. No standalone QA runner or production change is introduced.

All commands, completed captures, and replay generations produced here are **NEW validation**, not reconstructed historical executions. Historical argv and replay generations were not archived. Peer review and root intake remain later gates; final published all-stack HEAD execution remains a separate required gate, including outstanding PPR1/H5/Map integration as directed by the parent.

## Input provenance and exclusions

- H3 manifest SHA-256: `d513b006769864efbabf45adcbdb4a21237a9d4c31e09e1295c5022e16b6d848`; assignment: `oracle-index.json#/executorAssignments/1`. H3 resolved 207 of 212 metadata gaps; this task owns only the four JSON Patch execution-recipe cases, not the separate fifth recipe prerequisite.
- Source: unchanged F0005 bytes, SHA-256 `6113c955a9a884725b82cbec040ea2f50d050ff8f42102ef6c5eea0a32816eaf`. Configuration: unchanged F0398 bytes, SHA-256 `cd5875370308828f94d52fc2ff13d4f10fecf4525c338447e0648a2210f333e8`. Complete historical native expected values are selected from F0006 `/results/0/expected` through `/results/3/expected`, with exact selectors and hashes in `data/provenance.json`.
- Only checksum-verified, already captured H3 metadata and the three explicit functional envelopes are read. Bootstrap all 38 exact exclusions from captured inventory-verification metadata and exclude the entire security directory before selecting functional payloads. Do not open original audit paths, README files, old QA/harness scripts, or extra fixtures. Original paths in provenance are identity labels, not instructions to open them.
- Retain H3's qualification: the initial pass reported 443 guarded reads, but its individual chronological receipts were lost in a kernel reset; 73 safe envelopes survived. Recovery has 369 durable original-read receipts plus verified surviving copies. This does **not** retrospectively certify the full initial chronology. This task makes zero new original payload reads and does not repair that historical gap.

## Safety and exact source contract

The reviewed 3,427-byte source has no imports, capabilities, timers, I/O, LLM calls, or dynamic code loading. Its only external binding is the fixed profile string `caseName`. It constructs tiny ordinary JSON data and runs a finite operation list with at most eight entries; recursive equality only traverses that bounded data. Guest modules remain `{}`. Native execution is permitted only after this inspection and source/config hash checks. No upstream package or original harness is executed.

Keep the source unchanged. The native wrapper supplies `caseName`; current execution supplies `bindings: { caseName }`. Do not append observation code, rewrite `from`, transform errors into return values, or alter operations/configuration. The original return exposes the complete `document`, ordered `observations`, `inputUnchanged`, and `firstInputAmount`; compare every field and the whole reachable returned graph, including array order/holes and aliases. Do not invent native observations of unreturned lexical variables. Save the complete public capture separately, preserving its graph encoding without edits.

The failed-test profile intentionally throws `Error: patch test failed`. A conforming NEW receipt uses `kind: applicationError`, never a successful return containing an error object. Preserve raw error diagnostics separately; historical oracle equivalence requires its exact error name/message and error-vs-return distinction. The complete historical stack field is preserved, but historical and cross-engine stack-byte equality is not claimed; see the explicit diagnostic qualification.

## Bounds and lifecycle

Use the unchanged config: 300,000 steps, depth 96, string length 131,072, array length 2,048, data size 524,288, 3,000 ms guest deadline, 10,000 ms hard child timeout, 192 MiB heap, and seed 827. A NEW host output cap of 4 MiB accommodates complete public captures; it is not represented as an archived bound. Abort on timeout, signal, resource failure, mismatched graphs, or capture/restore failure; do not weaken the expected results.

COMPLETED means the exact public `run` promise has fulfilled or rejected before `dump` is called. It does not mean a failed application returned successfully. Successful runs use public `dump(execution, { mode: "capture" })`; the settled failed-test run uses public `dump(execution, { mode: "capture", onFailure: "checkpoint" })`, explicitly preserving its application error. Only public `restore(JSON.parse(capture), { source })` initializes replay. Do not construct, patch, migrate, or relabel snapshot internals.

Run an in-process restored generation, then launch a fresh Node process receiving only the unchanged source/config/profile and exact public capture bytes over stdin. Require both replays to match the complete native outcome, and save their own completed captures. A fresh process must not reuse object/function references or hidden module state from the initial run.

## Runtime preparation

The requested isolated main clone was absent, so it was cloned on main and immediately pulled with `git pull --ff-only`; base is `a84454323fb9e0391027033aef849d7bc6d9aa86`. No branch, commit, push, README, home configuration, or production edit is permitted. Dependency installation uses repository-local npm cache, disabled lifecycle scripts, and disabled skill synchronization.

On August 29, 2026, the registry reports `poe-code@11.0.23` with exactly this Git HEAD. This supersedes the task's earlier 11.0.21/pending-STR05 status only as an observed runtime identity; it does not assert final all-stack approval. Source and locally BUILT public export commands must identify their exact entrypoint and hashes. Locally built bytes are not claimed byte-identical to the registry tarball unless separately verified.

### Reproducible prerequisite commands

Run from the new isolated main clone. The initial clone/pull is already complete; later execution must verify its intended HEAD rather than silently updating a frozen candidate. The registry identity query is pinned to the observed version, not a floating latest tag.

```bash
export HUSKY=0 SKIP_SYNC_SKILLS=1 TURBO_TELEMETRY_DISABLED=1
export npm_config_cache="$PWD/out/safejs-remediation/exec-patch-4/npm-cache"
export npm_config_userconfig=/dev/null
export npm_config_globalconfig="$PWD/out/safejs-remediation/exec-patch-4/global.npmrc"
env -u TERM git rev-parse HEAD
env -u TERM npm view poe-code@11.0.23 version gitHead dist.integrity dist.tarball --json
env -u TERM npm ci --ignore-scripts --no-audit --no-fund
env -u TERM node_modules/.bin/turbo run build --filter=@poe-code/safejs... --output-logs=errors-only --log-prefix=none --verbosity=0
env -u TERM node --input-type=module -e 'console.log(import.meta.resolve("poe-code/safejs"))'
```

The source entry is `packages/safejs/src/index.ts`; the BUILT package export resolves to `packages/safejs/dist/index.js`. A registry-matched Git HEAD does not certify npm tarball byte identity. Do not change production to satisfy this recipe.

## Agent execution steps

1. Verify the frozen local input manifest, hashes, exact four IDs/profiles, complete expected records, and provenance qualification. Read the unchanged guest source before authorizing native execution. Never follow original-path labels.
2. Install/build only local prerequisites with TERM unset, skill sync/Husky disabled, and local caches. Verify the source and built public export resolve in this isolated clone; no home or other clone is modified.
3. Execute all four bounded native profiles first. Compare each complete outcome to its captured historical expectation before any SafeJS stage.
4. Execute source-public and BUILT-public current generations, then their in-process and fresh-process restored generations. Keep all completed captures, graphs, errors, command arguments, exit statuses, durations, and hashes.
5. Stop and route genuine mismatches to the owning implementation lane. Do not edit production or replace the oracle. Record initial attempts and failures even when a procedure-only correction is justified.
6. Format this Markdown, verify frozen inputs/runtime identity, and capture the procedure/data/receipts/preimages/hash manifest. No optional package test is needed unless a minimal regression requires one; any such test must use memory only.

## Executable command blocks

The following bounded commands are the executed NEW procedure. This document, rather than a standalone script file, is the authoritative QA recipe; its frozen data sidecars preserve the unchanged source/config and complete expected outcomes.

### NEW bounded child command

The child consumes a finite JSON stdin envelope. For source mode its command is `node --max-old-space-size=192 --import tsx --input-type=module -e CHILD` and imports the public source index. For BUILT mode it is `node --max-old-space-size=192 --input-type=module -e CHILD` and imports the package public export `poe-code/safejs`. Native mode uses the latter Node flags but imports no SafeJS code. CHILD is the literal block below, not an archived harness.

<!-- EXEC-PATCH-4 CHILD -->

```javascript
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const input = JSON.parse(readFileSync(0, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (hash(input.source) !== input.sourceSha256) throw Error("Source hash mismatch");
function graph(value) {
  const seen = new Map();
  const nodes = [];
  function visit(item) {
    if (item === null) return { type: "null" };
    if (typeof item === "undefined") return { type: "undefined" };
    if (typeof item === "number")
      return {
        type: "number",
        value: Object.is(item, -0) ? "-0" : Number.isFinite(item) ? item : String(item)
      };
    if (typeof item === "string" || typeof item === "boolean")
      return { type: typeof item, value: item };
    if (typeof item !== "object") throw Error("Non-data result outside finite fixture contract");
    if (seen.has(item)) return { ref: seen.get(item) };
    const identifier = nodes.length;
    seen.set(item, identifier);
    const node = {
      id: identifier,
      type: Array.isArray(item) ? "array" : "object",
      ...(Array.isArray(item) ? { length: item.length } : {}),
      entries: []
    };
    nodes.push(node);
    node.entries = Object.keys(item).map((key) => ({ key, value: visit(item[key]) }));
    return { ref: identifier };
  }
  return { root: visit(value), nodes };
}
function failure(error) {
  const name = error?.name;
  const message = error?.message;
  const properties = Object.getOwnPropertyNames(Object(error)).map((key) => ({
    key,
    value: graph(error[key])
  }));
  return {
    kind: name === "Error" && message === "patch test failed" ? "applicationError" : "runtimeError",
    error: { name, message },
    errorGraph: graph({ name, message }),
    diagnostics: { stack: error?.stack, ownProperties: properties }
  };
}
if (input.entry === "native") {
  let outcome;
  try {
    const value = new Function("caseName", input.source)(input.profile);
    outcome = { kind: "return", value, graph: graph(value) };
  } catch (error) {
    outcome = failure(error);
  }
  console.log(
    JSON.stringify({
      entry: "native",
      pid: process.pid,
      profile: input.profile,
      generation: "NEW-native",
      outcome
    })
  );
} else {
  const entrypoint =
    input.entry === "source" ? "./packages/safejs/src/index.ts" : "poe-code/safejs";
  const api = await import(entrypoint);
  async function execute(capture, generation) {
    const events = [];
    let snapshot;
    if (capture !== undefined) {
      if (input.captureSha256 && hash(capture) !== input.captureSha256)
        throw Error("Capture transport hash mismatch");
      events.push("public-restore");
      snapshot = api.restore(JSON.parse(capture), { source: input.source });
    }
    const { deadlineMs, hostTimeoutMs, heapMiB, ...limits } = input.bounds;
    const budget = new api.Budget({ ...limits, deadline: Date.now() + deadlineMs });
    const execution = api.run(input.source, {
      modules: {},
      budget,
      randomSeed: input.randomSeed,
      ...(snapshot === undefined ? { bindings: { caseName: input.profile } } : { snapshot })
    });
    let outcome;
    try {
      const result = await execution;
      events.push("run-fulfilled");
      if (!result.ok) outcome = failure(result.error);
      else
        outcome = { kind: "return", value: result.returnValue, graph: graph(result.returnValue) };
    } catch (error) {
      events.push("run-rejected");
      outcome = failure(error);
    }
    if (outcome.kind === "runtimeError")
      throw Error("Unexpected runtime failure: " + JSON.stringify(outcome));
    events.push("dump-after-settlement");
    const text = await api.dump(execution, {
      mode: "capture",
      ...(outcome.kind === "applicationError" ? { onFailure: "checkpoint" } : {})
    });
    events.push("dump-resolved");
    return {
      generation,
      entrypoint,
      pid: process.pid,
      lifecycle: "COMPLETED",
      settledBeforeDump: true,
      outcome,
      events,
      steps: budget.stepsUsed,
      parentCaptureSha256: capture === undefined ? null : hash(capture),
      capture: { encoding: "utf8", sha256: hash(text), bytes: Buffer.byteLength(text), text }
    };
  }
  if (input.stage === "fresh") {
    const fresh = await execute(input.capture, "NEW-completed-fresh-process");
    console.log(JSON.stringify({ entry: input.entry, profile: input.profile, fresh }));
  } else {
    const current = await execute(undefined, "NEW-completed-current");
    const inProcess = await execute(current.capture.text, "NEW-completed-in-process");
    console.log(JSON.stringify({ entry: input.entry, profile: input.profile, current, inProcess }));
  }
}
```

### Agent-executed source + BUILT coordinator command

Run from the isolated clone root, after the input review and build. This command reads the child block from this Markdown without creating a script file. Set `EXEC_PATCH_DATA` to an extracted candidate's data directory if needed; `EXEC_PATCH_PLAN` may point at this extracted Markdown. The default `EXEC_PATCH_ENTRIES=source,built` exercises both public entries, each with all four profiles. It emits a complete JSON receipt to stdout, including exact child argv and full outcomes/capture envelopes. The agent preserves that stdout and each completed capture via `apply_patch`, not by editing guest code. A nonzero exit is a failed validation, not permission to continue with a weaker oracle.

```bash
env -u TERM EXEC_PATCH_ENTRIES=source,built node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
const hash = value => createHash("sha256").update(value).digest("hex");
const planPath = process.env.EXEC_PATCH_PLAN ?? "docs/plans/safejs-final-json-patch-validation.md";
const dataRoot = resolve(process.env.EXEC_PATCH_DATA ?? "out/safejs-remediation/exec-patch-4/data");
const markdown = readFileSync(planPath, "utf8");
const marker = "<!-- EXEC-PATCH-4 CHILD -->";
const section = markdown.slice(markdown.indexOf(marker) + marker.length);
const fence = String.fromCharCode(96).repeat(3) + "javascript" + String.fromCharCode(10);
const childStart = section.indexOf(fence) + fence.length;
if (!markdown.includes(marker) || childStart < fence.length) throw Error("Missing child command block");
const childProgram = section.slice(childStart, section.indexOf(String.fromCharCode(10) + String.fromCharCode(96).repeat(3), childStart));
const source = readFileSync(resolve(dataRoot, "json-patch.ajs"), "utf8");
const configText = readFileSync(resolve(dataRoot, "cases.json"), "utf8");
const oracle = JSON.parse(readFileSync(resolve(dataRoot, "oracle.json"), "utf8"));
if (hash(source) !== oracle.sourceSha256 || hash(configText) !== oracle.configSha256) throw Error("Pinned input mismatch");
const config = JSON.parse(configText);
const entries = (process.env.EXEC_PATCH_ENTRIES ?? "source,built").split(",");
if (entries.some(entry => entry !== "source" && entry !== "built")) throw Error("Unsupported entrypoint");
const expectedProfiles = ["standard", "backward-move", "root-replace", "failed-test"];
if (oracle.cases.length !== 4 || oracle.cases.some((item, index) => item.profile !== expectedProfiles[index])) throw Error("Unexpected profile matrix");
const receipts = [];
const native = new Map();
function invoke(input) {
  const args = ["--max-old-space-size=" + config.bounds.heapMiB, ...(input.entry === "source" ? ["--import", "tsx"] : []), "--input-type=module", "-e", childProgram];
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const child = spawnSync(process.execPath, args, {
    cwd: process.cwd(), input: JSON.stringify(input), encoding: "utf8",
    timeout: config.bounds.hostTimeoutMs, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: "1", NO_COLOR: "1", HOME: resolve("out/safejs-remediation/exec-patch-4/isolated-host-home") }
  });
  const receipt = { id: input.id, profile: input.profile, entry: input.entry, stage: input.stage, startedAt, durationMs: Date.now() - started,
    command: { executable: process.execPath, args, stdinSha256: hash(JSON.stringify(input)), childProgramSha256: hash(childProgram) },
    status: child.status, signal: child.signal, hostError: child.error?.message, stdout: child.stdout, stderr: child.stderr };
  receipts.push(receipt);
  if (child.status !== 0 || child.signal || child.error || child.stderr) throw Error("Child failure " + input.id + ": " + child.stderr);
  receipt.output = JSON.parse(child.stdout);
  return receipt.output;
}
function matchesExpected(outcome, expected) {
  return expected.kind === "return"
    ? outcome.kind === "return" && isDeepStrictEqual(outcome.value, expected.value)
    : outcome.kind === "applicationError" && outcome.error.name === expected.error.name && outcome.error.message === expected.error.message && outcome.diagnostics.stack.split(String.fromCharCode(10))[0] === expected.error.stack.split(String.fromCharCode(10))[0];
}
function sameNative(outcome, reference) {
  return outcome.kind === reference.kind && (outcome.kind === "return"
    ? isDeepStrictEqual(outcome.graph, reference.graph) && isDeepStrictEqual(outcome.value, reference.value)
    : isDeepStrictEqual(outcome.errorGraph, reference.errorGraph));
}
let fatal;
try {
  for (const item of oracle.cases) {
    const configCase = config.cases.find(candidate => "data-pipelines:" + candidate.id === item.id);
    if (configCase?.caseName !== item.profile) throw Error("Config/profile mismatch");
    const output = invoke({ id: item.id, entry: "native", stage: "native", source, sourceSha256: oracle.sourceSha256, profile: item.profile });
    if (!matchesExpected(output.outcome, item.expected)) throw Error("Complete native historical oracle mismatch: " + item.id);
    native.set(item.id, output.outcome);
  }
  for (const entry of entries) {
    for (const item of oracle.cases) {
      const input = { id: item.id, entry, stage: "current", source, sourceSha256: oracle.sourceSha256, profile: item.profile, bounds: config.bounds, randomSeed: config.randomSeed };
      const output = invoke(input);
      for (const result of [output.current, output.inProcess]) {
        if (result.lifecycle !== "COMPLETED" || !result.settledBeforeDump || !matchesExpected(result.outcome, item.expected) || !sameNative(result.outcome, native.get(item.id))) throw Error("Current/in-process full outcome mismatch: " + item.id);
      }
      const fresh = invoke({ ...input, stage: "fresh", capture: output.current.capture.text, captureSha256: output.current.capture.sha256 }).fresh;
      if (fresh.pid === output.current.pid || fresh.parentCaptureSha256 !== output.current.capture.sha256 || !matchesExpected(fresh.outcome, item.expected) || !sameNative(fresh.outcome, native.get(item.id))) throw Error("Fresh-process full outcome mismatch: " + item.id);
    }
  }
} catch (error) { fatal = { name: error.name, message: error.message, stack: error.stack }; }
console.log(JSON.stringify({ schemaVersion: 1, classification: "NEW validation; no historical argv/replay reconstruction", sourceSha256: oracle.sourceSha256, configSha256: oracle.configSha256, entries, nativeProfiles: native.size, pass: fatal === undefined, fatal, receipts }, null, 2));
if (fatal) process.exitCode = 1;
NODE
```

### Error comparison qualification

The captured failed-test oracle includes the full historical stack, and it remains unmodified in `data/oracle.json`. Every NEW error retains its complete stack and own-property graph in receipts. The NEW comparison requires the same application-error category, exact name/message, and exact stack headline; native and public result/error graphs are compared separately from generation-specific host/eval frame locations. Historical argv is absent, so exact historical host-frame byte equality is neither fabricated nor claimed. This diagnostic qualification is visible for peer review; no historical field is deleted and the failed-test execution never becomes a successful return.

## NEW execution results — August 29, 2026

**Bounded recipe/execution READY for independent peer review and root intake, not final all-stack publication approval.** Execution started at `2026-08-29T13:00:33.880Z`, on Node `v22.22.2`, npm `10.9.7`, source and locally BUILT public entries at `a84454323fb9e0391027033aef849d7bc6d9aa86` (registry identity `poe-code@11.0.23`). No production regression was found in these four cases.

- The Markdown coordinator exited 0: **20 child processes**, **4 complete fresh native baselines**, **24 runtime outcomes and 24 genuine completed public captures**. For each of source and BUILT: four current + four in-process restored + four fresh-process restored outcomes. Total outcomes: **28**, not a package-unit-test count.
- All successful outcomes match every original expected field and the complete fresh-native return graph. Ordered rows, observation history, copied value 99 versus original value 4, root replacement, and input non-mutation are included; no reduced boolean-only oracle is used. Each full typed graph records object/array nodes, field order, array length and shared-reference identity.
- Failed-test remains `applicationError` in native and all six runtime generations. No return value substitutes for its throw. Complete historical/NEW stacks and own-property graphs are preserved; diagnostic-location qualification remains explicit. NEW native guest throw/call frame offsets `<anonymous>:39:54` and `<anonymous>:70:18` match the historical guest offsets; host eval locations are different, not claimed equal.
- Every capture is taken after run settlement. In-process replay shares its initial process PID; fresh replay has a different PID and receives only the exact capture text plus bounded source/config inputs. Parent-capture SHA and lifecycle are verified for all 24 runtime outcomes. Replay does not re-inject `caseName` bindings.
- **All six complete raw public capture strings for each profile are byte-identical**, not merely selected-state equivalent. Raw text SHA/length are checked independently from the JSON envelope's SHA/length. No checkpoint internals are edited. Step counts are identical across the six generations.

| Profile       | Native and runtime outcome | Steps per runtime generation | Raw capture bytes | Raw capture SHA-256                                                |
| ------------- | -------------------------- | ---------------------------: | ----------------: | ------------------------------------------------------------------ |
| standard      | return                     |                         1365 |              9808 | `a21c56b35b6ff61349cbe924c92d49808c228ab53822982e28b68c7a4fd41ddc` |
| backward-move | return                     |                         1731 |              9973 | `f1791370d9db4f954b3bf5812fb761e909c1b692b3776dcf2c33cbe9837a2c9c` |
| root-replace  | return                     |                         1420 |              9646 | `0199a8ff351c3a7a0e8d545adfb2a705e1205ac96f7b3ab6f434bbc1d6a49e03` |
| failed-test   | applicationError           |                         1480 |              9913 | `3283c078d065b48e3d8a26f1552faa7ac82e994a5a6df0ef82331df0c292cc6d` |

### Evidence and exact comparisons

All owned evidence is beneath `out/safejs-remediation/exec-patch-4/`:

- `data/json-patch.ajs` and `data/cases.json`: exact unchanged source/config bytes; `data/oracle.json`: complete four selected historical expectations and selectors, including original parse-failure history; `data/provenance.json`: captured H3 allowlist/exclusions and historical qualifications.
- `command-receipts.json`: exact executed child argv/code, input hashes, process timestamps/durations/PIDs/statuses, raw stdout/stderr, and all complete outcomes/captures. The successful coordinator stdout is retained byte-for-byte.
- `complete-outcomes.json`: full expected versus actual values/typed graphs for every stage, unmodified error diagnostics, lifecycle/lineage checks and capture identities. No hidden or unreturned native state is invented.
- `captures/{source,built}/{profile}/{current,inProcess,fresh}.json`: 24 lossless public capture envelopes. Decode the `capture.text` string as UTF-8 to recover exact public bytes; do not pretty-print the inner checkpoint before replay.
- `runtime-identity.json`, `preparation-and-checks.json`, `runtime-files.json`, and `captured-input-accesses.json`: exact identity/check receipts, source/BUILT hashes, and captured-only input access record. The manifest binds a readonly copy of the plan and all evidence with base-HEAD/current preimages; use captured bytes for review/intake, never a later shared live file.

### Preserved attempts and limits

The requested clone initially did not exist; the first command could not start in that cwd, then clone and pull succeeded. An initial registry query used `/dev/null` for both npm userconfig and globalconfig and failed with a double-loading-config error; the corrected local globalconfig path succeeded. A transient REPL attempt referenced an uninitialized apply-patch command binding before any data write; initialization resolved it. A missing optional `.prettierignore` read returned exit 1; it changed no files. These are tooling/preparation attempts, not application regressions, and are not silently represented as successful first attempts.

Dependency install succeeded (548 packages); initial prerequisite build succeeded (**67 tasks, zero cached**, 38.563 seconds). The build generated untracked terminal-pilot font assets; they are not authored/publishable changes and are excluded from this evidence candidate. No tracked production file changed. No optional package unit test was added; lint/new-test typechecking and unit-suite counts are therefore not claimed. The prerequisite build runs package TypeScript compilation; Markdown formatting and diff checks are recorded separately.

No historical argv, historical completed capture or historical replay generation was reconstructed. No original audit payload, excluded path, entire security directory, or old QA/harness script was opened, hashed or executed. The 38-path captured exclusion bootstrap remains in force. H3's **443 initially reported guarded reads / lost individual chronology / 73 surviving safe envelopes / 369 durable recovery reads** qualification remains unresolved as historical chronology; this work does not claim a full initial audit.

Final recorded checks also pass: the repeated prerequisite build reports **67 successful tasks / 65 cached** (2.89 seconds), `env -u TERM node_modules/.bin/tsc --noEmit -p packages/safejs/tsconfig.json` exits 0, `env -u TERM node_modules/.bin/prettier --check docs/plans/safejs-final-json-patch-validation.md` exits 0, and `env -u TERM git diff --check` exits 0. The 125 source-runtime files and 125 BUILT JavaScript files remain hash-identical across the repeated build. No package unit suite or lint result is inferred from these checks.

Peer review, root intake, and execution against the eventual final published all-stack HEAD remain mandatory later gates, including PPR1/H5/Map work as directed by root. EXEC-CLONE-1 remains Aquinas's separate assignment. This bounded success does not clear unrelated integration gates or certify a registry tarball.

## Complete historical expected outcomes

The following selected records are reproduced losslessly from the captured expected objects; the failed historical record's `kind: "error"` is an error oracle, classified as `applicationError` in NEW execution receipts. Its full stack is retained, not rewritten. Corresponding full NEW native/runtime graphs are in `complete-outcomes.json`.

```json
[
  {
    "id": "data-pipelines:patch-sequence",
    "profile": "standard",
    "expected": {
      "kind": "return",
      "value": {
        "document": {
          "rows": [
            {
              "id": "r2",
              "amount": 8
            },
            {
              "id": "r4",
              "amount": 6
            },
            {
              "id": "r3",
              "amount": 2
            },
            {
              "id": "r1",
              "amount": 4
            }
          ],
          "metadata": {
            "title": "published"
          },
          "archive": [
            {
              "id": "r1",
              "amount": 99
            }
          ]
        },
        "observations": [
          {
            "op": "test",
            "tested": true
          },
          {
            "op": "copy",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          },
          {
            "op": "move",
            "tested": false
          },
          {
            "op": "add",
            "tested": false
          },
          {
            "op": "remove",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          }
        ],
        "inputUnchanged": true,
        "firstInputAmount": 4
      }
    }
  },
  {
    "id": "data-pipelines:patch-backward-move",
    "profile": "backward-move",
    "expected": {
      "kind": "return",
      "value": {
        "document": {
          "rows": [
            {
              "id": "r1",
              "amount": 4
            },
            {
              "id": "r2",
              "amount": 8
            },
            {
              "id": "r4",
              "amount": 6
            },
            {
              "id": "r3",
              "amount": 2
            }
          ],
          "metadata": {
            "title": "published"
          },
          "archive": [
            {
              "id": "r1",
              "amount": 99
            }
          ]
        },
        "observations": [
          {
            "op": "test",
            "tested": true
          },
          {
            "op": "copy",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          },
          {
            "op": "move",
            "tested": false
          },
          {
            "op": "add",
            "tested": false
          },
          {
            "op": "remove",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          },
          {
            "op": "move",
            "tested": false
          }
        ],
        "inputUnchanged": true,
        "firstInputAmount": 4
      }
    }
  },
  {
    "id": "data-pipelines:patch-root-replace",
    "profile": "root-replace",
    "expected": {
      "kind": "return",
      "value": {
        "document": {
          "final": [1, 2, 3]
        },
        "observations": [
          {
            "op": "test",
            "tested": true
          },
          {
            "op": "copy",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          },
          {
            "op": "move",
            "tested": false
          },
          {
            "op": "add",
            "tested": false
          },
          {
            "op": "remove",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          },
          {
            "op": "replace",
            "tested": false
          }
        ],
        "inputUnchanged": true,
        "firstInputAmount": 4
      }
    }
  },
  {
    "id": "data-pipelines:patch-failed-test",
    "profile": "failed-test",
    "expected": {
      "kind": "error",
      "error": {
        "name": "Error",
        "message": "patch test failed",
        "stack": "Error: patch test failed\n    at applyOperation (eval at <anonymous> (file:///Users/kjopek/Workspace/poe-code/[eval1]:1:97), <anonymous>:39:54)\n    at eval (eval at <anonymous> (file:///Users/kjopek/Workspace/poe-code/[eval1]:1:97), <anonymous>:70:18)\n    at file:///Users/kjopek/Workspace/poe-code/[eval1]:1:3732\n    at ModuleJob.run (node:internal/modules/esm/module_job:343:25)\n    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:272:26)\n    at async ModuleLoader.executeModuleJob (node:internal/modules/esm/loader:268:20)\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)"
      }
    }
  }
]
```
