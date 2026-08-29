# H7: portable AR CLI interruption and screenshot validation

Date: August 29, 2026. Owner: AR documentation/QA worker; the root coordinates execution and review. This document supplies the missing **procedure**, not a final-published-HEAD result or publication approval. Do not duplicate Noether's overall-plan review, Nash's H5/H6 work, or Godel's H4 work.

## Status and immutable witness

This documentation-only clone pulled main first and records HEAD `7203ec5135edce5a4da2e603778fd91c3fe042e9`. No production file or original audit payload was read, no runtime was changed or executed here, and no home configuration was touched. The only publication file is this Markdown plan. Its inline commands are instructions for an agent; do not turn them into an executable QA runner or screenshot test.

The approved final AR11 manifest is:

`/Users/kjopek/Workspace/poe-code-safejs-external-checkpoint-integrated/out/safejs-remediation/ar-001-independent-integration/candidate/manifest.json`

SHA-256: `2df0a5d3adb477933055dcabd9988e6aa25f5893f3965f771dc47719b947d1d7`.

AR11 means ten AR files plus the explicitly separate independent report. The witness ran the frozen NUM → AW → OBJ002 → CBI → AR combination over `3180c4c3a1f3d125d1b2916357438e9167694fa6`, not this documentation clone or a future published composite. Its manifest reports five original-source scenarios, ten pending captures, fifteen in-process restores and fifteen fresh-process restores. Those are the already-validated workflow cohort, **not five separate CLI SIGINT scenarios**. H7 uses its two actual OS-SIGINT CLI captures and three inspected screenshots.

All H7 witness files are copied byte-for-byte under the handoff's `witness/` directory. The original immutable witness root is:

`/Users/kjopek/Workspace/poe-code-safejs-external-checkpoint-integrated/out/safejs-remediation/ar-001-independent-integration/`

| Relative witness locator              | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `cli/pending-timer.md`                | `55fb849ae23268c95564020ff644b3a95974c3adc59c6a600fe8e54380574f0f` |
| `cli/pending-timer.ajs`               | `035c94d6bf82460a46e6a7a0dad0a5565381846d1786a32fc1d3a9f8c70e0153` |
| `cli-interruption-protocol.json`      | `cb7447c6fed283b1b0a9e531490300e4649839fcb93cfc7e878849c7a768cd28` |
| `cli-interruption.json`               | `337e2cae90b65133fd9f62e3f6c486a313b8237c20f850dd45e3f6895e8ee630` |
| `cli-built-resume.json`               | `72f048f2c815cf1ded3b471c69bb178df4d22a43f6b03b25f110a1d2eceb7c65` |
| `cli-resume-input-integrity.json`     | `c85e5abcffd8b3381b5a6dc2f96780da79bbbb7d464c48ae62ef935d2c0e3445` |
| `cli-screenshot-pending-capture.json` | `e3a526ac2d9154de1a9dd0dd8864c9f92ae72d169d24276c0b4c9a87f0ae7dd7` |
| `cli-screenshot-command.json`         | `56b3c31a46c8b4420e21541461fb9536c0a7da1860192fea85964aeed711d5f8` |
| `cli-render-screenshots.json`         | `9afa0d5785f321f87bb4f011da091b3d67014dfc2e1c31669d7ef5cc4d239fc9` |
| `cli-visual-verification.json`        | `fd566e28f85e472308127e790a9b6a001bc4d630b0eb4a66e9eb6f2fae37ad96` |
| `cli/sigint-interrupted.png`          | `3c2f905cf4384b43402bdcd926f27cc2991a60c6bf6e43d9d41492f0e3f8d202` |
| `cli/sigint-resumed-built.png`        | `46a11875564b254d155665d7689094f19982fc067308f02e93c60dd31954345f` |
| `cli/sigint-resumed-pty.png`          | `61313b7e84300ab742daa3988d87e1d6d648c5bfd970ae5d1d6ad5c7dcaf612d` |

The handoff artifact manifest indexes all eighteen H7 witness files, including fixture provenance, both journal phases and supplemental summaries. Verify its externally supplied hash before using relocated copies. Read only these explicitly named captured artifacts, not the original audit or a racing publisher workspace.

