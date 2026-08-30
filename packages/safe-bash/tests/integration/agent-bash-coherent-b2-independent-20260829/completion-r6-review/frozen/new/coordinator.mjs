import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { supervisor } from "./owner.mjs";
import { inventory } from "../legacy/stage-a-r2/common.mjs";
import { unpackVerified } from "./tar.mjs";
import { caps, admit, bounded, grant, ledger, rows, sha } from "./support.mjs";
import { classifyTypes, classifyCases, classifyMutant, classifyRestore, classifyBinding } from "./classify.mjs";

export async function main(grantFile, stageRoot, packet) {
  const authority = grant(JSON.parse(bounded(grantFile, 16384)));
  const recipe = JSON.parse(admit(path.join(stageRoot, "metadata/RECIPE.json"), packet.files.find(row => row.path === "metadata/RECIPE.json")));
  const frozen = JSON.parse(admit(path.join(stageRoot, "metadata/FROZEN-BINDINGS.json"), packet.files.find(row => row.path === "metadata/FROZEN-BINDINGS.json")));
  const root = authority.workRoot;
  const accounting = ledger([root, stageRoot, root + ".outer.raw"], authority.times.deadline);
  const directory = path.join(root, "children"); fs.mkdirSync(directory, { mode: 0o700 });
  const allowedExitCodes = Object.fromEntries(recipe.roles.map(role => [role.role, [role.exitCode]]));
  const manager = supervisor(directory, 1620, caps.childRawBytes, { started: authority.started, roles: recipe.roles.map(role => role.role), allowedExitCodes, io: accounting.io, observe: () => accounting.observe() });
  const completed = []; const classifications = [];
  function put(filename, body, mode) { accounting.write(filename, body); if (mode !== undefined) fs.chmodSync(filename, mode); }
  function closure(packageRoot, members = frozen.packageMembers) {
    const expected = [...members].sort((left, right) => left.path < right.path ? -1 : 1);
    assert.deepEqual(inventory(packageRoot), expected);
  }
  function stageConsumer(layout) {
    const directory = path.join(root, layout, "__consumer");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const row of packet.files.filter(row => row.path.startsWith("legacy/harness/"))) put(path.join(directory, path.basename(row.path)), admit(path.join(stageRoot, row.path), row));
    for (const polarity of ["positive", "negative"]) {
      const row = packet.files.find(row => row.path === `legacy/types/consumer-${polarity}.mts.fixture`);
      put(path.join(directory, `consumer-${polarity}.mts`), admit(path.join(stageRoot, row.path), row));
    }
    return directory;
  }
  const environment = { PATH: path.dirname(process.execPath), HOME: path.join(root, "home"), TMPDIR: path.join(root, "tmp"), TMP: path.join(root, "tmp"), TEMP: path.join(root, "tmp"), LANG: "C", LC_ALL: "C", TZ: "UTC", NODE_OPTIONS: "", NODE_PATH: "", NPM_CONFIG_USERCONFIG: path.join(root, "home/user.npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(root, "home/global.npmrc"), NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
  try {
    for (const name of ["home", "tmp", "cache", "input", "bindings", "traces", "source-built"]) fs.mkdirSync(path.join(root, name), { mode: 0o700 });
    put(environment.NPM_CONFIG_USERCONFIG, ""); put(environment.NPM_CONFIG_GLOBALCONFIG, "");
    const sourceRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/source";
    const toolsRoot = "/private/tmp/safe-bash-coherent-stage-a-20260829-r2/tools";
    assert.deepEqual(inventory(toolsRoot, recipe.toolLinks), recipe.toolInventory);
    for (const row of frozen.selectedInputs) admit(path.join(sourceRoot, row.path), row);
    for (const row of frozen.actualEmitted) admit(row.observedPath, row);
    assert.equal(frozen.producerReceipt.producerClosed, true);
    const compressed = admit(frozen.compressedPackage.path, frozen.compressedPackage, 930368);
    unpackVerified(compressed, frozen.packageMembers);
    const archive = path.join(root, "input/product.tgz"); put(archive, compressed);
    const sourcePackage = path.join(root, "source-built/node_modules/virtual-bash");
    for (const row of frozen.packageMembers) put(path.join(sourcePackage, row.path), admit(path.join(sourceRoot, row.path), row), row.mode);
    closure(sourcePackage);
    const metadata = JSON.parse(admit(path.join(sourcePackage, "package.json"), frozen.packageMembers.find(row => row.path === "package.json")));
    assert.deepEqual(metadata.dependencies ?? {}, {});
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) assert.equal(metadata.scripts?.[hook], undefined);
    stageConsumer("source-built");
    let installedIdentity;
    let mutantCreated = false;
    for (const role of recipe.roles) {
      manager.remaining(); accounting.observe();
      if (role.kind === "install") {
        const installed = path.join(root, "installed"); fs.mkdirSync(installed, { mode: 0o700 }); put(path.join(installed, "package.json"), '{"private":true,"type":"module"}\n');
        const args = ["--experimental-permission", `--allow-fs-read=${root}`, `--allow-fs-read=${toolsRoot}`, `--allow-fs-read=${process.execPath}`, `--allow-fs-write=${installed}`, `--allow-fs-write=${root}/cache`, `--allow-fs-write=${root}/home`, recipe.npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--cache", path.join(root, "cache"), "--prefix", installed, archive];
        await manager.run(role.role, process.execPath, args, { cwd: installed, env: environment, seconds: 120 }); closure(path.join(installed, "node_modules/virtual-bash")); stageConsumer("installed"); completed.push(role.role); continue;
      }
      if (role.layout === "physically-moved" && !installedIdentity) {
        const before = fs.statSync(path.join(root, "installed/node_modules/virtual-bash"));
        fs.renameSync(path.join(root, "installed"), path.join(root, "physically-moved"));
        const after = fs.statSync(path.join(root, "physically-moved/node_modules/virtual-bash"));
        assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(fs.existsSync(path.join(root, "installed")), false);
        installedIdentity = { before: { ino: before.ino, dev: before.dev }, after: { ino: after.ino, dev: after.dev } };
      }
      if (role.layout === "mutant-copy" && !mutantCreated) {
        for (const row of frozen.packageMembers) put(path.join(root, "mutant-copy/node_modules/virtual-bash", row.path), admit(path.join(root, "physically-moved/node_modules/virtual-bash", row.path), row), row.mode);
        stageConsumer("mutant-copy"); mutantCreated = true;
      }
      const layoutRoot = path.join(root, role.layout);
      const packageRoot = path.join(layoutRoot, "node_modules/virtual-bash");
      const consumer = path.join(layoutRoot, "__consumer");
      if (role.kind === "type") {
        const filename = path.join(consumer, `consumer-${role.negative ? "negative" : "positive"}.mts`);
        const args = ["--experimental-permission", `--allow-fs-read=${root}`, `--allow-fs-read=${toolsRoot}`, `--allow-fs-read=${process.execPath}`, recipe.compiler, "--strict", "--exactOptionalPropertyTypes", "--noEmit", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--skipLibCheck", "--pretty", "false", "--listFiles", "--typeRoots", recipe.typeRoots, filename];
        const result = await manager.run(role.role, process.execPath, args, { cwd: layoutRoot, env: environment, seconds: 120 });
        const text = bounded(result.stdout, 4194304).toString() + bounded(result.stderr, 4194304).toString();
        classifications.push(classifyTypes(result, text, filename, recipe.expectedDiagnostics, role.negative, layoutRoot));
        const declarations = text.split("\n").filter(line => line.endsWith(".d.ts") && line.includes("/dist/")); assert.ok(declarations.length > 0);
        for (const file of declarations) { const real = fs.realpathSync(file); assert.ok(real.startsWith(packageRoot + "/dist/")); const row = frozen.packageMembers.find(item => item.path === path.relative(packageRoot, real)); assert.ok(row); admit(real, row); }
        closure(packageRoot); completed.push(role.role); continue;
      }
      const mutation = role.mutation ? recipe.mutations.find(row => row.id === role.mutation) : null;
      const mutatedPath = mutation ? path.join(packageRoot, "dist", mutation.file) : null;
      let original;
      if (role.kind === "mutant") {
        original = admit(mutatedPath, frozen.packageMembers.find(row => row.path === `dist/${mutation.file}`));
        assert.equal(original.toString().split(mutation.before).length, 2);
        const altered = Buffer.from(original.toString().replace(mutation.before, mutation.after)); assert.equal(sha(altered), mutation.prospectiveMutantSha256);
        accounting.replace(mutatedPath, altered); accounting.observe();
      }
      const members = frozen.packageMembers.filter(row => row.path.endsWith(".js")).map(row => ({ ...row, absolute: path.join(packageRoot, row.path), ...(role.kind === "mutant" && row.path === `dist/${mutation.file}` ? { bytes: fs.statSync(mutatedPath).size, sha256: mutation.prospectiveMutantSha256 } : {}) }));
      for (const row of packet.files.filter(row => row.path.startsWith("legacy/harness/") && row.path.endsWith(".mjs"))) members.push({ path: `harness/${path.basename(row.path)}`, absolute: path.join(consumer, path.basename(row.path)), bytes: row.bytes, sha256: row.sha256 });
      if (role.kind === "binding" && role.alteration === "missing") members.splice(members.findIndex(row => row.path === "dist/index.js"), 1);
      if (role.kind === "binding" && role.alteration === "changed") members.find(row => row.path === "dist/shell/parser.js").sha256 = "0".repeat(64);
      const trace = path.join(root, "traces", `${role.role}.jsonl`); const bindingFile = path.join(root, "bindings", `${role.role}.json`);
      const bindingBody = Buffer.from(JSON.stringify({ packageRoot, members, trace }));
      put(bindingFile, bindingBody);
      const args = ["--experimental-permission", `--allow-fs-read=${root}`, `--allow-fs-read=${stageRoot}`, `--allow-fs-read=${process.execPath}`, `--allow-fs-write=${consumer}`, `--allow-fs-write=${root}/tmp`, `--allow-fs-write=${trace}`, "--allow-worker", "--loader", pathToFileURL(path.join(stageRoot, "new/loader.mjs")).href, path.join(consumer, role.script)];
      let result;
      try {
        result = await manager.run(role.role, process.execPath, args, { cwd: layoutRoot, env: { ...environment, PUBLIC_BINDING: bindingFile, PUBLIC_BINDING_BYTES: String(bindingBody.length), PUBLIC_BINDING_SHA256: sha(bindingBody), PRODUCT_ROOT: packageRoot, LAYOUT: role.layout, ...role.environment }, seconds: role.kind === "retained" ? 420 : 60 });
        const output = bounded(result.stdout, 4194304).toString(); const stderr = bounded(result.stderr, 4194304).toString();
        if (role.kind === "binding") classifications.push(classifyBinding(result, output, stderr, rows(bounded(trace, 524288).toString()), role.alteration, packageRoot));
        else if (role.kind === "mutant") classifications.push(classifyMutant(result, rows(output), rows(bounded(trace, 524288).toString()), mutation, recipe.mutantFailures[mutation.id]));
        else if (role.kind === "restore") classifications.push(classifyRestore(result, rows(output), rows(bounded(trace, 524288).toString()), mutation));
        else classifications.push(classifyCases(result, rows(output), role.ids));
      } finally { if (original) { accounting.replace(mutatedPath, original); admit(mutatedPath, frozen.packageMembers.find(row => row.path === `dist/${mutation.file}`)); } }
      closure(packageRoot); completed.push(role.role);
    }
    assert.equal(completed.length, 41); assert.equal(classifications.filter(row => row.cases && !row.loadedMutant).reduce((sum, row) => sum + row.cases, 0), 679);
    for (const row of frozen.selectedInputs) admit(path.join(sourceRoot, row.path), row);
    for (const row of frozen.actualEmitted) admit(row.observedPath, row);
    assert.deepEqual(inventory(toolsRoot, recipe.toolLinks), recipe.toolInventory);
    const retirement = manager.finish();
    accounting.terminal(path.join(root, "RESULT.json"), { schema: "B2_COMPLETED_RUNTIME_ONLY_R3", status: "PASS", retainedCases: 672, typeChecks: 6, expectedNegativeDiagnostics: 24, loadedMutants: 7, restores: 7, bindingRefusals: 2, completed, classifications, installedIdentity, retirement, accounting: accounting.snapshot(), regexWorkersExpectedByStaticClosure: 0, mainLoaderAdmissions: 34, guestEngines: 0, coherentAcceptance: false });
  } catch (error) {
    const retirement = manager.abort(error);
    try { accounting.terminal(path.join(root, "PARTIAL-FAILURE.json"), { schema: "B2_PARTIAL_FAILURE_R3", completed, primary: String(error?.stack ?? error), retirement, successSchema: false, automaticRetry: false }); } catch (secondary) { process.stderr.write(JSON.stringify({ terminalPersistence: false, primary: String(error), secondary: String(secondary) }) + "\n"); }
    throw error;
  }
}
if (process.argv[2] === "--authorized-child") await main(process.argv[3], process.argv[4], JSON.parse(bounded(process.argv[5], 1048576)));
