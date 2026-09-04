import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { parse } from "shell-quote";
import ts from "typescript";

// ── Smoke test commands ──────────────────────────────────────
// Each entry is a command that must exit 0.
// Edit this list to add or remove smoke tests.
const COMMANDS = [
  "poe-code --version",
  "poe-code --help",
  "poe-safejs --help",
  "poe-safe-js --help",
  "poe-code configure --help",
  "poe-code spawn --help",
  "poe-code models --help",
  "poe-code usage --help",
  "poe-code configure claude-code --yes --dry-run --verbose",
  "poe-code configure codex --yes --dry-run --verbose",
  "poe-code configure opencode --yes --dry-run --verbose",
  "poe-code configure kimi --yes --dry-run --verbose",
  "poe-code unconfigure claude-code --dry-run --verbose",
  "poe-code spawn claude-code 'hello' --mode yolo --dry-run --verbose",
  "poe-code login --dry-run",
  "poe-code install --yes --dry-run --verbose",
  "poe-code github-workflows --help",
  "poe-code github-workflows list",
  "poe-code github-workflows prompt-preview github-issue-opened",
  "poe-code github-workflows prompt-preview fix-vulnerabilities"
];
// ─────────────────────────────────────────────────────────────

const program = new Command()
  .description("Run smoke tests against the packed CLI")
  .option("--verbose", "Show command output")
  .option("--prebuilt", "Pack existing build outputs without rebuilding")
  .parse();

const verbose = program.opts().verbose as boolean;

type InstallContext = {
  packageDir: string;
  sdkProjectDir: string;
};

function install(): InstallContext {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "poe-smoke-"));
  console.log("Packing and installing in a temporary consumer...");
  execSync(
    `npm pack --pack-destination "${tmpDir}" --silent${program.opts().prebuilt ? " --ignore-scripts" : ""}`,
    {
      stdio: "pipe"
    }
  );
  const tgz = readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    throw new Error("Failed to locate packed tarball.");
  }

  const packagePath = path.join(tmpDir, tgz);
  const sdkProjectDir = mkdtempSync(path.join(os.tmpdir(), "poe-smoke-sdk-"));
  execSync("npm init -y", { cwd: sdkProjectDir, stdio: "pipe" });
  execSync(`npm install "${packagePath}" --silent`, {
    cwd: sdkProjectDir,
    stdio: "pipe"
  });

  return { packageDir: tmpDir, sdkProjectDir };
}

function cleanup(context: InstallContext) {
  rmSync(context.packageDir, { recursive: true, force: true });
  rmSync(context.sdkProjectDir, { recursive: true, force: true });
}

function run(sdkProjectDir: string): boolean {
  let failed = false;

  for (const cmd of COMMANDS) {
    const arguments_ = parse(cmd);
    if (
      !arguments_.length ||
      !arguments_.every((argument): argument is string => typeof argument === "string")
    ) {
      throw new Error(`Smoke command must contain only literal arguments: ${cmd}`);
    }
    const [binary, ...args] = arguments_;
    const result = spawnSync(path.join(sdkProjectDir, "node_modules", ".bin", binary!), args, {
      cwd: sdkProjectDir,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, POE_CODE_OAUTH_LOGIN: "0" }
    });

    const output = (result.stdout || "") + (result.stderr || "");
    const passed = result.status === 0;

    if (passed) {
      console.log(`  \u2713 ${cmd}`);
    } else {
      console.log(`  \u2717 ${cmd} (exit ${result.status})`);
      failed = true;
    }

    if (verbose || !passed) {
      const lines = output.trimEnd().split("\n");
      for (const line of lines) {
        console.log(`    \u2502 ${line}`);
      }
      console.log();
    }
  }

  return !failed;
}

function runSdkImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "sdk-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { getPoeApiKey, spawn } from "poe-code";',
      'import * as canonical from "poe-code/safe-js";',
      'import * as legacy from "poe-code/safejs";',
      'import * as canonicalCore from "poe-code/safe-js/core";',
      'import * as legacyCore from "poe-code/safejs/core";',
      'import * as canonicalCli from "poe-code/safe-js/cli";',
      'import * as legacyCli from "poe-code/safejs/cli";',
      'if (canonical !== legacy || canonicalCore !== legacyCore || canonicalCli !== legacyCli) throw new Error("SafeJS compatibility routes must resolve to identical module namespaces.");',
      'import { run, dump, Budget, makeAgentModule, makeMcpModule, makeEnvModule, parseEnvConfig, EnvAccessError, inspectSnapshotMigration, migrateSnapshot } from "poe-code/safejs";',
      'import { run as runCore } from "poe-code/safejs/core";',
      'import { runCli } from "poe-code/safejs/cli";',
      'if (runCore !== run) throw new Error("SafeJS entrypoints must share their runtime.");',
      "let referenceReads = 0;",
      'const referenceSource = "const target={value:12}; target.value += (target.value=2); const fixed=1; fixed ||= 2; let large=await readLarge(); large *= 2; return [target.value,fixed,large];";',
      "const referenceBindings = { readLarge: async () => { referenceReads++; return 1e100; } };",
      "const referenceResult = await run(referenceSource, {bindings: referenceBindings});",
      "const referenceSnapshot = JSON.parse(await dump(referenceResult));",
      "const referenceReplay = await runCore(referenceSource, {bindings: referenceBindings, snapshot: referenceSnapshot});",
      'if (JSON.stringify(referenceResult.returnValue) !== "[14,1,2e+100]" || JSON.stringify(referenceReplay.returnValue) !== "[14,1,2e+100]" || referenceReads !== 1 || referenceSnapshot.executionSemantics !== "jobs-v7") throw new Error("SafeJS reference evaluation or numeric checkpoint replay failed.");',
      "let effects = 0;",
      'const recoverySource = "effect(); let total=0; for(let index=0; index<50; index++) total += index; return total;";',
      "const recoveryBindings = { effect() { effects++; } };",
      "const failedRun = runCore(recoverySource, { bindings: recoveryBindings, budget: new Budget({maxSteps: 40}) });",
      'try { await failedRun; throw new Error("Expected budget exhaustion."); } catch(error) { if (error.code !== "budgetExceeded") throw error; }',
      'const recovered = await run(recoverySource, { bindings: recoveryBindings, snapshot: JSON.parse(await dump(failedRun, {onFailure: "checkpoint"})), budget: new Budget({maxSteps: 5000}) });',
      'if (!recovered.ok || recovered.returnValue !== 1225 || effects !== 1) throw new Error("Failed checkpoint recovery repeated an effect.");',
      "const predecessor = JSON.parse(await dump(recovered));",
      "const inspection = inspectSnapshotMigration(predecessor, {source: recoverySource});",
      'const continuationSource = "return import.meta.migration.total + 1;";',
      "const migration = migrateSnapshot(predecessor, {source: recoverySource, targetSource: continuationSource, state: {total: 1225}, reconciliation: {checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: []}});",
      "const continuation = await runCore(continuationSource, {snapshot: migration});",
      'if (continuation.returnValue !== 1226 || effects !== 1 || continuation.snapshot.migration.history.length !== 1) throw new Error("Checkpoint migration failed or repeated an old effect.");',
      "let calls = 0;",
      'const agent = makeAgentModule(async () => { calls++; return { exitCode: 7, stdout: "partial", stderr: "failed", summary: "partial", durationMs: 1 }; });',
      'const source = \'import {spawn} from "agent"; try { await spawn("test", {prompt:"Run",check:true}); } catch(error) { return [error.result.exitCode,error instanceof Error]; }\';',
      "const options = { modules: { agent } };",
      "const first = await run(source, options);",
      "const restored = await run(source, { ...options, snapshot: JSON.parse(await dump(first)) });",
      'if (JSON.stringify(first.returnValue) !== "[7,true]" || JSON.stringify(restored.returnValue) !== "[7,true]" || calls !== 1) throw new Error("SafeJS checked-error replay failed.");',
      'let output = "";',
      'const status = await runCli(["fixture.ajs"], { readFile: async () => source, stat: async () => ({ isFile: () => true }), modulesFor: () => ({ agent }), stdout: { write: (value) => { output += value; } }, stderr: { write: (value) => { throw new Error(value); } } });',
      'if (status !== 0 || JSON.stringify(JSON.parse(output).returnValue) !== "[7,true]" || calls !== 2) throw new Error("SafeJS SDK and CLI error registries differ.");',
      "let mcpCalls = 0, mcpCloses = 0;",
      'const mcp = makeMcpModule({ servers: { test: { url: "https://example.invalid/mcp" } }, fetch: async (_url, init) => {',
      '  if (init.method === "GET") return new Response(null, { status: 405 });',
      '  if (init.method === "DELETE") { mcpCloses++; return new Response(null, { status: 204 }); }',
      "  const request = JSON.parse(init.body);",
      "  if (request.id === undefined) return new Response(null, { status: 202 });",
      '  if (request.method === "tools/call") mcpCalls++;',
      '  const result = request.method === "initialize" ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "smoke", version: "1" } } : { content: [{ type: "text", text: "mcp-ok" }] };',
      '  return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json", "mcp-session-id": "smoke" } });',
      "} });",
      'const mcpSource = \'import {client,server} from "mcp"; const service=await client(server("test")); return (await service.tool("echo",{})).content[0].text;\';',
      "const mcpResult = await run(mcpSource, { modules: { mcp } });",
      "const mcpReplay = await run(mcpSource, { modules: { mcp }, snapshot: JSON.parse(await dump(mcpResult)) });",
      'if (mcpResult.returnValue !== "mcp-ok" || mcpReplay.returnValue !== "mcp-ok" || mcpCalls !== 1 || mcpCloses !== 1) throw new Error("Managed MCP replay or cleanup failed.");',
      'let mcpOutput = "";',
      'const mcpStatus = await runCli(["mcp.ajs"], { readFile: async () => mcpSource, stat: async () => ({ isFile: () => true }), modulesFor: () => ({ mcp }), stdout: { write: value => { mcpOutput += value; } }, stderr: { write: value => { throw new Error(value); } } });',
      'if (mcpStatus !== 0 || JSON.parse(mcpOutput).returnValue !== "mcp-ok" || mcpCalls !== 2 || mcpCloses !== 2) throw new Error("MCP SDK and CLI resource scopes differ.");',
      'const envOptions = parseEnvConfig(\'{"allow":["TOKEN","MISSING"],"values":{"TOKEN":"granted"}}\');',
      "const env = makeEnvModule(envOptions);",
      'try { env.get("DENIED"); throw new Error("Missing environment denial."); } catch(error) { if (!(error instanceof EnvAccessError)) throw error; }',
      'const envSource = \'import {get} from "env"; try { get("DENIED"); } catch(error) { return [get("TOKEN"),get("MISSING"),error.name,error.code,error.variable]; }\';',
      "const envResult = await run(envSource, { modules: { env } });",
      "const envReplay = await run(envSource, { modules: { env: makeEnvModule([]) }, snapshot: JSON.parse(await dump(envResult)) });",
      'const envExpected = JSON.stringify(["granted",null,"EnvAccessError","ENV_ACCESS_DENIED","DENIED"]);',
      'if (JSON.stringify(envResult.returnValue) !== envExpected || JSON.stringify(envReplay.returnValue) !== envExpected) throw new Error("Environment denial or replay failed.");',
      'let envOutput = "";',
      'const envStatus = await runCli(["env.ajs"], { env: envOptions, readFile: async () => envSource, stat: async () => ({ isFile: () => true }), stdout: { write: value => { envOutput += value; } }, stderr: { write: value => { throw new Error(value); } } });',
      'if (envStatus !== 0 || JSON.stringify(JSON.parse(envOutput).returnValue) !== envExpected) throw new Error("Environment SDK and CLI differ.");',
      'if (typeof spawn !== "function") {',
      '  throw new Error("Expected spawn export to be a function.");',
      "}",
      "const key = await getPoeApiKey();",
      'if (key !== "smoke-test-key") {',
      "  throw new Error(`Unexpected API key: ${key}`);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const label = "poe-code sdk import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      POE_API_KEY: "smoke-test-key"
    }
  });

  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0;

  if (passed) {
    console.log(`  \u2713 ${label}`);
  } else {
    console.log(`  \u2717 ${label} (exit ${result.status})`);
  }

  if (verbose || !passed) {
    const lines = output.trimEnd().split("\n");
    for (const line of lines) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }

  return passed;
}