The old AR witness qualifies AW report hash `5492f3ccca999e952d8484a861e079be0f4bc3bf9a2eb2b32062a236efce4df5`. The root's approved final AW document refresh is manifest `d12519ff306b3e47f110f06db1efb13cf31efd0589df75c61fb6ae29f9e69d6b`; its authorized report replacement is `c433c7ab76f1c8cd97474789a714c5198d6b5f5319b1cfa750696f8ce8d6a62a`. Runtime source is unchanged by that document refresh. Preserve the historical witness; do not restore the old report or require its old whitespace warnings in the final composite. This H7 handoff does not fetch, reintegrate or certify the final AW publication manifest; H2 retains that intake responsibility.

## Fixture and ownership boundary

The mock workflow has no provider/LLM dependency. It only uses schema validation, log output and a genuine finite host timer. Do not mock the CLI, snapshot implementation, timer scheduler or OS signal. There is no guest filesystem, network, process or agent call; host-side evidence writes are confined to the executor's newly created H7 directory.

`pending-timer.md`, exact 146-byte UTF-8 content with final newline:

```markdown
---
kind: ar001-pending-timer
version: 1
---

# AR001 pending timer

Exercise supported CLI interruption and recovery without agent or I/O calls.
```

`pending-timer.ajs`, exact 361-byte UTF-8 content with final newline:

```javascript
import { S } from "schema";
import { info } from "log";
import { sleep } from "time";

export const schema = S.Object({
  kind: S.String(),
  version: S.Number()
});

export default async (frontmatter) => {
  info("AR001 waiting on a native timer");
  await sleep(5000);
  info("AR001 resumed to completion");
  return { kind: frontmatter.kind, total: 36 };
};
```

Use these bytes unchanged for capture and recovery. The unused `version` informational diagnostic is expected. CLI output summarizes result keys; it does not print or independently prove scalar `36`. The existing native/public-API cohort supplies full-value comparisons separately.

## 1. Agent establishes the final execution boundary

Future execution requires the root to provide the exact approved final SHA and an isolated main clone at that SHA. Never infer the final SHA from this document's baseline, read the racing publisher, or checkout/reset another workspace. Record the final SHA/version/build provenance separately. Dependencies and the built `dist/bin.cjs` must already be ready from the final-composite build gate; if not, return to that gate rather than borrowing an older built CLI. Do not run the following blocks in the witness clone.

The agent sets `FINAL_SHA` to the root-provided full SHA and `H7_HANDOFF` to this handoff's relocated evidence directory. On the current machine the latter is `/Users/kjopek/Workspace/poe-code-safejs-ar-final-qa/out/safejs-remediation/ar-final-qa-h7`. Both variables refer to explicit owned/immutable locations, never to home configuration. Preserve the normal environment except the terminal variables documented below. Use one owned shell session, or explicitly repeat these exports and the same working directory in each independent tool invocation; shell exports do not persist between unrelated tool calls.

```sh
: "${FINAL_SHA:?root must provide the approved final SHA}"
: "${H7_HANDOFF:?set the verified immutable handoff directory}"
test "$(git branch --show-current)" = main || exit 1
test "$(git rev-parse HEAD)" = "$FINAL_SHA" || exit 1
export H7_ROOT="out/safejs-remediation/final-composite/$FINAL_SHA/h7"
test ! -e "$H7_ROOT" || exit 1
mkdir -p "$H7_ROOT/first" "$H7_ROOT/second" || exit 1
for H7_CASE in first second; do
  cp "$H7_HANDOFF/witness/cli/pending-timer.md" "$H7_ROOT/$H7_CASE/pending-timer.md" || exit 1
  cp "$H7_HANDOFF/witness/cli/pending-timer.ajs" "$H7_ROOT/$H7_CASE/pending-timer.ajs" || exit 1
done
export H7_CASE=first
```

The agent must stop on any failed command; do not continue after an existing H7 directory is found. Keep failed attempts in separate root-approved evidence directories. No `rm`, broad temporary cleanup, `killall`, `pkill`, process-group signal or reused PID is permitted.

## 2. Agent captures one real owned-child interruption

Run this bounded inline invocation from the final runtime clone, with `H7_CASE=first`. It creates one child with this exact public startup argv, substituting only the owned case directory:

`node --require ./scripts/force-tty.cjs dist/bin.cjs harness run <case>/pending-timer.md --snapshot-path <case>/interrupt.snapshot.json`

