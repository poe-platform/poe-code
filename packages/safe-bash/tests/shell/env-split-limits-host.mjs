import assert from "node:assert/strict";
import { Shell, agentCommands, createMemoryFileSystem } from "../../dist/index.js";
const scenario = process.argv[2];
assert.ok(["split-byte-cap", "split-argument-cap", "split-recursion-cap"].includes(scenario));
const source = scenario === "split-byte-cap" ? "env -S 'report ${BIG}'"
  : scenario === "split-argument-cap" ? `env -S 'report ${"x ".repeat(10001)}'` : "env -S '${LOOP}'";
const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ execution: {
  envSplitLimits: { bytes: 131072, arguments: 10000, expansions: 32, work: 1048576 },
} }));
let entered = 0;
shell.register({ name: "report", async execute() { entered++; return { exitCode: 0 }; } });
try {
  const result = await shell.exec(source, { env: { BIG: "🙂".repeat(40000), LOOP: "-S ${LOOP}" } });
  assert.equal(result.exitCode, 125);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /env: split-string (?:byte|argument|expansion|work) limit exceeded/u);
  assert.equal(entered, 0);
} finally { await shell.dispose(); }
console.log(JSON.stringify({ scenario, passed: true }));
