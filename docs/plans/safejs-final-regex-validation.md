# H4: portable final regex validation

Date: August 29, 2026. Scope: H4 only, not the overall composite review or lifecycle
adapter. This is an agent-executed Markdown procedure, not an executable QA runner.

## Intake and ownership

The isolated checkout was absent, so it was cloned on `main` and successfully
pulled with `--ff-only` before validation. Rehearsal HEAD is
`7203ec5135edce5a4da2e603778fd91c3fe042e9`, **not a final published composite**.
The parent planning handoff is metadata-only, SHA-256
`1c69e2a89a2a9d610358028ba7a7b185a3f7e7448d63b6be9ee54af32812933e`;
only its `regex` and H4 `missingPrerequisites` data are used here.

The only package change is the new proper test
`packages/safejs/src/interp/methods/regex-final-qualifications.test.ts`.
It relocates the frozen seven-case file, changing only its two import specifiers.
All non-import statements, guest sources, native expectations, and assertions are
byte-identical. It performs no disk I/O or LLM calls. Its preimage is absent.

- Frozen seven-case file: `evidence/author/qualifications.test.ts`, SHA-256
  `47be6e73beea96e49f411a2c5e305b53ba140eb38d58c9aace61e4e2c2ca75fc`.
- Relocated proper test: SHA-256
  `578a14b4af03a11029af55b1993df446b81523ffcaec63e6dcceb8fb0124e109`.
- Historical ten-source wrapper: `evidence/independent/original-cohort.test.ts`,
  SHA-256 `878f6b2d1a38a39edd2d42c5ab6d44465b28b1e7a18287cc02485ec34dbe31ae`.
  Do not execute that ignored wrapper. The inline procedure retains its exact
  sources, hashes, full typed oracle, two repetitions, strict comparisons, repeat
  stats/steps comparison, empty module map, seed, and budget limits.

Root must approve intake of this test-only relocation and plan. Final execution
still requires the parent's actual runtime freeze, approved component intake, and
H10 dependency/build provenance. No production overlay is permitted in a final
published-HEAD execution. Missing prerequisites remain named gaps, not passes.

## Read-only capture and exclusions

Set `H4_CAPTURE` to the approved STR05 capture root, or an exact read-only copy:

`/Users/kjopek/Workspace/poe-code-safejs-split-captures-integrated/out/safejs-remediation/str-05-ordered-validation/tmp/candidate-3180c4c3-str05-only`

Its `manifest.json` SHA-256 is
`8f0234e26c977d6ff464588dd5cd0c7e0a5fcbeee3be276d125d0f884c6662bf`.
Resolve only the relative `capture` locators below under that selected root.
Never execute old `executionLocation`, historical argv, or absolute clone paths
from metadata. A portable subset may contain this exact manifest plus the
explicit H4 files; it must be labeled a subset, not a complete STR05 delivery.

Before any captured payload access, verify
`evidence/independent/audit-read-policy.json`, SHA-256
`898c4762de7fca9b2a5e751f098a92cdfce65aa09824b1c0cb32fa43e93d450f`.
Retain its exact **38 unique excluded logical paths**, the whole
`out/safejs-audit-2026-08-27/security/` prefix, and aliases of excluded identities.
The original audit workspace is prohibited entirely; no original inventory or
payload is needed. No recursive audit scans, excluded stat/read/hash/execute,
security research, guest I/O, or live LLM is authorized.

The immutable manifest has a **malformed 56-character convenience value** in
`postPrerequisiteState.metadataRegexSha256`. Two preliminary assertions exposed
that discrepancy; no runtime test executed in those attempts. Do not alter the
capture or trust that scalar. The manifest-bound metadata prerequisite postimage
entry and its artifact entry both verify the actual 64-character SHA-256
`514b2a48bcfe9ffa6eccd2ae4deb23eb2c87aceb2c5083b6fdf621708ea2cd39`.
The H4 handoff preserves this metadata discrepancy explicitly; no source or oracle
was changed to bypass it.

## Exact typed oracles

The authoritative ten full outputs are in
`evidence/independent/fresh-native.v8`, SHA-256
`0c43073bce5078ce886b894cc0d43566f176de8cbda70bf5d584818a97c4daf0`.
The captured slot proof is
`evidence/independent/built-originals-and-slot-proof.v8`, SHA-256
`d749123f5a852554b424ee636a1cb1ec2b69721df059176dd93a91f6c28f4035`.
Deserialize these with `node:v8`; JSON is not an undefined/hole oracle.