The outer environment unsets TERM. The child inherits the normal environment, sets `TERM=xterm-256color` and `FORCE_COLOR=1`, and removes NO_COLOR, matching the validated capture. No HOME or provider configuration is changed. Readiness is the child's stdout marker **AR001 waiting on a native timer**. Only that returned `ChildProcess` receives OS SIGINT, 150ms after readiness. Its 12-second watchdog may terminate only that same still-running owned child on failure; a watchdog result cannot pass. Do not replace this with `EventEmitter.emit`, signal the controller/user/parent, or send SIGUSR1.

```sh
env -u TERM node --input-type=module - > "$H7_ROOT/$H7_CASE/capture.json" 2> "$H7_ROOT/$H7_CASE/capture.stderr" <<'NODE'
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

assert(["first", "second"].includes(process.env.H7_CASE));
const base = path.join(process.env.H7_ROOT, process.env.H7_CASE);
assert(path.resolve(base).startsWith(path.resolve("out/safejs-remediation/final-composite") + path.sep));
const snapshotPath = path.join(base, "interrupt.snapshot.json");
const sourceHash = createHash("sha256").update(await fs.readFile(path.join(base, "pending-timer.ajs"))).digest("hex");
assert.equal(sourceHash, "035c94d6bf82460a46e6a7a0dad0a5565381846d1786a32fc1d3a9f8c70e0153");
assert.equal(await fs.access(snapshotPath).then(() => true, () => false), false);
const argv = ["--require", "./scripts/force-tty.cjs", "dist/bin.cjs", "harness", "run", path.join(base, "pending-timer.md"), "--snapshot-path", snapshotPath];
const env = { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" };
delete env.NO_COLOR;
const started = Date.now();
const child = spawn(process.execPath, argv, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
const events = [];
let stdout = "";
let stderr = "";
let signaledAtMs = null;
let signalSent = false;
let timedOut = false;
let signalTimer;
const finished = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
const watchdog = setTimeout(() => {
  timedOut = true;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}, 12000);
function consume(stream, chunk) {
  const text = chunk.toString();
  events.push({ atMs: Date.now() - started, stream, text });
  if (stream === "stdout") stdout += text;
  else stderr += text;
  if (signaledAtMs === null && stdout.includes("AR001 waiting on a native timer")) {
    signaledAtMs = -1;
    signalTimer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      signaledAtMs = Date.now() - started;
      signalSent = child.kill("SIGINT");
    }, 150);
  }
}
child.stdout.on("data", chunk => consume("stdout", chunk));
child.stderr.on("data", chunk => consume("stderr", chunk));
let capturedSnapshot = null;
let capturedJournal = null;
let capturedAtMs = null;
let aliveAtCapture = false;
let exit;
try {
  for (let iteration = 0; iteration < 600; iteration++) {
    if (signalSent) {
      try {
        const raw = await fs.readFile(snapshotPath, "utf8");
        const pending = JSON.parse(raw).hostCalls?.some(entry => entry.lifecycle === "running" && entry.moduleId === "time" && entry.operation === "sleep");
        if (pending) {
          capturedSnapshot = raw;
          capturedJournal = await fs.readFile(snapshotPath + ".host-calls.json", "utf8");
          capturedAtMs = Date.now() - started;
          aliveAtCapture = child.exitCode === null && child.signalCode === null;
          break;
        }
      } catch {}
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  exit = await finished;
} finally {
  clearTimeout(watchdog);
  clearTimeout(signalTimer);
}
const finalJournal = await fs.readFile(snapshotPath + ".host-calls.json", "utf8").catch(() => null);
const pass = signalSent && !timedOut && exit.code === 130 && exit.signal === null && capturedSnapshot !== null && capturedJournal !== null && finalJournal !== null && aliveAtCapture && stdout.includes("Harness interrupted.") && !stdout.includes("AR001 resumed to completion");
console.log(JSON.stringify({ argv: [process.execPath, ...argv], pid: child.pid, sourceSha256: sourceHash, terminalEnvironment: { TERM: env.TERM, FORCE_COLOR: env.FORCE_COLOR, NO_COLOR: "unset" }, actualSignal: signalSent ? "SIGINT" : null, signaledAtMs, capturedAtMs, aliveAtCapture, timedOut, exit, events, stdout, stderr, capturedSnapshot, capturedJournal, finalJournal, pass }));
assert(pass);
NODE
```

The agent inspects `capture.json`, not merely its wrapper exit: positive owned PID, signal sent after readiness, pending `time.sleep` before the child closes, exit code 130 with no termination signal, and no completion marker. Record the snapshot's genuine version/semantics without editing them. The historical witness used jobs-v6; a final approved format belongs to H5/H6 and must not be forged to resemble that witness. If the public pending-checkpoint shape changes, stop and report the incompatibility rather than adding a private success adapter.

