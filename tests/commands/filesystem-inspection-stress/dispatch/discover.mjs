import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const digest = path => createHash("sha256").update(readFileSync(`${root}${path}`)).digest("hex");
const sourcePaths = readdirSync(`${root}src`, { recursive: true }).filter(path => path.endsWith(".ts")).map(path => `src/${path}`).sort();
const inventoryPath = "benchmarks/reports/baseline-only-20260827/coverage-setup/inventory.json";
const relevantPaths = [...sourcePaths, "package.json", "package-lock.json", inventoryPath];
const snapshot = () => Object.fromEntries(relevantPaths.map(path => [path, digest(path)]));
const before = snapshot();
const startedAt = new Date().toISOString();
const loaded = new Set();
const hooks = registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.startsWith("file:")) {
    const path = fileURLToPath(url);
    if (path.startsWith(`${root}src/`)) loaded.add(path.slice(root.length));
  }
  return result;
} });
const api = await import("../../../../src/index.ts");
const filesystem = new api.MemoryFileSystem();
await filesystem.mkdir("/fixture");
await filesystem.writeFile("/fixture/example.txt", new TextEncoder().encode("dispatch-control\n"));
const bare = new api.Shell({ fs: filesystem, cwd: "/", env: { PATH: "/__absent__" }, limits: { maxCommands: 12, maxOutputBytes: 4096 } });
const agent = new api.Shell({ fs: filesystem, cwd: "/", env: { PATH: "/__absent__" }, limits: { maxCommands: 12, maxOutputBytes: 4096 } }).use(api.agentCommands());
const events = [];
agent.use(async (context, next) => {
  events.push({ command: context.command, args: [...context.args], registered: agent.commands.has(context.command) });
  return next();
});
const rows = [];
try {
  for (const [profile, shell, source] of [
    ["bare", bare, "tree /fixture"],
    ["bare", bare, "file /fixture/example.txt"],
    ["agentCommands", agent, "tree /fixture"],
    ["agentCommands", agent, "file /fixture/example.txt"],
    ["agentCommands-discovery", agent, "type tree file"],
    ["agentCommands-control", agent, "cat /fixture/example.txt"],
  ]) {
    const result = await shell.exec(source);
    rows.push({ profile, source, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") });
  }
} finally {
  await bare.dispose();
  await agent.dispose();
  hooks.deregister();
}
const after = snapshot();
const inventory = JSON.parse(readFileSync(`${root}${inventoryPath}`, "utf8"));
const report = {
  startedAt, finishedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  profile: "current source root import via installed tsx; MemoryFileSystem only; no custom target handlers, functions, aliases, executable VFS fallback, network, or native command oracle",
  execCalls: rows.length,
  modulePaths: Object.fromEntries(["src/commands/tree", "src/commands/file", "tests/commands/tree", "tests/commands/file"].map(path => [path, existsSync(`${root}${path}`)])),
  proposedExports: Object.fromEntries(["treeCommands", "createTreeCommands", "createTreeCommand", "fileCommands", "createFileCommands", "createFileCommand"].map(name => [name, typeof api[name]])),
  standardNames: api.createStandardCommands().map(command => command.name).sort(),
  agentNames: agent.commands.list().map(command => command.name).sort(),
  agentFactoryNames: api.createAgentCommands().map(command => command.name).sort(),
  registryPresence: { bareTree: bare.commands.has("tree"), bareFile: bare.commands.has("file"), agentTree: agent.commands.has("tree"), agentFile: agent.commands.has("file") },
  rows, events,
  historicalInventory: { path: inventoryPath, sha256: before[inventoryPath], capturedAt: inventory.capturedAt, head: inventory.head, counts: inventory.counts, targets: inventory.rows.filter(row => ["tree", "file"].includes(row.name)), caveats: inventory.caveats },
  loadedSourceHashes: Object.fromEntries([...loaded].sort().map(path => [path, { before: before[path], after: after[path] }])),
  relevantInputHashes: Object.fromEntries(relevantPaths.filter(path => !path.startsWith("src/")).map(path => [path, { before: before[path], after: after[path] }])),
  hashedSourceCount: sourcePaths.length,
  changedInputs: relevantPaths.filter(path => before[path] !== after[path]),
};
console.log(JSON.stringify(report, null, 2));
assert.equal(rows.length, 6);
for (const row of rows.slice(0, 4)) {
  assert.equal(row.exitCode, 127);
  assert.equal(row.stdout, "");
  assert.match(row.stderr, /command not found/);
}
assert.equal(rows[5].exitCode, 0);
assert.equal(rows[5].stdout, "dispatch-control\n");
assert.equal(rows[5].stderr, "");
assert.deepEqual(report.registryPresence, { bareTree: false, bareFile: false, agentTree: false, agentFile: false });
assert.equal(events.some(event => event.command === "cat" && event.registered), true);
assert.equal(loaded.has("src/shell/runtime.ts"), true);
assert.deepEqual(report.changedInputs, []);