All ten source paths below are relative to
`evidence/independent/originals/` inside `H4_CAPTURE`. Their full original identities
and exact byte counts are in the manifest's `originals` array.

| Source                                   | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `01-marked-table.safejs`                 | `bb11d644c595aefda2556cd0d83028bac389b42d6954be4cbd0c3960fcfae842` |
| `06-template-replacement-unicode.safejs` | `d211632dfa16b9865d63699e8d1a4b47bd793f813447854173fd909b2fa2972b` |
| `r01-match-metadata.safejs`              | `0d5bef1aede138e38a3f8d8367a61f601dc451b0167c2d15590d230009b8f2ce` |
| `r03-replacement-captures.safejs`        | `28339e68c01d96468e9f825b0f7e5ef700fea39916b2aed206f728cfdb26365c` |
| `r04-replacement-context.safejs`         | `f5ebff2b937e8672a8042a0d367f4927c26779e394989d30fabece0f1e434ddc` |
| `r05-global-lastindex.safejs`            | `ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d` |
| `r06-no-global-match.safejs`             | `5d7008596bfe91cbdf97d7486c854bd6f59b25a2edb131131aadb0032d505e3b` |
| `r07-zero-width-split.safejs`            | `9ec3190d87f38c9087ee5fd5610420319153e1d86b3a90bfe476f35396e7def1` |
| `r08-unicode-and-anchors.safejs`         | `c77da5fe43081b060c9ebb60a4dc2edaee0c5f6f73b3775eca88390bd2182ff5` |
| `r09-repeated-captures.safejs`           | `868ce416b72183c0654fd565761bafaf4df7e373e81edf0a83533dbe983ee4db` |

The seven native expectations remain, in order: `0`;
`["0", "index", "input", "groups"]`; `"a0"`; `"aa-cc"`;
`{ all: ["a"], matched: ["a", "a"], lastIndex: 0 }`;
`["", "a", undefined, "", undefined, "b", ""]`; and `["", "a", "b"]`.
These are explanatory values, not replacement test oracles.

The full r05 workflow preserves cursor 2 after `matchAll`, resets it to 0 after
`match`, assigns 2 again, and resets to 0 after replacement. r06 returns
`{ isNull: true, value: null }`. All five r07 fields remain exact: empty array;
`["a", "b"]`; `["a", "b", ""]`; `["a", "1", "b", "2"]`; and
`[55358, 56810]`. Do not reduce the complete table/template/Unicode outputs to
these illustrative scalars. Own `groups: undefined`, metadata order, index/input,
and slot presence are also checked by the existing metadata package suite below.

## Agent setup and proper-package gates

Work only in the root-approved isolated final checkout. Set these variables from
approved intake, not from a moving publisher checkout:

```sh
export GIT_OPTIONAL_LOCKS=0
export H4_TARGET_HEAD='<root-approved exact target SHA>'
export H4_CAPTURE='<absolute read-only capture root>'
export H4_EVIDENCE="$PWD/out/safejs-remediation/final-composite/<target-SHA>/regex"
test "$(git rev-parse HEAD)" = "$H4_TARGET_HEAD"
git check-ignore -q "$H4_EVIDENCE"
git diff --exit-code HEAD -- packages/safejs/src
mkdir -p "$H4_EVIDENCE/runtime/home" "$H4_EVIDENCE/runtime/cache" \
  "$H4_EVIDENCE/runtime/config" "$H4_EVIDENCE/runtime/tmp"
export HOME="$H4_EVIDENCE/runtime/home"
export XDG_CACHE_HOME="$H4_EVIDENCE/runtime/cache"
export XDG_CONFIG_HOME="$H4_EVIDENCE/runtime/config"
export TMPDIR="$H4_EVIDENCE/runtime/tmp"
export npm_config_cache="$H4_EVIDENCE/runtime/cache/npm"
export SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error
```

Use a fresh evidence directory for every attempt. Retain failures rather than
overwriting them. Setup/build belongs to H10; do not install a new framework,
sync home skills, or compensate for missing build artifacts here. Verify the
relocated test hash before executing it. No snapshot screenshots are required for
this nonvisual lane; the parent's SIGINT/screenshots lane is separate.

