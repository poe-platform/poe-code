import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const outer = fs.mkdtempSync("/tmp/strict-n14-v5-launch-");
const out = fs.openSync(path.join(outer, "stdout"), "wx"), err = fs.openSync(path.join(outer, "stderr"), "wx");
const receipt = { outer, observerPid: process.pid, observerParentPid: process.ppid, started: new Date().toISOString(), signals: [], bytes: 0, role: "FRESH_AUTHOR_V2_NOT_RETRY_OF_STOPPED_V1" };
fs.writeFileSync(path.join(outer, "START.json"), JSON.stringify(receipt), { flag: "wx" });
let child, timer, rescue;
try {
  if (process.argv.length !== 3 || process.argv[2] !== "--run") throw new Error("Explicit --run required");
  const own = path.dirname(fileURLToPath(import.meta.url));
  const seal = JSON.parse(fs.readFileSync(path.join(own, "PRESEAL-v4.json")));
  if (process.execPath !== seal.node.path || process.version !== seal.node.version) throw new Error("Pinned Node mismatch");
  const file = path.join(own, "run-v5.mjs"), executor = JSON.parse(fs.readFileSync(path.join(own, "EXECUTOR-v5.json")));
  const row = executor.files.find(row => row.path.endsWith("bash-strict-extension-author-20260829/n14-v4/run-v5.mjs"));
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.size !== row.bytes || stat.size > 1048576) throw new Error("Runner admission");
  if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== row.sha256) throw new Error("Runner hash mismatch");
  Object.assign(receipt, { runnerSha256: row.sha256, sourceSha256: executor.source, node: seal.node, bounds: seal.bounds });
  console.log(JSON.stringify({ outer, source: executor.source, launching: file }));
  child = spawn(seal.node.path, [file, "--run"], { cwd: path.resolve(own, "../../../.."), detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: path.dirname(seal.node.path), HOME: "/tmp", TMPDIR: "/tmp" } });
  receipt.pid = child.pid; receipt.events = [];
  child.once('exit', (code, signal) => receipt.events.push({ event: 'exit', code, signal, at: new Date().toISOString() }));
  for (const [name, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) { stream.once('end', () => receipt.events.push({ event: name + '-end', at: new Date().toISOString() })); stream.once('close', () => receipt.events.push({ event: name + '-close', at: new Date().toISOString() })); }
  const terminate = why => {
    if (receipt.signals.length) return;
    receipt.stop = why; receipt.signals.push("SIGTERM");
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { receipt.signalError = String(error); }
    rescue = setTimeout(() => { receipt.signals.push("SIGKILL"); try { process.kill(-child.pid, "SIGKILL"); } catch (error) { receipt.killError = String(error); } }, 5000);
  };
  timer = setTimeout(() => terminate("outer-deadline"), Math.max(1, Date.parse(seal.masterGrantStarted) + seal.bounds.totalSeconds * 1000 - Date.now()));
  for (const [stream, descriptor] of [[child.stdout, out], [child.stderr, err]]) stream.on("data", bytes => {
    receipt.bytes += bytes.length;
    if (receipt.bytes > 4 * 1024 * 1024) { terminate("outer-capture-cap"); return; }
    try { fs.writeSync(descriptor, bytes); } catch (error) { receipt.captureError = String(error); terminate("capture-failure"); }
  });
  const result = await new Promise(resolve => { child.once("error", error => { receipt.spawnError = String(error); }); child.once("close", (code, signal) => resolve({ code, signal })); });
  Object.assign(receipt, result, { closed: true }); receipt.events.push({ event: 'close', at: new Date().toISOString() });
  process.exitCode = receipt.stop || receipt.captureError || receipt.spawnError || result.signal ? 78 : result.code;
} catch (error) { receipt.error = String(error.stack ?? error); process.exitCode = 78; }
finally {
  clearTimeout(timer); clearTimeout(rescue); fs.closeSync(out); fs.closeSync(err);
  receipt.finished = new Date().toISOString();
  fs.writeFileSync(path.join(outer, "TERMINAL.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify(receipt));
}




