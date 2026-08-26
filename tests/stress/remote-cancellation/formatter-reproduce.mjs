import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const owned = "tests/stress/remote-cancellation";
const outputPath = `${owned}/formatter-prefixed-failure.json`;
assert.equal(existsSync(outputPath), false, "immutable evidence already exists");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const sha = content => createHash("sha256").update(content).digest("hex");
const runner = `${owned}/run.mjs`;
const before = { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), sha256: sha(readFileSync(runner)),
  blob: git("hash-object", runner), lastChanged: git("log", "-1", "--format=%H", "--", runner) };
assert.equal(before.sha256, sha(execFileSync("git", ["show", `4e26ce0:${runner}`])));
const nodeOptions = `--import=tsx --import=./${owned}/recheck90ddc74-register.mjs`;
const env = { ...process.env, NODE_OPTIONS: nodeOptions, AUDIT_REPEATS: "1" };
delete env.AUDIT_VERBOSE;
delete env.AUDIT_CASE;
const result = spawnSync(process.execPath, [runner], { env, encoding: "utf8", timeout: 75_000, maxBuffer: 8 * 1024 * 1024 });
const evidence = { purpose: "Bounded literal nonverbose formatter failure, not product acceptance", before,
  command: `env -u AUDIT_VERBOSE -u AUDIT_CASE NODE_OPTIONS='${nodeOptions}' AUDIT_REPEATS=1 node ${runner}`,
  productRevision: git("rev-parse", "90ddc74"), node: process.version,
  wrapper: { exitCode: result.status, signal: result.signal, error: result.error?.message ?? null },
  childExitCodes: [...(result.stdout ?? "").matchAll(/^REPLAY \d+: exit=(\d+)$/gm)].map(match => Number(match[1])),
  stdout: result.stdout, stderr: result.stderr,
  after: { at: new Date().toISOString(), sha256: sha(readFileSync(runner)) },
  limits: "75s capture; unchanged runner 60s child-process-group watchdog; child exit 0 is distinct from wrapper failure. Full counts unavailable after formatter crash; no acceptance claimed." };
execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${outputPath}\n${JSON.stringify(evidence, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`]);
console.log(JSON.stringify(evidence, null, 2));
assert.equal(evidence.after.sha256, before.sha256);
assert.equal(result.status, 1);
assert.deepEqual(evidence.childExitCodes, [0]);
assert.match(result.stderr, /SyntaxError: Expected ',' or '\]' after array element in JSON/);
assert.match(result.stderr, /run\.mjs:41:29/);