```sh
node --input-type=module <<'NODE'
import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const bytes = fs.readFileSync("packages/safejs/src/interp/methods/regex-final-qualifications.test.ts");
assert.equal(createHash("sha256").update(bytes).digest("hex"), "578a14b4af03a11029af55b1993df446b81523ffcaec63e6dcceb8fb0124e109");
console.log(process.version);
NODE
env -u TERM ./node_modules/.bin/vitest run \
  packages/safejs/src/interp/methods/regex-final-qualifications.test.ts \
  --reporter=verbose --reporter=json \
  --outputFile.json="$H4_EVIDENCE/qualifications.json"
env -u TERM ./node_modules/.bin/vitest run \
  packages/safejs/src/interp/methods/regex-metadata-order.independent.test.ts \
  --reporter=verbose --reporter=json \
  --outputFile.json="$H4_EVIDENCE/metadata-presence.json"
```

Require exactly **7/7 in one file** and **169/169 in one file**, with no failures or
skips. The first file preserves all seven old assertions, including the formerly
failing STR05 case. No broad include override, ignored out-test path, or
`mergeConfig` concatenation is used.

## Bounded inline native/current/replay procedure

Run the following block twice in the final checkout, first with
`H4_PROFILE=source H4_API=./packages/safejs/src/index.ts`, then with
`H4_PROFILE=built H4_API=./packages/safejs/dist/index.js`. Export both variables.
The two shell iterations launch **separate processes**. Each profile requires
20 full original current comparisons and 20 fresh-process replay comparisons,
plus two current/two replay repetitions of the captured typed-slot control.

Replay uses genuine public `dump(execution)` bytes from the completed producer,
unchanged and hash-bound. These are pure completed-checkpoint replays, **not**
pending host, cancellation, SIGINT, or lifecycle proofs. Never substitute a second
plain run for the replay iteration. H6/H7 and Nash's lifecycle work remain separate.

The agent records exact argv, this verbatim block's SHA-256, environment, target
SHA/build provenance, exit code, and stderr. Keep the 30-second per-process bound;
terminate only an owned over-bound child and retain partial artifacts. Do not save
this block as a `.ts`, `.js`, or shell QA runner file.

<!-- h4:inline -->

