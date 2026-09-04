import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { consumerGroups, currentSourceConsumerGroups, negativeGroups, ownerPath } from "../tests/plugins/qualified-current-release/consumers.mjs";
import { validateRuntimeCoverage } from "../tests/plugins/qualified-current-release/runtime-coverage.mjs";
import { resolvePeerProfile } from "../tests/plugins/qualified-current-release/peer.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const typeRoots = dirname(dirname(createRequire(import.meta.url).resolve("@types/node/package.json")));
const within = (directory, path) => {
  const local = relative(directory, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
};

export function createBuiltPackageBinding(root, { includePeer = true } = {}) {
  const metadata = readFileSync(join(root, "package.json")), declarations = new Map();
  const walk = directory => {
    for (const name of readdirSync(join(root, directory))) {
      const path = join(directory, name), stat = lstatSync(join(root, path));
      assert.equal(stat.isSymbolicLink(), false, `candidate build must use regular files: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (/\.d\.(?:ts|mts|cts)$/u.test(name)) declarations.set(path, sha256(readFileSync(join(root, path))));
    }
  };
  assert.equal(lstatSync(join(root, "dist")).isSymbolicLink(), false, "candidate dist must not redirect to another build");
  walk("dist");
  assert.ok(declarations.size > 0, "candidate declarations are missing");
  const manifest = JSON.parse(metadata);
  return { name: manifest.name, metadataSha256: sha256(metadata), exports: manifest.exports, declarations,
    peer: includePeer && manifest.peerDependencies?.["poe-code"] ? createPeerBinding(root, manifest, declarations) : undefined };
}

function nodeTypeTarget(entry) {
  if (typeof entry === "string" || entry === null) return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  for (const [condition, value] of Object.entries(entry)) {
    if (!["types", "node", "import", "default"].includes(condition)) continue;
    const target = nodeTypeTarget(value);
    if (target !== undefined) return target;
  }
}

function declaredTypePath(specifier, binding) {
  const name = binding.name ?? "virtual-bash";
  const key = specifier === name ? "." : `.${specifier.slice(name.length)}`;
  if (binding.exports[key]) return nodeTypeTarget(binding.exports[key].types);
  for (const [pattern, entry] of Object.entries(binding.exports)) {
    const parts = pattern.split("*");
    if (parts.length === 2 && key.startsWith(parts[0]) && key.endsWith(parts[1])) {
      return nodeTypeTarget(entry.types)?.replace("*", key.slice(parts[0].length, key.length - parts[1].length));
    }
  }
}

export function createPeerBinding(root, manifest, declarations = new Map()) {
  assert.notEqual(manifest.peerDependenciesMeta?.["poe-code"]?.optional, true, "canonical peer must be required");
  const profile = resolvePeerProfile(root);
  const { directory, metadata, peer } = profile;
  const binding = { name: peer.name, version: peer.version, integrity: profile.integrity, directory, profile: profile.profile, qualification: profile.qualification,
    metadataSha256: sha256(metadata), exports: peer.exports, declarations: new Map(), publicEntries: new Map(), privateEntries: new Map() };
  const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022 };
  const publicEntry = specifier => {
    const target = declaredTypePath(specifier, binding);
    assert.equal(typeof target, "string", `peer import must select an explicit public type export: ${specifier}`);
    const filename = resolve(directory, target);
    assert.ok(within(directory, filename) && target.includes("/dist/"), `peer public entry is not a built declaration: ${specifier}`);
    binding.publicEntries.set(specifier, relative(directory, filename));
    return filename;
  };
  const pending = [publicEntry("poe-code/safe-fs")];
  for (const filename of declarations.keys()) {
    const imports = ts.preProcessFile(readFileSync(join(root, filename), "utf8"), true).importedFiles;
    for (const { fileName } of imports) if (fileName === peer.name || fileName.startsWith(`${peer.name}/`)) pending.push(publicEntry(fileName));
  }
  while (pending.length) {
    const filename = pending.pop(), local = relative(directory, filename);
    if (binding.declarations.has(local)) continue;
    assert.ok(within(directory, filename) && /\.d\.(?:ts|mts|cts)$/u.test(filename), `peer closure must contain declarations only: ${filename}`);
    assert.equal(lstatSync(filename).isSymbolicLink(), false, `peer declaration must not redirect: ${filename}`);
    const bytes = readFileSync(filename);
    binding.declarations.set(local, sha256(bytes));
    const inputs = ts.preProcessFile(bytes.toString(), true);
    assert.equal(inputs.referencedFiles.length, 0, "unreviewed peer path-reference closure");
    assert.ok(inputs.typeReferenceDirectives.every(reference => reference.fileName === "node"), "unreviewed peer ambient type dependency");
    for (const { fileName } of inputs.importedFiles) {
      if (fileName.startsWith("node:")) continue;
      if (fileName === peer.name || fileName.startsWith(`${peer.name}/`)) {
        pending.push(publicEntry(fileName));
        continue;
      }
      const privatePolicy = fileName === "#safe-fs-platform";
      assert.ok(fileName.startsWith(".") || privatePolicy, `unreviewed transitive peer package: ${fileName}`);
      let privateTarget;
      if (privatePolicy) {
        const target = nodeTypeTarget(peer.imports?.[fileName]?.types);
        assert.equal(typeof target, "string", `peer policy requires an explicit private type mapping: ${fileName}`);
        privateTarget = resolve(directory, target);
        assert.ok(within(directory, privateTarget) && target.includes("/dist/") && /\.d\.(?:ts|mts|cts)$/u.test(target), `peer policy is not a built declaration: ${fileName}`);
        binding.privateEntries.set(fileName, relative(directory, privateTarget));
      }
      const resolved = ts.resolveModuleName(fileName, filename, options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
      assert.ok(resolved, `unresolved peer declaration: ${fileName}`);
      if (privatePolicy) assert.equal(resolved.resolvedFileName, privateTarget, `peer policy selected the wrong declaration: ${fileName}`);
      pending.push(resolved.resolvedFileName);
    }
  }
  assert.ok(binding.publicEntries.size && binding.declarations.size, "canonical public declaration closure is missing");
  return binding;
}

function installedPeer(packageRoot, binding) {
  let directory = packageRoot;
  while (true) {
    const target = join(directory, "node_modules", binding.name);
    if (existsSync(join(target, "package.json"))) return realpathSync(target);
    const parent = resolve(directory, "..");
    assert.notEqual(parent, directory, "required canonical peer is not installed");
    directory = parent;
  }
}

function assertPeerResolution(specifier, target, importer, peerRoot, binding, candidateRoot) {
  const publicImport = specifier === binding.name || specifier.startsWith(`${binding.name}/`);
  const fromPeer = importer && existsSync(importer) && binding.declarations.has(relative(peerRoot, realpathSync(importer)));
  const privateImport = specifier.startsWith("#");
  // A checkout-root peer contains the candidate and ambient dependencies too.
  // Those paths do not claim peer ownership; explicit peer imports still do.
  const competingTarget = peerRoot !== candidateRoot && within(peerRoot, candidateRoot)
    && (within(candidateRoot, target) || relative(peerRoot, target).split(sep).includes("node_modules"));
  const peerTarget = binding.declarations.has(relative(peerRoot, target)) || (within(peerRoot, target) && !competingTarget);
  if (!publicImport && !peerTarget && !(privateImport && binding.privateEntries?.has(specifier))
    && !(fromPeer && (specifier.startsWith(".") || privateImport))) return;
  assert.ok(within(peerRoot, target), `foreign peer declaration/source fallback: ${specifier} -> ${target}`);
  const expected = binding.declarations.get(relative(peerRoot, target));
  assert.ok(expected, `peer resolution is outside the authenticated public closure: ${specifier} -> ${target}`);
  assert.equal(sha256(readFileSync(target)), expected, `peer declaration bytes changed: ${target}`);
  if (privateImport) {
    assert.ok(fromPeer, `private policy must originate in a peer declaration: ${specifier}`);
    const declared = binding.privateEntries?.get(specifier);
    assert.equal(typeof declared, "string", `unadmitted peer private type mapping: ${specifier}`);
    assert.equal(target, resolve(peerRoot, declared), `peer policy selected the wrong declaration: ${specifier}`);
  }
  if (publicImport) {
    const declared = binding.publicEntries.get(specifier);
    assert.equal(typeof declared, "string", `unadmitted peer public subpath: ${specifier}`);
    assert.equal(target, resolve(peerRoot, declared), `peer subpath selected the wrong declaration: ${specifier}`);
  }
}

function assertCandidateResolutions(stdout, installed, binding) {
  const packageRoot = realpathSync(installed), dist = join(packageRoot, "dist");
  const actual = createBuiltPackageBinding(packageRoot, { includePeer: false });
  assert.equal(actual.metadataSha256, binding.metadataSha256, "candidate package metadata changed");
  assert.deepEqual(actual.declarations, binding.declarations, "candidate declaration bytes or file set changed");
  const peerRoot = binding.peer && installedPeer(packageRoot, binding.peer);
  if (peerRoot) assert.equal(sha256(readFileSync(join(peerRoot, "package.json"))), binding.peer.metadataSha256, "peer metadata changed");
  let importer, checked = 0;
  for (const line of stdout.split("\n")) {
    const start = /^======== Resolving module '.*' from '(.*)'\. ========$/u.exec(line);
    if (start) importer = start[1];
    const match = /^======== Module name '(.*)' was successfully resolved to '([^']+)'/u.exec(line);
    if (!match) continue;
    const [, specifier, target] = match;
    const physicalTarget = realpathSync(target);
    if (peerRoot) assertPeerResolution(specifier, physicalTarget, importer, peerRoot, binding.peer, packageRoot);
    const publicImport = /^virtual-bash(?:\/|$)/u.test(specifier);
    const localLeaf = /(?:^|\/)node_modules\/virtual-bash\//u.test(specifier);
    const relativeDeclaration = /^\.\.?\//u.test(specifier) && importer && existsSync(importer) && within(dist, realpathSync(importer));
    if (!publicImport && !localLeaf && !relativeDeclaration && !within(dist, physicalTarget)) continue;
    assert.ok(within(dist, physicalTarget), `foreign candidate declaration/source fallback: ${specifier} -> ${target}`);
    const local = relative(packageRoot, physicalTarget), expected = binding.declarations.get(local);
    assert.ok(expected, `resolution is not an authenticated candidate declaration: ${specifier} -> ${target}`);
    assert.equal(sha256(readFileSync(physicalTarget)), expected, `candidate declaration bytes changed: ${target}`);
    if (publicImport) {
      const declared = declaredTypePath(specifier, binding);
      assert.equal(typeof declared, "string", `public subpath has no candidate types export: ${specifier}`);
      assert.equal(physicalTarget, resolve(packageRoot, declared), `public subpath resolved to the wrong candidate export: ${specifier}`);
    }
    checked++;
  }
  assert.ok(checked > 0, "consumer must resolve authenticated candidate declarations");
}

export function assertBuiltConsumerResolution(stdout, consumer, root, binding = createBuiltPackageBinding(root)) {
  assertCandidateResolutions(stdout, join(consumer, "node_modules/virtual-bash"), binding);
}

export function checkSourceConsumerTypes(root, temporary, compile, binding = createBuiltPackageBinding(root)) {
  const groups = currentSourceConsumerGroups.map(group => {
    const result = { name: group.name, files: group.files, qualification: group.qualification, status: "pending", runtime: "not executed: typecheck-only route" };
    try {
      const filename = join(temporary, `${group.name}.json`);
      writeFileSync(filename, JSON.stringify({
        extends: join(root, "tsconfig.json"),
        compilerOptions: { noEmit: true, skipLibCheck: false, typeRoots: [typeRoots] },
        files: group.files.map(path => join(root, path)), include: [], exclude: [],
      }));
      const checked = compile(`source-consumer-${group.name}`, ["-p", filename, "--traceResolution"]);
      assert.equal(checked.status, 0, `strict current source consumer failed: ${group.name}`);
      assertCandidateResolutions(checked.stdout, root, binding);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
    return result;
  });
  return { groups, passed: groups.every(group => group.status === "pass"), qualification: "Exact current .ts public consumers; explicit source fixture helpers are retained. Not isolated packed runtime or provider acceptance." };
}

export function checkCurrentConsumerTypes(root, temporary, compile, binding = createBuiltPackageBinding(root)) {
  validateRuntimeCoverage(consumerGroups);
  const consumer = join(temporary, "consumer"), installed = join(consumer, "node_modules/virtual-bash");
  mkdirSync(installed, { recursive: true });
  cpSync(join(root, "package.json"), join(installed, "package.json"));
  cpSync(join(root, "dist"), join(installed, "dist"), { recursive: true });
  if (binding.peer) {
    const peer = join(consumer, "node_modules", binding.peer.name);
    mkdirSync(peer, { recursive: true });
    cpSync(join(binding.peer.directory, "package.json"), join(peer, "package.json"));
    for (const [path, expected] of binding.peer.declarations) {
      const source = join(binding.peer.directory, path);
      assert.equal(sha256(readFileSync(source)), expected, `peer changed before admission: ${path}`);
      mkdirSync(resolve(peer, path, ".."), { recursive: true });
      cpSync(source, join(peer, path));
    }
  }
  assert.equal(existsSync(join(installed, "src")), false);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  const groups = [], negativeTypes = [];
  for (const group of consumerGroups) {
    const result = { name: group.name, files: group.files, status: "pending", runtime: "not executed: typecheck-only route" };
    groups.push(result);
    try {
      const workspace = join(consumer, group.name); mkdirSync(workspace);
      if (group.localPackage) cpSync(installed, join(workspace, "node_modules/virtual-bash"), { recursive: true });
      const inputs = [...group.files, ...group.companions ?? []].map((path, index) => {
        const name = index < group.files.length ? basename(path) : group.companionNames?.[index - group.files.length] ?? basename(path);
        const target = join(workspace, name); assert.equal(existsSync(target), false, "consumer basename collision");
        cpSync(join(root, path), target); assert.deepEqual(readFileSync(target), readFileSync(join(root, path)));
        return target;
      });
      const config = JSON.parse(readFileSync(join(root, ownerPath, "tsconfig.consumer.json")));
      Object.assign(config.compilerOptions, { noEmit: true, rootDir: workspace, typeRoots: [typeRoots] });
      config.files = inputs;
      const filename = join(workspace, "tsconfig.json"); writeFileSync(filename, JSON.stringify(config));
      const resolution = compile(`consumer-${group.name}`, ["-p", filename, "--traceResolution"]);
      assert.equal(resolution.status, 0, `strict consumer declarations failed: ${group.name}`);
      assertBuiltConsumerResolution(resolution.stdout, group.localPackage ? workspace : consumer, root, binding);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
  }
  for (const group of negativeGroups) {
    const result = { name: group.name, status: "pending", diagnostics: group.diagnostics }; negativeTypes.push(result);
    try {
      assert.equal(groups.find(positive => positive.name === group.positive)?.status, "pass", "positive consumer must pass first");
      const workspace = join(consumer, group.positive), input = join(workspace, basename(group.path));
      cpSync(join(root, group.path), input);
      const config = JSON.parse(readFileSync(join(workspace, "tsconfig.json"))); config.files = [input];
      const filename = join(workspace, "negative.json"); writeFileSync(filename, JSON.stringify(config));
      const checked = compile(`negative-${group.name}`, ["-p", filename]);
      assert.equal(checked.status, 2); assert.equal(checked.stderr, "");
      const diagnosticName = basename(group.path).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const normalized = checked.stdout.replaceAll(new RegExp(`^.*?(${diagnosticName}\\()`, "gmu"), "$1");
      assert.equal(normalized, readFileSync(join(root, group.expected), "utf8"), "exact negative diagnostics changed");
      assert.equal([...normalized.matchAll(/error TS\d+:/gu)].length, group.diagnostics);
      result.status = "pass";
    } catch (error) { result.status = "fail"; result.error = error.message; }
  }
  return { scope: "Existing maintained consumer routes; strict types and exact diagnostic negatives only. Zero runtime executions, no provider acceptance.", groups, negativeTypes,
    passed: groups.every(group => group.status === "pass") && negativeTypes.every(group => group.status === "pass") };
}
