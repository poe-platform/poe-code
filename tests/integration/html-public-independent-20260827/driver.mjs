import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runPublic } from "./public.mjs";
import { runLifecycle } from "./lifecycle.mjs";
import { sha256, subpath } from "./contract.mjs";

const [mode, identifier, declarationPath] = process.argv.slice(2);
const declaration = JSON.parse(readFileSync(declarationPath));
const require = createRequire(import.meta.url);
const workerModule = require("node:worker_threads");
const OriginalWorker = workerModule.Worker;
const workers = [];
workerModule.Worker = class extends OriginalWorker {
  constructor(filename, options) {
    const path = filename instanceof URL ? fileURLToPath(filename) : resolve(filename);
    assert.equal(path, fileURLToPath(new URL("./node_modules/virtual-bash/dist/commands/regex-execution/worker.js", import.meta.url)), "BOUNDARY:WORKER_LAYOUT");
    if (mode !== "missing-worker") assert.equal(sha256(readFileSync(path)), declaration.workerFiles["dist/commands/regex-execution/worker.js"], "BOUNDARY:WORKER_HASH");
    workers.push(path);
    console.log(`WORKER_CONSTRUCT:${path}`);
    super(filename, options);
  }
};
globalThis.fetch = () => { throw new Error("BOUNDARY:UNEXPECTED_HOST_FETCH"); };
for (const [module, methods] of [
  ["node:http", ["request", "get"]], ["node:https", ["request", "get"]], ["node:http2", ["connect"]],
  ["node:net", ["connect", "createConnection"]], ["node:child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
  ["node:fs", ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "unlink", "unlinkSync", "rename", "renameSync", "mkdir", "mkdirSync", "rm", "rmSync"]],
  ["node:fs/promises", ["writeFile", "appendFile", "unlink", "rename", "mkdir", "rm"]],
]) {
  const builtin = require(module);
  for (const method of methods) builtin[method] = () => { throw new Error(`BOUNDARY:UNEXPECTED_HOST_EFFECT:${module}.${method}`); };
}
syncBuiltinESMExports();

if (mode === "missing-export") {
  await assert.rejects(import(subpath), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
  console.log("BOUNDARY:MISSING_EXPORT");
} else if (mode === "missing-dependency") {
  await assert.rejects(import("virtual-bash"), { code: "ERR_MODULE_NOT_FOUND" });
  console.log("BOUNDARY:MISSING_DEPENDENCY:virtual-bash");
} else if (mode === "poison") {
  await import("virtual-bash");
  assert.fail("poison did not execute");
} else if (mode === "source-fallback") {
  await import(declaration.forbiddenSourceUrl);
  assert.fail("source fallback was admitted");
} else {
  const api = await import("virtual-bash");
  if (mode === "missing-worker") {
    const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
    try {
      const result = await shell.exec("printf 'abc\\n' | grep -E 'a.c'");
      assert.equal(result.stdout, "");
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /regex WORKER_ERROR.*(?:Cannot find module|ENOENT)/);
    } finally { await shell.dispose(); }
    assert.equal(workers.length, 1, "must actually reach worker construction");
    console.log("BOUNDARY:MISSING_WORKER");
  } else {
    assert.equal(mode, "case");
    const details = identifier.startsWith("L") ? await runLifecycle(identifier, api) : await runPublic(identifier, api, declaration);
    if (identifier === "P12") assert.ok(workers.length > 0, "regex control must actually start worker");
    else assert.equal(workers.length, 0, "HTML fixtures do not claim HTML worker ownership");
    console.log(JSON.stringify({ receipt: identifier, result: "PASS_FROZEN_ASSERTIONS_ONLY", details, workers }));
  }
}