```sh
set -e
for H4_PHASE in current replay; do
  export H4_PHASE
  env -u TERM node --import tsx --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const capture = fs.realpathSync(process.env.H4_CAPTURE);
assert(!capture.split(path.sep).includes("safejs-audit-2026-08-27"));
const profile = process.env.H4_PROFILE;
const phase = process.env.H4_PHASE;
assert(["source", "built", "frozen-rehearsal"].includes(profile));
assert(["current", "replay"].includes(phase));
const evidence = path.resolve(process.env.H4_EVIDENCE, profile);
assert(evidence.startsWith(path.resolve("out") + path.sep));
fs.mkdirSync(evidence, { recursive: true });
const output = path.join(evidence, `${phase}.v8`);
assert(!fs.existsSync(output), "Use a fresh attempt directory");
const manifestBytes = fs.readFileSync(path.join(capture, "manifest.json"));
assert.equal(hash(manifestBytes), "8f0234e26c977d6ff464588dd5cd0c7e0a5fcbeee3be276d125d0f884c6662bf");
const manifest = JSON.parse(manifestBytes);
const guardPath = "evidence/independent/audit-read-policy.json";
const nativePath = "evidence/independent/fresh-native.v8";
const slotsPath = "evidence/independent/built-originals-and-slot-proof.v8";
const allowed = new Set([guardPath, nativePath, slotsPath, ...manifest.originals.map(item => item.capture)]);
const readCaptured = (relative, expectedHash) => {
  assert(allowed.has(relative));
  const resolved = fs.realpathSync(path.resolve(capture, relative));
  assert(resolved.startsWith(capture + path.sep));
  const bytes = fs.readFileSync(resolved);
  assert.equal(hash(bytes), expectedHash);
  return bytes;
};
const guard = JSON.parse(readCaptured(guardPath, "898c4762de7fca9b2a5e751f098a92cdfce65aa09824b1c0cb32fa43e93d450f"));
assert.equal(new Set(guard.excludedPaths).size, 38);
assert(guard.deniedDirectories.includes("out/safejs-audit-2026-08-27/security/"));
const allowedIdentities = new Set(guard.capturedOriginalAllowlist.map(item => item.original));
const oracle = deserialize(readCaptured(nativePath, "0c43073bce5078ce886b894cc0d43566f176de8cbda70bf5d584818a97c4daf0"));
const slots = deserialize(readCaptured(slotsPath, "d749123f5a852554b424ee636a1cb1ec2b69721df059176dd93a91f6c28f4035"));
assert.equal(oracle.length, 10);
assert.equal(manifest.originals.length, 10);
const cases = manifest.originals.map(item => {
  assert(allowedIdentities.has(item.original));
  assert(!guard.excludedPaths.includes(item.original));
  assert(!item.original.startsWith("out/safejs-audit-2026-08-27/security/"));
  const source = readCaptured(item.capture, item.sha256).toString("utf8");
  const anchor = oracle.find(record => record.file === item.original);
  assert(anchor);
  assert.equal(anchor.sha256, item.sha256);
  assert.equal(anchor.source, source);
  return { id: item.original, source, sha256: item.sha256, expected: anchor.value };
});
cases.push({ id: "captured-typed-slots", source: slots.probe, sha256: hash(slots.probe), expected: slots.native });
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(head, process.env.H4_TARGET_HEAD);
const apiPath = path.resolve(process.env.H4_API);
const apiSha256 = hash(fs.readFileSync(apiPath));
const lockSha256 = hash(fs.readFileSync("package-lock.json"));
const metadata = { profile, phase, head, apiPath, apiSha256, lockSha256, pid: process.pid, records: [] };
const persist = () => fs.writeFileSync(output, serialize(metadata));
const watchdog = setTimeout(() => { persist(); process.exit(124); }, 30000);
watchdog.unref();
try {
  const { run, Budget, dump } = await import(pathToFileURL(apiPath).href);
  const producer = phase === "replay" ? deserialize(fs.readFileSync(path.join(evidence, "current.v8"))) : null;
  if (producer) {
    assert.equal(producer.success, true);
    assert.equal(producer.profile, profile);
    assert.notEqual(producer.pid, process.pid);
    assert.equal(producer.head, head);
    assert.equal(producer.apiSha256, apiSha256);
    assert.equal(producer.lockSha256, lockSha256);
    assert.equal(producer.records.length, 22);
  }
  for (const [ordinal, item] of cases.entries()) {
    const repeated = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const native = structuredClone(vm.runInNewContext(`(function(){${item.source}\n})()`, {}, { timeout: 1500 }));
      assert.deepStrictEqual(native, item.expected);
      const parent = producer?.records.find(record => record.id === item.id && record.repeat === repeat);
      let snapshot;
      if (producer) {
        assert(parent);
        assert.equal(parent.sourceSha256, item.sha256);
        const bytes = fs.readFileSync(path.join(evidence, parent.checkpoint));
        assert.equal(hash(bytes), parent.checkpointSha256);
        snapshot = JSON.parse(bytes);
      }
      const budget = new Budget({ maxSteps: 200000, maxCallDepth: 64, stringLength: 131072,
        arrayLength: 8192, dataSize: 2097152, deadline: Date.now() + 2500 });
      const execution = run(item.source, { modules: {}, budget, randomSeed: 20260829, ...(snapshot ? { snapshot } : {}) });
      const result = await execution;
      const record = { id: item.id, repeat, sourceSha256: item.sha256, ok: result.ok,
        value: structuredClone(result.returnValue), stats: result.stats, steps: budget.stepsUsed,
        parentCheckpointSha256: parent?.checkpointSha256 ?? null };
      metadata.records.push(record);
      persist();
      assert(result.ok);
      const checkpoint = await dump(execution);
      record.checkpoint = `${phase}-${ordinal}-${repeat}.snapshot.json`;
      record.checkpointSha256 = hash(checkpoint);
      fs.writeFileSync(path.join(evidence, record.checkpoint), checkpoint, { flag: "wx" });
      persist();
      assert.deepStrictEqual(record.value, item.expected);
      if (item.id === "captured-typed-slots") {
        assert(Object.hasOwn(record.value.absent, 1));
        assert(!Object.hasOwn(record.value.absent, 3));
        assert.deepStrictEqual(Object.keys(record.value.absent), ["0", "1", "2"]);
        assert.equal(record.value.absent[1], undefined);
        assert.equal(record.value.empty[1], "");
        assert(Object.hasOwn(record.value.interior, 1));
        assert.equal(record.value.interior[1], undefined);
        assert(!Object.hasOwn(slots.hole, 1));
        assert.notDeepStrictEqual(record.value.absent, slots.hole);
        assert.notDeepStrictEqual(record.value.absent, ["x", "", "Z"]);
        assert.notDeepStrictEqual(record.value.absent, ["x", null, "Z"]);
        assert.deepStrictEqual(deserialize(serialize(record.value)), record.value);
        assert(!Object.hasOwn(deserialize(serialize(slots.hole)), 1));
      }
      repeated.push({ value: record.value, stats: record.stats, steps: record.steps });
    }
    assert.deepStrictEqual(repeated[1], repeated[0]);
  }
  assert.equal(metadata.records.length, 22);
  metadata.success = true;
  persist();
  console.log(JSON.stringify({ profile, phase, originals: 10, originalComparisons: 20,
    typedSlotComparisons: 2, pid: process.pid, success: true }));
} catch (error) {
  metadata.failure = { name: error.name, message: error.message, stack: error.stack };
  persist();
  throw error;
} finally {
  clearTimeout(watchdog);
}
NODE
done
```

