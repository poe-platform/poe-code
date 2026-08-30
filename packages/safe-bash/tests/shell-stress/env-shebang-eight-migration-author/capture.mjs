import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../..");
const [revision, label] = process.argv.slice(2);
assert.ok(revision && /^[a-f0-9]{40}$/.test(revision));
assert.ok(label && /^[a-z0-9-]+$/.test(label));
const output = join(directory, label);
assert.equal(existsSync(output), false, "captures are append-only");
mkdirSync(output);
const scratch = mkdtempSync(join(directory, ".scratch-"));
const source = join(scratch, "source");
mkdirSync(source);
mkdirSync(join(scratch, "tmp"));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const owned = ["tests/shell-stress/env-split-author/resume-host.ts", "tests/shell/errexit-host.test.ts", "tests/shell/expanded-gaps-env-host.test.ts"];
const inputs = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ...owned, "tests/shell/env-shebang.test.ts", "tests/shell/helpers.ts"];
const environment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: join(scratch, "tmp"), TSX_DISABLE_CACHE: "1" };
const report = { revision, parent: git("rev-parse", `${revision}^`).toString().trim(), label, started: new Date().toISOString(), runnerSha256: digest(readFileSync(fileURLToPath(import.meta.url))), node: process.version, platform: process.platform, arch: process.arch, executable: process.execPath, environment, source, scratch, inputs, commands: [], nativeExecuted: false };
const alive = target => {
  try { process.kill(target, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};
async function run(name, executable, args, cwd = source, timeout = 30000, input) {
  const row = { name, executable, args, cwd, timeout, started: new Date().toISOString(), timeoutHit: false, overflow: false };
  report.commands.push(row);
  const child = spawn(executable, args, { cwd, env: environment, detached: true, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  row.pid = child.pid;
  const kill = () => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const stdout = [];
  const stderr = [];
  let count = 0;
  const timer = setTimeout(() => { row.timeoutHit = true; kill(); }, timeout);
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on("data", bytes => {
    count += bytes.length;
    if (count <= 4 * 1024 * 1024) chunks.push(Buffer.from(bytes));
    else { row.overflow = true; kill(); }
  });
  if (input) child.stdin.end(input);
  try {
    await new Promise((resolveExit, reject) => {
      child.on("error", reject);
      child.on("close", (status, signal) => { row.status = status; row.signal = signal; resolveExit(); });
    });
  } finally {
    clearTimeout(timer);
    kill();
  }
  for (let attempt = 0; attempt < 100 && (alive(child.pid) || alive(-child.pid)); attempt++) await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  row.pidAbsent = !alive(child.pid);
  row.groupAbsent = !alive(-child.pid);
  row.finished = new Date().toISOString();
  const text = Buffer.concat(stdout).toString();
  writeFileSync(join(output, `${name}.stdout`), Buffer.concat(stdout));
  writeFileSync(join(output, `${name}.stderr`), Buffer.concat(stderr));
  row.stdoutSha256 = digest(Buffer.concat(stdout));
  row.stderrSha256 = digest(Buffer.concat(stderr));
  row.tap = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  assert.equal(row.timeoutHit, false);
  assert.equal(row.overflow, false);
  assert.equal(row.signal, null);
  assert.ok(row.pidAbsent && row.groupAbsent);
  return { row, text };
}
function inventory(location, prefix = "") {
  const entries = {};
  for (const entry of readdirSync(location, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!prefix && ["node_modules", "dist"].includes(entry.name)) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) { entries[relative + "/"] = "directory"; Object.assign(entries, inventory(join(location, entry.name), relative + "/")); }
    else { assert.ok(entry.isFile(), `unexpected link/nonregular input ${relative}`); entries[relative] = digest(readFileSync(join(location, entry.name))); }
  }
  return entries;
}
try {
  const archive = git("archive", "--format=tar", revision, "--", ...inputs);
  report.archiveSha256 = digest(archive);
  assert.equal((await run("extract", "/usr/bin/tar", ["-xf", "-"], source, 30000, archive)).row.status, 0);
  symlinkSync(join(root, "node_modules"), join(source, "node_modules"), "dir");
  report.tools = Object.fromEntries(["tsx", "typescript", "@types/node", "esbuild"].map(name => {
    const bytes = readFileSync(join(root, "node_modules", name, "package.json"));
    return [name, { version: JSON.parse(bytes).version, packageJsonSha256: digest(bytes) }];
  }));
  report.sourceBefore = inventory(source);
  report.historicalProductDelta = git("diff", "--name-status", "ea409a6b49d5c1523e3238f0384048218b559c4c", revision, "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json").toString();
  const resume = readFileSync(join(source, owned[0]), "utf8");
  const errexit = readFileSync(join(source, owned[1]), "utf8");
  const expanded = readFileSync(join(source, owned[2]), "utf8");
  assert.ok(resume.includes('Buffer.from("#!/usr/bin/env bash -e\\nprintf forbidden > marker\\n")'));
  assert.ok(errexit.includes('Buffer.from(`${header}\\nprintf BAD\\n`)'));
  assert.ok(expanded.includes('Buffer.from(`#!${header}\\nprintf forbidden`)'));
  for (const header of ["#!/usr/bin/env bash -e", "#!/usr/bin/env -S bash -e"]) assert.ok(errexit.includes(JSON.stringify(header)));
  for (const header of ["/usr/bin/env bash -e", "/usr/bin/env -S bash -e", "/usr/bin/env python", "/usr/bin/env", "/usr/bin/env bash\r"]) assert.ok(expanded.includes(JSON.stringify(header)));
  const original = JSON.parse(readFileSync(join(root, "tests/shell-stress/env-shebang-integration-review/guarded-ea409a6b-20260827-review1-controls/original-assertion-observations.json"))).originals;
  report.literalInputs = original.map(row => {
    const body = row.source.slice(row.source.indexOf("\n") + 1);
    assert.ok(["printf forbidden > marker\n", "printf BAD\n", "printf forbidden"].includes(body));
    return { id: row.id, script: row.source, scriptBase64: Buffer.from(row.source).toString("base64"), scriptSha256: digest(row.source), body, containsFailingCommand: false, cwd: row.cwd, command: row.command, file: row.file, mode: "0755" };
  });
  assert.equal(report.literalInputs.length, 8);
  const probe = `import assert from "node:assert/strict";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, writeText } from ${JSON.stringify(join(source, "src/index.ts"))};
const inputs = ${JSON.stringify(report.literalInputs)};
const observations = [];
for (const input of inputs) {
  const fs = createMemoryFileSystem();
  const core = input.id === "core-literal";
  if (core) { await fs.mkdir("/work"); await fs.mkdir("/other"); }
  const shell = new Shell(core ? {fs, cwd:"/work",env:{PUBLIC:"parent value",A:"ancestor",PATH:""}} : {fs}).use(agentCommands());
  const calls = []; let entered = 0; const failures = []; const unhandled = error => failures.push(error);
  if (core || input.id.startsWith("errexit")) shell.use(async (context, next) => { calls.push(context.command); return next(); });
  if (core) {
    shell.register({name:"report",async execute(context){ entered++; await writeText(context.stdout,JSON.stringify({env:context.env,args:context.args,cwd:context.cwd,origin:context.stdinIsDefault})+"\\n");return {exitCode:0}; }});
    shell.register({name:"emit",async execute(context){ entered++; await writeText(context.stdout,"abcd");return {exitCode:0}; }});
    process.on("unhandledRejection",unhandled);
  }
  const observation = {id:input.id};
  try {
    await fs.writeFile(input.file,Buffer.from(input.script),{mode:0o755});
    try { const result = await shell.exec(input.command); observation.result = {status:result.exitCode,stdout:result.stdout,stderr:result.stderr,stdoutBase64:Buffer.from(result.stdoutBytes).toString("base64"),stderrBase64:Buffer.from(result.stderrBytes).toString("base64")}; }
    catch(error) { observation.rejection = {name:error.name,message:error.message,limit:error.limit,publicShellLimitError:error instanceof ShellLimitError}; }
    observation.entries = (await fs.readdir(input.cwd)).map(entry=>entry.name);
    observation.scriptUnchanged = Buffer.from(await fs.readFile(input.file)).equals(Buffer.from(input.script));
    assert.deepEqual(observation.entries,["script"]); assert.equal(observation.scriptUnchanged,true);
    observation.calls = calls; observation.entered = entered; assert.deepEqual(failures,[]);
  } finally {await shell.dispose();observation.disposed=true;if(core)process.off("unhandledRejection",unhandled);}
  observations.push(observation);
}
console.log(JSON.stringify(observations,null,2));
`;
  writeFileSync(join(scratch, "probe.mjs"), probe);
  writeFileSync(join(output, "probe.mjs.data"), probe);
  const observed = await run("observations", process.execPath, ["--unhandled-rejections=strict", "--import", join(root, "node_modules/tsx/dist/loader.mjs"), join(scratch, "probe.mjs")]);
  assert.equal(observed.row.status, 0);
  report.observations = JSON.parse(observed.text);
  const canonical = await run("canonical", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", owned[1], owned[2]]);
  report.canonicalStatus = canonical.row.status;
  const scenarios = [...new Set([...resume.matchAll(/scenario === "([^"]+)"/g)].map(match => match[1]))];
  for (const scenario of scenarios) await run(`resume-${scenario}`, process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", owned[0], scenario], source, 6000);
  assert.equal((await run("shebang-controls", process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "tests/shell/env-shebang.test.ts"])).row.status, 0);
  assert.equal((await run("build", process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"])).row.status, 0);
  assert.equal((await run("strict-owned", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...owned])).row.status, 0);
  report.sourceAfter = inventory(source);
  assert.deepEqual(report.sourceAfter, report.sourceBefore);
  report.sourceUnchanged = true;
  report.sourceInventoryScope = "Full recursive source regular-file keys/hashes and directory entries, unexpected symlinks rejected; only root dist and node_modules excluded. Detects new source files/directories/links, not metadata changes.";
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
  report.scratchAbsent = !existsSync(scratch);
  report.processesAbsent = report.commands.every(row => row.pidAbsent && row.groupAbsent);
  report.finished = new Date().toISOString();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ revision, label, error: report.error, canonical: report.commands.find(row => row.name === "canonical")?.tap, resume: report.commands.filter(row => row.name.startsWith("resume-")).map(row => ({name:row.name,status:row.status})), controls: report.commands.find(row => row.name === "shebang-controls")?.tap, scratchAbsent: report.scratchAbsent, processesAbsent: report.processesAbsent }, null, 2));
}