function runSafeFsImportSmoke(sdkProjectDir: string): boolean {
  writeFileSync(
    path.join(sdkProjectDir, "safe-fs-peer.mjs"),
    'export * from "poe-code/safe-fs";\n',
    "utf8"
  );
  const scriptPath = path.join(sdkProjectDir, "safe-fs-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import assert from "node:assert/strict";',
      'import { readFileSync, readdirSync } from "node:fs";',
      'import * as fs from "poe-code/safe-fs";',
      'import * as peer from "./safe-fs-peer.mjs";',
      'import { run } from "poe-code/safejs";',
      'import { run as runCore } from "poe-code/safejs/core";',
      'import { findBundleIssues } from "./node_modules/poe-code/packages/package-lint/dist/bundle-policy.js";',
      "assert.equal(run, runCore);",
      'assert.equal((await run("return 1;")).returnValue, 1);',
      "assert.equal(fs.FsError, peer.FsError);",
      'assert.ok(new peer.FsError("ENOENT") instanceof fs.FsError);',
      "const memory = new fs.MemoryFileSystem();",
      'await memory.writeFile("/local", new Uint8Array([1]));',
      'const remote = new peer.S3FileSystem({ bucket: "proof", transport: new peer.MockS3Client({ buckets: ["proof"] }) });',
      'await remote.writeFile("/remote", new Uint8Array([2]));',
      'assert.equal(await memory.compareEntry("/local", remote, "/remote"), "distinct");',
      'assert.equal(await memory.compareEntry("/local", new peer.ReadOnlyFileSystem(remote), "/remote"), "distinct");',
      'await assert.rejects(memory.readFile("/missing"), error => fs.isFsError(error, "ENOENT") && error instanceof peer.FsError);',
      'const root = new URL("./node_modules/poe-code/", import.meta.url);',
      'const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));',
      'const metafile = JSON.parse(readFileSync(new URL("dist/metafile.json", root), "utf8"));',
      "const packed = new Set();",
      'function visit(directory, prefix = "") { for (const entry of readdirSync(directory, { withFileTypes: true })) {',
      '  if (entry.name === "node_modules") continue;',
      "  const filename = prefix + entry.name;",
      '  if (entry.isDirectory()) visit(new URL(entry.name + "/", directory), filename + "/");',
      "  else if (entry.isFile()) packed.add(filename);",
      "} }",
      "visit(root);",
      'assert.deepEqual(findBundleIssues(manifest, new Set(["@poe-code/safe-fs"]), metafile, packed), []);',
      ""
    ].join("\n"),
    "utf8"
  );
  const runtime = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf8",
    timeout: 30_000
  });
  if (runtime.status !== 0) {
    console.log(`  ✗ canonical safe-fs runtime: ${runtime.stdout ?? ""}${runtime.stderr ?? ""}`);
    return false;
  }
  const consumerPath = path.join(sdkProjectDir, "safe-fs-types.mts");
  writeFileSync(
    consumerPath,
    [
      'import { FsError, MemoryFileSystem, createNodeFsBridge, type FileSystem } from "poe-code/safe-fs";',
      'import { makeFsModule } from "poe-code/safejs";',
      "const filesystem: FileSystem = new MemoryFileSystem();",
      "const bridge = createNodeFsBridge(filesystem);",
      'const error: FsError = new FsError("ENOENT");',
      "void [bridge, error, makeFsModule];",
      ""
    ].join("\n"),
    "utf8"
  );
  for (const resolution of [ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler]) {
    const program = ts.createProgram([consumerPath], {
      moduleResolution: resolution,
      module:
        resolution === ts.ModuleResolutionKind.NodeNext
          ? ts.ModuleKind.NodeNext
          : ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ["node"],
      typeRoots: [path.resolve("node_modules/@types")]
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) {
      console.log(
        `  ✗ canonical safe-fs declarations: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`
      );
      return false;
    }
  }
  console.log("  ✓ canonical safe-fs public identity and portable declarations");
  return true;
}

function runCredentialsImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "credentials-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { getPoeApiKey } from "poe-code/credentials";',
      "const key = await getPoeApiKey();",
      'if (key !== "smoke-test-key") {',
      "  throw new Error(`Unexpected API key: ${key}`);",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const label = "poe-code credentials import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000,
    env: {
      ...process.env,
      POE_API_KEY: "smoke-test-key"
    }
  });

  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0 && output.length === 0;

  if (passed) {
    console.log(`  \u2713 ${label}`);
  } else {
    console.log(`  \u2717 ${label} (exit ${result.status})`);
  }

  if (verbose || !passed) {
    const lines = output.trimEnd().split("\n");
    for (const line of lines) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }

  return passed;
}

function runConfigImportSmoke(sdkProjectDir: string): boolean {
  const scriptPath = path.join(sdkProjectDir, "config-smoke.mjs");
  writeFileSync(
    scriptPath,
    [
      'import { createConfigStore } from "poe-code/config";',
      'import { createMockFs } from "poe-code/config/testing";',
      'if (typeof createConfigStore !== "function" || typeof createMockFs !== "function") {',
      '  throw new Error("Expected released config APIs to be functions.");',
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const label = "poe-code config import smoke";
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: sdkProjectDir,
    encoding: "utf-8",
    timeout: 30_000
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const passed = result.status === 0 && output.length === 0;

  console.log(passed ? `  \u2713 ${label}` : `  \u2717 ${label} (exit ${result.status})`);
  if (verbose || !passed) {
    for (const line of output.trimEnd().split("\n")) {
      console.log(`    \u2502 ${line}`);
    }
    console.log();
  }
  return passed;
}

const installContext = install();
try {
  const ok =
    run(installContext.sdkProjectDir) &&
    runSdkImportSmoke(installContext.sdkProjectDir) &&
    runSafeFsImportSmoke(installContext.sdkProjectDir) &&
    runCredentialsImportSmoke(installContext.sdkProjectDir) &&
    runConfigImportSmoke(installContext.sdkProjectDir);
  if (ok) {
    console.log("\nAll smoke tests passed.");
  } else {
    console.log("\nSmoke tests failed!");
    process.exitCode = 1;
  }
} finally {
  cleanup(installContext);
}