The witness's historical PIDs were **79776** and **84071**. They are evidence only: never send any signal to those literal numbers. Their pending captures were observed 24ms and 11ms after SIGINT respectively, while their original processes were alive. These timings are observations, not tight future timing thresholds.

## 3. Agent prepares genuine pending bytes and resumes

Keep both journal phases. The validated CLI recovery uses the **pending snapshot bytes plus the genuine post-exit journal**: the original native timer can settle while the interrupted process drains. The capture-time journal contains the preceding log; the observed post-exit journal additionally records `time.sleep`. Never invent that entry or call either journal the other phase. This does not replace the separate public API pending-reissue/reconciliation controls.

For historical first capture, the exact pending snapshot is SHA-256 `68fa27fae974c40c3757963bc02f3a916976116a517ca39501482b9d20cc1327`; second capture is `fc005c4edd806ae64e9f0b51b0ece67c75378832271284959b40caf40a772bc1`. Both capture-time journals hash to `8c3d9621fea223626f119a68906990805b69ba218085cfd059fc158287ef0641`; both post-exit journals hash to `74e9aef9fb1eb2c3e84a296924a140b3f674e91dd8a8ead07537bfb21ce865bf`. These raw strings are in the respective command receipt's JSON `stdout`, parsed once to obtain the inner receipt. Convenience `cli/pending-at-interrupt.*` files have different serialization/phase identities and are **not** substitutes for these exact raw strings.

For the new execution, use its own `capture.json`, never replay the old witness as a final-HEAD result. Once its child has exited and the agent has accepted the receipt, run:

```sh
env -u TERM node --input-type=module - <<'NODE'
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const base = path.join(process.env.H7_ROOT, process.env.H7_CASE);
const receipt = JSON.parse(await fs.readFile(path.join(base, "capture.json"), "utf8"));
assert.equal(receipt.pass, true);
assert.equal(receipt.actualSignal, "SIGINT");
const snapshot = path.join(base, "interrupt.snapshot.json");
const hash = value => createHash("sha256").update(value).digest("hex");
await fs.writeFile(path.join(base, "captured-pending.raw.json"), receipt.capturedSnapshot, { flag: "wx" });
await fs.writeFile(path.join(base, "capture-time-journal.raw.json"), receipt.capturedJournal, { flag: "wx" });
await fs.writeFile(path.join(base, "post-exit-journal.raw.json"), receipt.finalJournal, { flag: "wx" });
await fs.writeFile(snapshot, receipt.capturedSnapshot);
await fs.writeFile(snapshot + ".host-calls.json", receipt.finalJournal);
assert.equal(hash(await fs.readFile(snapshot)), hash(receipt.capturedSnapshot));
assert.equal(hash(await fs.readFile(snapshot + ".host-calls.json")), hash(receipt.finalJournal));
await fs.writeFile(path.join(base, "resume-input-hashes.json"), JSON.stringify({ snapshotSha256: hash(receipt.capturedSnapshot), captureTimeJournalSha256: hash(receipt.capturedJournal), resumeJournalSha256: hash(receipt.finalJournal), sourceSha256: receipt.sourceSha256 }, null, 2) + "\n", { flag: "wx" });
NODE
```

Only those two known files owned by the exited child are rewritten to their preserved captured inputs. No broad cleanup or other workspace write is allowed. Never parse/stringify the snapshot itself, alter markers, fabricate receipts, or mutate the fixture between capture and restore.

Run the following bounded direct public CLI resume for the **first** case. Its argv and terminal environment match `cli-built-resume.json`; the extra inline shell is just an owned-child timeout/output recorder.

```sh
env -u TERM FORCE_COLOR=1 node --input-type=module - <<'NODE'
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const base = path.join(process.env.H7_ROOT, process.env.H7_CASE);
const argv = ["--require", "./scripts/force-tty.cjs", "dist/bin.cjs", "harness", "run", path.join(base, "pending-timer.md"), "--snapshot-path", path.join(base, "interrupt.snapshot.json"), "--resume"];
const result = spawnSync(process.execPath, argv, { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 12000, killSignal: "SIGKILL" });
await fs.writeFile(path.join(base, "resume.json"), JSON.stringify({ argv: [process.execPath, ...argv], status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2) + "\n", { flag: "wx" });
assert.equal(result.status, 0);
assert(result.stdout.includes("AR001 resumed to completion"));
assert(result.stdout.includes("Harness passed"));
assert(result.stdout.includes("Usage: 0 spawns"));
NODE
```

