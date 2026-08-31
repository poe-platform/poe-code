import assert from "node:assert/strict";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { environment, json, manifest, run, step } from "./harness.mjs";
import { sha256 } from "./current-profile.mjs";
import { bindPeerArtifact, stagePeerArtifact, assertPeerArtifact, assertPeerDeclarationFiles, assertConsumerDeclarationFiles } from "../qualified-current-release/peer.mjs";
import { createBuiltPackageBinding, assertBuiltConsumerResolution } from "../../../scripts/typecheck-consumers.mjs";

export function publicChecks(report, { peerArtifact } = {}) {
  const { root, directory } = report;
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  step(report, "isolated-build", process.execPath, [compiler, "-p", "tsconfig.build.json"]);
  const declarationBinding = createBuiltPackageBinding(root);
  const peer = bindPeerArtifact({ root, artifact: peerArtifact, declarations: declarationBinding });
  json(join(directory, "packed-peer-artifact.json"), peer);
  report.builtFiles = manifest(root, "dist");
  json(join(directory, "built-files.json"), report.builtFiles);
  step(report, "current-registry", process.execPath, ["--import", "tsx", "--test", "tests/plugins/agent-commands.test.ts"]);
  const npmEnvironment = { ...environment, npm_config_cache: join(directory, "npm-cache"), npm_config_userconfig: join(directory, "npmrc"), npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
  writeFileSync(npmEnvironment.npm_config_userconfig, "");
  const npm = step(report, "npm-version", "npm", ["--version"], root, { env: npmEnvironment });
  report.npmVersion = npm.stdout.trim();
  const packs = [];
  for (const label of ["first", "repeat"]) {
    const destination = join(directory, `pack-${label}`);
    mkdirSync(destination);
    const packed = step(report, `npm-pack-${label}`, "npm", ["pack", "--offline", "--json", "--pack-destination", destination], root, { env: npmEnvironment });
    const metadata = JSON.parse(packed.stdout);
    assert.equal(metadata.length, 1);
    const artifact = join(destination, metadata[0].filename);
    packs.push({ metadata: metadata[0], artifact, sha256: sha256(readFileSync(artifact)) });
  }
  assert.equal(packs[0].sha256, packs[1].sha256, "repeated committed-source npm pack bytes differ");
  report.packs = packs;
  json(join(directory, "packs.json"), packs);
  const lifecycle = join(directory, "lifecycle-probe");
  mkdirSync(lifecycle);
  cpSync(join(root, "dist"), join(lifecycle, "dist"), { recursive: true });
  const packageJson = JSON.parse(readFileSync(join(root, "package.json")));
  packageJson.scripts.prepare = "node prepare-probe.mjs";
  json(join(lifecycle, "package.json"), packageJson);
  writeFileSync(join(lifecycle, "prepare-probe.mjs"), 'import { appendFileSync } from "node:fs"; appendFileSync("prepare-observed.txt", "prepare\\n");\n');
  const lifecycleObservations = [];
  for (const flags of [[], ["--ignore-scripts"]]) {
    const before = existsSync(join(lifecycle, "prepare-observed.txt")) ? readFileSync(join(lifecycle, "prepare-observed.txt"), "utf8") : "";
    step(report, flags.length ? "lifecycle-ignore-scripts" : "lifecycle-normal", "npm", ["pack", "--offline", "--json", ...flags], lifecycle, { env: npmEnvironment });
    const after = readFileSync(join(lifecycle, "prepare-observed.txt"), "utf8");
    lifecycleObservations.push({ flags, before, after, prepareExecuted: after.length > before.length });
  }
  assert.equal(lifecycleObservations[0].prepareExecuted, true);
  if (report.npmVersion === "10.9.7") assert.equal(lifecycleObservations[1].prepareExecuted, true, "npm 10.9.7 prepare behavior must be recorded, not assumed suppressed");
  report.lifecycle = { scope: "isolated package copy with added prepare sentinel; actual release package has no added scripts", observations: lifecycleObservations };
  json(join(directory, "lifecycle.json"), report.lifecycle);
  const initial = join(directory, "consumer-original");
  const moved = join(directory, "consumer-moved");
  const modules = join(initial, "node_modules");
  mkdirSync(modules, { recursive: true });
  step(report, "extract-pack", "/usr/bin/tar", ["-xzf", packs[0].artifact, "-C", modules]);
  renameSync(join(modules, "package"), join(modules, "virtual-bash"));
  json(join(initial, "package.json"), { name: "stream-five-offline-consumer", private: true, type: "module" });
  stagePeerArtifact(peer, initial);
  for (const [source, target] of [["consumer.mjs", "consumer.mjs"], ["positive.ts.fixture", "positive.ts"], ["negative.ts.fixture", "negative.ts"]]) copyFileSync(join(root, "tests/plugins/stream-five-public", source), join(initial, target));
  renameSync(initial, moved);
  const options = { target: "ES2023", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, skipLibCheck: false, noEmit: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")] };
  json(join(moved, "tsconfig.positive.json"), { compilerOptions: options, files: ["positive.ts"] });
  json(join(moved, "tsconfig.negative.json"), { compilerOptions: options, files: ["negative.ts"] });
  const positive = step(report, "public-types-positive", process.execPath, [compiler, "-p", join(moved, "tsconfig.positive.json"), "--traceResolution"], moved);
  assertBuiltConsumerResolution(positive.stdout, moved, root, declarationBinding);
  const listing = step(report, "public-types-resolution", process.execPath, [compiler, "-p", join(moved, "tsconfig.positive.json"), "--listFilesOnly"], moved);
  assertConsumerDeclarationFiles(listing.stdout.trim().split("\n"), join(moved, "node_modules/virtual-bash"), declarationBinding);
  assertPeerDeclarationFiles(peer, listing.stdout.trim().split("\n"), moved);
  const negative = stepNegative(report, compiler, moved);
  assert.equal((negative.stdout.match(/error TS\d+:/gu) ?? []).length, 7, "all seven invalid public configurations must fail");
  for (const line of [4, 5, 6, 7, 8, 9, 10]) assert.ok(negative.stdout.includes(`negative.ts(${line},`), `missing rejection on line ${line}`);
  step(report, "moved-offline-consumer", process.execPath, ["--experimental-permission", `--allow-fs-read=${moved}`, "--allow-worker", "--unhandled-rejections=strict", "consumer.mjs"], moved);
  const denied = run(process.execPath, ["--experimental-permission", `--allow-fs-read=${moved}`, "--input-type=module", "-e", `import { readFileSync } from "node:fs"; readFileSync(${JSON.stringify(join(root, "src/index.ts"))});`], moved);
  json(join(directory, "source-fallback-denied.json"), denied);
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /ERR_ACCESS_DENIED/u);
  assertPeerArtifact(peer, moved);
  assert.deepEqual(manifest(root, "dist"), report.builtFiles, "pack lifecycle changed the compiled output");
}

function stepNegative(report, compiler, moved) {
  const args = [compiler, "-p", join(moved, "tsconfig.negative.json")];
  let failure;
  try { step(report, "public-types-negative", process.execPath, args, moved); }
  catch (error) { failure = error; }
  const record = report.steps.at(-1);
  assert.ok(failure, "negative types unexpectedly compiled");
  assert.equal(record.name, "public-types-negative");
  assert.equal(record.status, 2);
  assert.equal(record.signal, null);
  assert.equal(record.error, undefined);
  return record;
}