## Rehearsal and handoff record

The unchanged seven-test relocation independently reproduces **6 pass/1 fail**
with the exact post-STR02 preimage, then **7 pass/0 fail** with the approved STR05
source. The existing metadata-presence suite passes **169/169**. No expected
failure marking or skipped assertion is used.

Rehearsal uses a read-only Vite source overlay for those package tests and a
generated public-API library for the inline procedure. The latter exports the
same `run`, `Budget`, and `dump` implementations and binds all 66 build inputs;
only `string.ts` is overlaid with the approved STR05 bytes. It is a build artifact,
not a QA runner. Main's already-published metadata source matches the exact
approved prerequisite artifact. No production file is edited. The selected
profile is explicitly `frozen-rehearsal`, never `source` or `built` final approval.

**H4 procedure/relocation handoff is ready for root intake and an independent
final executor.** The verbatim inline block passes 20/20 full-original current
comparisons and 20/20 full-original replay comparisons, plus 2/2 current and 2/2
replay typed-slot comparisons. Producer and replayer are distinct processes; every
replay consumes its producer's actual unchanged, hash-verified dump. Full typed
outputs and all 44 genuine dump artifacts per successful attempt are retained.
The procedure also passes after relocating its inputs into a 35-file approved
capture subset in this new clone; no legacy absolute capture/test path is followed.
The immutable H4 handoff carries that subset as `frozen-regex-capture/`, so an
executor can set `H4_CAPTURE` to that directory. The subset intentionally does not
materialize every historical artifact listed in the unchanged STR05 manifest.

The first inline attempt failed before executing any case because the `tsx` CLI
could not create its IPC socket under the long isolated temporary path
(`EADDRINUSE`). The retained final command uses `node --import tsx`, avoiding that
CLI IPC requirement. No source or oracle changed. The failed command/log remain
evidence, not a passed workflow. Initial Markdown formatting failure is retained
and corrected only in this new plan.

The new fixture passes configured ESLint and an explicit one-root TypeScript
check, with a local-source mapping for the frontmatter dependency. Final Prettier
checks cover both publishables; `git diff --check` also passes. This is not a root
or package-wide type gate, H10 replacement, or a resolution of the parent's
separate NUM38/CTX2748 legacy typing qualifications. No full suite is needed or
claimed for this bounded portability change. Do not treat this rehearsal as
final published-source or final built-package gates.

The Git index's binary bytes changed after initial intake, with cause unestablished;
all staged path/mode/object entries still equal HEAD and both tracked/staged diffs
are empty. HEAD/config/exclude, lockfile, and production bytes remain unchanged.
No index restoration was attempted. This observation is retained rather than
claiming strict Git metadata immutability.

The final H4 handoff publishes only this plan and the seven-case proper package
test, both with absent preimages. Evidence, the frozen capture subset, runtime
library, control config, and immutable manifests are reference-only. No production
file, README, screenshot test, executable QA runner, or new framework is included.
No Noether overall-plan review or Nash lifecycle result is claimed. Root owns
publication and the independent final executor owns actual final-runtime verdicts.