The agent verifies exit zero, the completion marker, pass, zero spawns, expected result keys and consumed resume snapshot/sidecar. A remaining snapshot, unexpected provider activity, timeout or changed source hash fails this case. Do not interpret successful CLI recovery as permission to relax default/explicit capture, matching-graph dumpCurrent, or same-run asynchronous callback reentry restrictions; those remain required and their final checks are owned by H5/H6.

## 4. Agent captures and inspects actual screenshots

Render the first case's actual child event transcript and actual built-resume output. The displayed command header is assembled from the recorded argv, not a fabricated shortened invocation. No help-only or constructed success output counts.

```sh
env -u TERM node --input-type=module - <<'NODE'
import fs from "node:fs/promises";
import path from "node:path";
import { renderTerminalPng } from "terminal-png";
const base = path.join(process.env.H7_ROOT, "first");
const interrupt = JSON.parse(await fs.readFile(path.join(base, "capture.json"), "utf8"));
const resume = JSON.parse(await fs.readFile(path.join(base, "resume.json"), "utf8"));
await renderTerminalPng("% " + interrupt.argv.join(" ") + "\n" + interrupt.events.map(event => event.text).join(""), { padding: 20, window: true, output: path.join(base, "sigint-interrupted.png") });
await renderTerminalPng("% " + resume.argv.join(" ") + "\n" + resume.stdout + resume.stderr, { padding: 20, window: true, output: path.join(base, "sigint-resumed-built.png") });
NODE
```

For the third screenshot, the agent sets `export H7_CASE=second` and executes **steps 2 and the pending-byte preparation block of step 3 again**. Do not run the direct resume block for this second case: the screenshot command must consume its still-pending resume input. This is a second fresh owned child/SIGINT receipt, not a copied first snapshot or reused PID.

Use the exact validated screenshot interface and environment, substituting only the owned directory:

```sh
env -u TERM POE_SCREENSHOT_PTY=1 POE_SCREENSHOT_COLUMNS=120 POE_SCREENSHOT_ROWS=32 POE_SCREENSHOT_TIMEOUT_MS=15000 \
  npm run screenshot-poe-code -- \
  --output "$H7_ROOT/second/sigint-resumed-pty.png" \
  harness run "$H7_ROOT/second/pending-timer.md" \
  --snapshot-path "$H7_ROOT/second/interrupt.snapshot.json" --resume \
  > "$H7_ROOT/second/screenshot-command.log" 2>&1
code=$?
printf '%s\n' "$code" > "$H7_ROOT/second/screenshot-command.exit"
test "$code" -eq 0
```

The screenshot wrapper may perform its configured build; retain that output and the actual final SHA rather than substituting an older executable. The agent must open all three PNGs and inspect interruption, recovered completion/pass/zero-spawn output, legibility, clipping and expected informational diagnostics. Record each path/hash/dimensions and visual verdict; existence alone is insufficient. Retain all screenshots and transcripts even on failure. No automated screenshot test is introduced.

## Completion record and remaining execution

Already verified on the approved frozen AR combination: exact fixture bytes; two owned OS-SIGINT captures; a running native timer at capture; interrupted CLI exit 130; direct and screenshot-driven resume exit zero; genuine pending bytes and journal identities; three visually inspected screenshots. All eighteen copied H7 artifacts and the AR11 pin are rehashed by this documentation handoff. The new portable Markdown scaffolding is checked statically against those records; it is not represented as a new runtime run.

Still required on the root-approved **final published runtime**: establish exact final SHA/build provenance; execute steps 1–4 with fresh owned children/captures; inspect the three new screenshots; record source/input/snapshot/journal hashes, exact argv/environment, readiness/PID/signal timing, complete stdout/stderr and exit/error channels. No final runtime execution happened in the documentation clone. H7's missing-procedure blocker is addressed by this handoff, while its final execution verdict remains pending.

The executing agent reports failures without widening scope into provider runs, original audit reads, security research, production repair, legacy-marker rewriting, H4/H5/H6 duplication or publication. Keep final execution evidence under the root-owned final-SHA directory and the executed Markdown report under `docs/plans`. No commits, pushes, branches, home changes or publication authorization are part of this handoff.
