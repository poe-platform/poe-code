import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundaries } from "../../../scripts/integration-inputs.mjs";
import { assertAdmittedInputPath, assertLiteralInputPath, isHeldInputPath, readRegularInput } from "../../../scripts/typecheck-integration-inputs.mjs";

export const packagePrefix = "packages/safe-bash";
export const authority = fileURLToPath(new URL("../../../", import.meta.url));
const sharedName = "@poe-code/office-package";
const sharedPrefix = "packages/office-package";
const sharedPaths = Object.freeze(["tsconfig.json", ...["package.json", "tsconfig.json", "LICENSE", "src/index.ts", "src/runtime.ts", "src/compression.ts", "src/zip.ts"].map(path => sharedPrefix + "/" + path)]);
const sharedExports = Object.freeze({
  ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
  "./zip": { types: "./dist/zip.d.ts", import: "./dist/zip.js" },
  "./compression": { types: "./dist/compression.d.ts", import: "./dist/compression.js" },
});
const sharedArtifactBindings = new WeakSet();
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const contained = (root, filename) => {
  const local = relative(root, filename);
  return !isAbsolute(local) && local !== ".." && !local.startsWith("../");
};

const approvedDependencies = Object.freeze({
  "@noble/hashes": Object.freeze({ version: "2.4.0", resolved: "https://registry.npmjs.org/@noble/hashes/-/hashes-2.4.0.tgz", integrity: "sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==" }),
  pako: Object.freeze({ version: "3.0.1", resolved: "https://registry.npmjs.org/pako/-/pako-3.0.1.tgz", integrity: "sha512-GupotUUI0mlhugKjUs4bjOwLt3nrehy9Ys2dxC0GtgVef5cnKggkDMmf2bq2poCCuVXopWPmqsc9VDT2iJUy+w==" }),
});

export function cleanEnvironment(directory) {
  for (const name of ["home", "tmp", "npm-cache"]) mkdirSync(join(directory, name), { recursive: true });
  for (const name of ["user.npmrc", "global.npmrc"]) writeFileSync(join(directory, name), "");
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(directory, "home"), TMPDIR: join(directory, "tmp"),
    LC_ALL: "C", LANG: "C", TZ: "UTC", TERM: "xterm-256color",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0",
    GIT_CEILING_DIRECTORIES: realpathSync(directory),
    npm_config_cache: join(directory, "npm-cache"), npm_config_userconfig: join(directory, "user.npmrc"),
    npm_config_globalconfig: join(directory, "global.npmrc"), npm_config_registry: "http://127.0.0.1:1",
    npm_config_offline: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_ignore_scripts: "true",
  };
}

export function assertArchiveDependencyContract(manifest) {
  const runtime = Object.keys(manifest.dependencies ?? {}).length > 0;
  const dependencies = runtime ? manifest.dependencies : Object.fromEntries(
    Object.entries(manifest.devDependencies ?? {}).filter(([name]) => Object.hasOwn(approvedDependencies, name) || name === sharedName));
  if (Object.keys(dependencies).length) assert.deepEqual(dependencies, {
    ...Object.fromEntries(Object.entries(approvedDependencies).map(([name, entry]) => [name, entry.version])),
    ...(Object.hasOwn(dependencies, sharedName) ? { [sharedName]: "*" } : {}),
  }, runtime ? "unapproved runtime dependency contract" : "unapproved development dependency contract");
  for (const key of ["optionalDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(manifest[key] ?? {}).length, 0, `runtime dependency: ${key}`);
  if (Object.keys(manifest.peerDependencies ?? {}).length === 0) {
    assert.equal(manifest.devDependencies?.["poe-code"], undefined, "canonical development peer requires its published peer contract");
    assert.notEqual(manifest.poeCode?.integration?.peerProfile, "checkout-root", "checkout profile requires its published peer contract");
    assert.deepEqual(manifest.peerDependenciesMeta ?? {}, {}, "unbound peer metadata");
    return dependencies;
  }
  const yaml = Object.hasOwn(manifest.peerDependencies, "yaml");
  assert.deepEqual(manifest.peerDependencies, { "poe-code": ">=13.0.0", ...(yaml ? { yaml: "2.9.0" } : {}) }, "unapproved canonical peer contract");
  assert.deepEqual(manifest.peerDependenciesMeta ?? {}, {
    ...(Object.hasOwn(manifest.peerDependenciesMeta ?? {}, "poe-code") ? { "poe-code": { optional: false } } : {}),
    ...(yaml ? { yaml: { optional: true } } : {}),
  }, "canonical peer must remain required and YAML must remain optional");
  return dependencies;
}

export function assertArchiveDependencyLock(manifest, lock) {
  const dependencies = assertArchiveDependencyContract(manifest);
  if (!Object.keys(dependencies).length) return dependencies;
  assert.equal(lock?.lockfileVersion, 3, "dependency lock version");
  assert.deepEqual(lock.packages?.[packagePrefix]?.dependencies ?? {}, manifest.dependencies ?? {}, "dependency workspace lock drift");
  if (!Object.keys(manifest.dependencies ?? {}).length)
    assert.deepEqual(lock.packages?.[packagePrefix]?.devDependencies, manifest.devDependencies, "development dependency workspace lock drift");
  if (Object.hasOwn(dependencies, sharedName)) {
    assert.deepEqual(lock.packages["node_modules/" + sharedName], { resolved: sharedPrefix, link: true }, "shared archive workspace lock link");
    const shared = lock.packages[sharedPrefix];
    assert.equal(shared?.name, sharedName, "shared archive workspace lock identity");
    assert.equal(shared.version, "0.0.1", "shared archive workspace lock version");
    assert.deepEqual(shared.dependencies, { pako: "3.0.1" }, "shared archive workspace dependency closure");
    for (const field of ["optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(shared[field] ?? {}).length, 0, "shared archive workspace dependency closure");
    for (const prefix of [packagePrefix, "packages", sharedPrefix]) assert.equal(lock.packages[prefix + "/node_modules/" + sharedName], undefined, "shared archive shadowed workspace");
  }
  for (const [name, approved] of Object.entries(approvedDependencies)) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `missing dependency lock: ${name}`);
    for (const field of ["version", "resolved", "integrity"]) assert.equal(entry[field], approved[field], `dependency lock ${field}: ${name}`);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(entry[field] ?? {}).length, 0, `transitive dependency ${field}: ${name}`);
    assert.ok(entry.link === undefined && entry.hasInstallScript !== true, `dependency link or install script: ${name}`);
    for (const prefix of [packagePrefix, "packages", ...(Object.hasOwn(dependencies, sharedName) ? [sharedPrefix] : [])]) assert.equal(lock.packages[`${prefix}/node_modules/${name}`], undefined, `shadowed dependency lock: ${name}`);
  }
  return dependencies;
}

export function captureSharedArchiveSources(repository, fileSystem) {
  assertCanonicalRoot(repository, fileSystem);
  return new Map(sharedPaths.map(path => [path, Buffer.from(readRegularInput(repository, path, 300000, fileSystem))]));
}

function sharedSourceInputs(candidate) {
  assert.ok(candidate.files instanceof Map, "shared archive captured sources are required");
  const files = new Map();
  for (const path of sharedPaths) {
    const bytes = candidate.files.get(path);
    assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 300000, "shared archive missing or excessive source: " + path);
    files.set(path, Buffer.from(bytes));
  }
  const metadata = JSON.parse(files.get(sharedPrefix + "/package.json"));
  assert.equal(metadata.name, sharedName, "shared archive package identity");
  assert.equal(metadata.version, "0.0.1", "shared archive package version");
  assert.equal(metadata.type, "module", "shared archive module type");
  assert.equal(metadata.private, true, "shared archive private package");
  assert.deepEqual(metadata.dependencies, { pako: "3.0.1" }, "shared archive dependency closure");
  assert.deepEqual(metadata.exports, sharedExports, "shared archive exported files");
  assert.deepEqual(metadata.files, ["dist", "LICENSE"], "shared archive packed files");
  for (const field of ["optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(metadata[field] ?? {}).length, 0, "shared archive dependency closure");
  for (const name of ["prepare", "prepublish", "prepublishOnly", "prepack", "postpack", "preinstall", "install", "postinstall"]) assert.equal(metadata.scripts?.[name], undefined, "shared archive lifecycle");
  assert.equal(candidate.lock.packages[sharedPrefix].version, metadata.version, "shared archive source/lock version");
  const configuration = JSON.parse(files.get(sharedPrefix + "/tsconfig.json"));
  assert.equal(configuration.extends, "../../tsconfig.json", "shared archive root configuration");
  assert.deepEqual(configuration.include, ["src"], "shared archive source selection");
  assert.deepEqual(configuration.exclude, ["**/*.test.ts"], "shared archive test exclusion");
  assert.equal(configuration.compilerOptions.rootDir, "src", "shared archive source root");
  assert.equal(configuration.compilerOptions.outDir, "dist", "shared archive output root");
  for (const value of [configuration, JSON.parse(files.get("tsconfig.json"))]) {
    assert.equal(value.references, undefined, "shared archive references are unsupported");
    assert.equal(value.compilerOptions?.plugins, undefined, "shared archive compiler plugins are unsupported");
  }
  return { files, metadata };
}

function buildSharedArchive(candidate, tools, dependencies, captured) {
  const compilerRoot = tools.packages.typescript;
  const metadataBytes = readRegularInput(compilerRoot, "package.json", 100000);
  const compilerMetadata = JSON.parse(metadataBytes);
  assert.equal(compilerMetadata.name, "typescript", "shared archive compiler identity");
  assert.equal(digest(metadataBytes), tools.identities.typescript.manifestSha256, "shared archive compiler metadata drift");
  assert.equal(candidate.lock.packages["node_modules/typescript"]?.version, compilerMetadata.version, "shared archive compiler lock");
  const ts = createRequire(join(compilerRoot, "package.json"))("./lib/typescript.js");
  const base = "/shared-archive-build";
  const root = base + "/" + sharedPrefix;
  const inputs = new Map([...captured.files].map(([path, bytes]) => [base + "/" + path, bytes.toString("utf8")]));
  for (const binding of dependencies) for (const file of binding.files) inputs.set(base + "/node_modules/" + binding.name + "/" + file.path, file.bytes.toString("utf8"));
  const lib = base + "/compiler-lib";
  const read = path => {
    if (inputs.has(path)) return inputs.get(path);
    if (dirname(path) !== lib || !basename(path).startsWith("lib.") || !path.endsWith(".d.ts")) return undefined;
    return readRegularInput(compilerRoot, "lib/" + basename(path), 2 * 1024 * 1024).toString("utf8");
  };
  const exists = path => inputs.has(path) || dirname(path) === lib && basename(path).startsWith("lib.") && path.endsWith(".d.ts") && existsSync(join(compilerRoot, "lib", basename(path)));
  const directories = new Set([base, lib]);
  for (const path of inputs.keys()) for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) directories.add(parent);
  const parseHost = {
    useCaseSensitiveFileNames: true, fileExists: exists, readFile: read,
    readDirectory: directory => [...inputs.keys()].filter(path => path.startsWith(directory + "/src/") && path.endsWith(".ts")),
  };
  const config = ts.readConfigFile(root + "/tsconfig.json", read);
  assert.equal(config.error, undefined, "shared archive compiler configuration");
  const parsed = ts.parseJsonConfigFileContent(config.config, parseHost, root, undefined, root + "/tsconfig.json");
  assert.equal(parsed.errors.length, 0, "shared archive compiler configuration errors");
  assert.deepEqual(parsed.fileNames.sort(), sharedPaths.filter(path => path.startsWith(sharedPrefix + "/src/")).map(path => base + "/" + path).sort(), "shared archive compiler input selection");
  assert.equal(parsed.options.outDir, root + "/dist", "shared archive compiler output containment");
  const output = new Map([
    ["package.json", Buffer.from(JSON.stringify(captured.metadata) + "\n")],
    ["LICENSE", captured.files.get(sharedPrefix + "/LICENSE")],
  ]);
  const host = {
    getSourceFile(path, language) { const source = read(path); return source === undefined ? undefined : ts.createSourceFile(path, source, language); },
    getDefaultLibFileName: () => lib + "/lib.es2022.full.d.ts",
    writeFile(path, contents) {
      assert.ok(path.startsWith(root + "/dist/") && [".js", ".d.ts", ".map"].some(suffix => path.endsWith(suffix)), "shared archive emitted output");
      assert.ok(Buffer.byteLength(contents) <= 2 * 1024 * 1024 && output.size < 64, "shared archive output budget");
      output.set(path.slice(root.length + 1), Buffer.from(contents));
    },
    getCurrentDirectory: () => root, getDirectories: directory => [...directories].filter(path => dirname(path) === directory),
    fileExists: exists, readFile: read, directoryExists: directory => directories.has(directory),
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    realpath: path => path,
  };
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, "shared archive compiler diagnostics: " + diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
  assert.equal(program.emit().emitSkipped, false, "shared archive compilation skipped");
  for (const entry of Object.values(sharedExports)) for (const target of Object.values(entry)) assert.ok(output.has(target.slice(2)), "shared archive missing export output");
  return output;
}

export function mirrorArchiveExportTargets(target) {
  if (target === null) return null;
  if (typeof target === "string") {
    assert.ok(target.startsWith("./"), "archive export must be package-relative");
    const local = target.slice(2);
    if (local.includes("*")) {
      const parts = local.split("/");
      assert.ok(["*.js", "*.d.ts"].includes(parts.pop()), "archive export requires a single filename pattern");
      assertLiteralInputPath([...parts, "export-pattern"].join("/"));
    } else assertLiteralInputPath(local);
    return `./${packagePrefix}/${target.slice(2)}`;
  }
  assert.ok(target && typeof target === "object" && !Array.isArray(target), "invalid archive export conditions");
  return Object.fromEntries(Object.entries(target).map(([condition, value]) => [condition, mirrorArchiveExportTargets(value)]));
}

export async function prepareArchiveDependencies(candidate, tools, directory, { artifacts = {}, fileSystem = { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync } } = {}) {
  const names = Object.keys(assertArchiveDependencyLock(candidate.manifest, candidate.lock));
  const shared = names.includes(sharedName) ? sharedSourceInputs(candidate) : undefined;
  assert.ok(Object.keys(artifacts).every(name => names.includes(name)), "unapproved dependency artifact");
  if (!names.length) return Object.freeze([]);
  assertCanonicalRoot(directory, fileSystem);
  const ownedRoot = join(directory, "dependency-artifacts");
  fileSystem.mkdirSync(ownedRoot);
  const bindings = [];
  for (const [name, approved] of Object.entries(approvedDependencies)) {
    const source = Object.hasOwn(artifacts, name) ? artifacts[name] : tools.dependencyArtifactPath(approved.integrity);
    assert.ok(typeof source === "string" && isAbsolute(source) && resolve(source) === source, `dependency artifact must have a canonical absolute path: ${name}`);
    assertCanonicalRoot(dirname(source), fileSystem);
    const stat = fileSystem.lstatSync(source);
    assert.ok(stat.isFile() && stat.nlink === 1, `dependency artifact must be regular single-link: ${name}`);
    const bytes = readRegularInput(dirname(source), basename(source), 8 * 1024 * 1024, fileSystem);
    assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, approved.integrity, `dependency artifact integrity: ${name}`);
    const tarball = join(ownedRoot, `${name.split("/").at(-1)}.tgz`);
    const tarballSha256 = digest(bytes);
    fileSystem.writeFileSync(tarball, bytes, { flag: "wx" });
    const folded = new Set();
    const contents = await readArchive(tools.tar, tarball, tarballSha256, path => {
      assert.ok(path.startsWith("package/"), `dependency archive prefix: ${name}`);
      const local = path.slice("package/".length);
      assertLiteralInputPath(local);
      assert.ok(!local.split("/").includes("node_modules"), `bundled dependency archive: ${name}`);
      assert.ok(!folded.has(local.toLowerCase()), `dependency archive case alias: ${name}`);
      folded.add(local.toLowerCase());
    }, fileSystem);
    assert.ok(contents.has("package/package.json"), `dependency package metadata missing: ${name}`);
    const metadata = JSON.parse(contents.get("package/package.json"));
    assert.equal(metadata.name, name, "dependency package name");
    assert.equal(metadata.version, approved.version, `dependency package version: ${name}`);
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(metadata[key] ?? {}).length, 0, `unapproved dependency package ${key}: ${name}`);
    for (const key of ["preinstall", "install", "postinstall"]) assert.equal(metadata.scripts?.[key], undefined, `dependency install lifecycle: ${name}`);
    const entries = {};
    for (const [route, conditions] of Object.entries(metadata.exports ?? {})) {
      assert.ok(route === "." || route.startsWith("./"), `dependency export route: ${name}`);
      assert.ok(typeof conditions === "string" || conditions && typeof conditions === "object" && !Array.isArray(conditions), `dependency export conditions: ${name}`);
      const target = typeof conditions === "string" ? conditions : conditions.import ?? conditions.default;
      if (target === undefined) continue;
      assert.equal(typeof target, "string", `dependency runtime export: ${name}`);
      if (target.endsWith(".json")) continue;
      assert.ok(target.startsWith("./") && (target.endsWith(".js") || target.endsWith(".mjs")), `dependency runtime export: ${name}`);
      assertLiteralInputPath(target.slice(2));
      assert.ok(contents.has(`package/${target.slice(2)}`), `dependency export missing: ${name}`);
      entries[route === "." ? name : `${name}/${route.slice(2)}`] = target.slice(2);
    }
    const files = [...contents].map(([path, payload]) => Object.freeze({ path: path.slice("package/".length), bytes: payload, sha256: digest(payload) }));
    bindings.push(Object.freeze({ name, ...approved, tarball, tarballSha256, entries: Object.freeze(entries), files: Object.freeze(files) }));
  }
  if (shared) {
    assert.equal(artifacts[sharedName], undefined, "shared archive cannot use an external artifact");
    const output = buildSharedArchive(candidate, tools, bindings, shared);
    const chunks = [];
    for (const [path, bytes] of [...output].sort(([left], [right]) => left.localeCompare(right))) {
      const header = new tools.tar.Header({ path: "package/" + path, type: "File", mode: 0o644, uid: 0, gid: 0, size: bytes.length, mtime: new Date(0) });
      assert.equal(header.encode(), false, "shared archive unexpectedly needs extended tar metadata");
      chunks.push(header.block, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    chunks.push(Buffer.alloc(1024));
    const bytes = Buffer.concat(chunks);
    assert.ok(bytes.length <= 8 * 1024 * 1024, "shared archive artifact budget");
    const tarball = join(ownedRoot, "office-package.tgz");
    fileSystem.writeFileSync(tarball, bytes, { flag: "wx" });
    const tarballSha256 = digest(bytes);
    const contents = await readArchive(tools.tar, tarball, tarballSha256, path => assert.ok(output.has(path.slice("package/".length)), "shared archive unexpected packed path"), fileSystem);
    assert.deepEqual([...contents.keys()].sort(), [...output.keys()].map(path => "package/" + path).sort(), "shared archive packed inventory");
    for (const [path, payload] of output) assert.deepEqual(contents.get("package/" + path), payload, "shared archive packed bytes");
    const sources = Object.freeze([...shared.files].map(([path, payload]) => Object.freeze({ path, sha256: digest(payload) })));
    const files = Object.freeze([...output].map(([path, payload]) => Object.freeze({ path, bytes: Buffer.from(payload), sha256: digest(payload) })));
    const binding = Object.freeze({
      name: sharedName, version: "0.0.1", resolved: "workspace:" + sharedPrefix,
      kind: "captured-workspace", sourceCommit: candidate.sourceCommit ?? null,
      sources, sourceHash: digest(JSON.stringify(sources)), tarball, tarballSha256,
      integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
      entries: Object.freeze(Object.fromEntries(Object.entries(sharedExports).map(([route, entry]) => [sharedName + (route === "." ? "" : route.slice(1)), entry.import.slice(2)]))),
      files,
    });
    sharedArtifactBindings.add(binding);
    bindings.push(binding);
  }
  return Object.freeze(bindings);
}

export function assertArchiveDependencyArtifacts(bindings, fileSystem) {
  for (const binding of bindings) {
    if (binding.name === sharedName) {
      assert.ok(sharedArtifactBindings.has(binding), "shared archive binding must originate from captured compilation");
      assert.equal(binding.kind, "captured-workspace", "shared archive binding kind");
      assert.equal(binding.version, "0.0.1", "shared archive binding version");
      assert.equal(binding.resolved, "workspace:" + sharedPrefix, "shared archive binding origin");
      assert.deepEqual(binding.sources.map(source => source.path), sharedPaths, "shared archive source inventory");
      assert.equal(digest(JSON.stringify(binding.sources)), binding.sourceHash, "shared archive source identity");
      assert.deepEqual(binding.entries, Object.fromEntries(Object.entries(sharedExports).map(([route, entry]) => [sharedName + (route === "." ? "" : route.slice(1)), entry.import.slice(2)])), "shared archive bound entrypoints");
    } else {
      assert.ok(Object.hasOwn(approvedDependencies, binding.name), "unapproved dependency binding");
      for (const key of ["version", "resolved", "integrity"]) assert.equal(binding[key], approvedDependencies[binding.name][key], `dependency binding ${key}`);
    }
    const stat = (fileSystem?.lstatSync ?? lstatSync)(binding.tarball);
    assert.ok(stat.isFile() && stat.nlink === 1, `dependency artifact must be regular single-link: ${binding.name}`);
    const bytes = readRegularInput(dirname(binding.tarball), basename(binding.tarball), 8 * 1024 * 1024, fileSystem);
    assert.equal(digest(bytes), binding.tarballSha256, `dependency artifact drift: ${binding.name}`);
    assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, binding.integrity, `dependency artifact integrity: ${binding.name}`);
  }
}

export function stageArchiveDependencies(bindings, directory, fileSystem = { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync }) {
  assertArchiveDependencyArtifacts(bindings, fileSystem);
  assertCanonicalRoot(directory, fileSystem);
  for (const binding of bindings) {
    const root = join(directory, "node_modules", binding.name);
    fileSystem.mkdirSync(dirname(root), { recursive: true });
    fileSystem.mkdirSync(root);
    for (const { path, bytes, sha256 } of binding.files) {
      assertLiteralInputPath(path);
      assert.equal(digest(bytes), sha256, `dependency captured bytes drift: ${binding.name}/${path}`);
      fileSystem.mkdirSync(dirname(join(root, path)), { recursive: true });
      fileSystem.writeFileSync(join(root, path), bytes, { flag: "wx" });
    }
  }
}

export function assertArchiveDependencies(bindings, directory, fileSystem = { lstatSync, readdirSync, readFileSync }) {
  assertArchiveDependencyArtifacts(bindings, fileSystem);
  for (const binding of bindings) {
    const root = join(directory, "node_modules", binding.name);
    assertCanonicalRoot(root, fileSystem);
    const paths = [];
    let entries = 0;
    const visit = local => {
      assert.ok(local.split("/").length <= 64, "dependency inventory depth budget");
      for (const entry of fileSystem.readdirSync(join(root, local), { withFileTypes: true })) {
        assert.ok(++entries <= 10000, "dependency inventory entry budget");
        const path = local ? `${local}/${entry.name}` : entry.name;
        assertLiteralInputPath(path);
        assert.ok(Buffer.byteLength(path) <= 4096, "dependency inventory path budget");
        if (entry.isDirectory()) visit(path);
        else { assert.ok(entry.isFile(), `dependency inventory nonregular: ${path}`); paths.push(path); }
      }
    };
    visit("");
    assert.deepEqual(paths.sort(), binding.files.map(file => file.path).sort(), `dependency inventory drift: ${binding.name}`);
    for (const { path, sha256 } of binding.files) {
      const stat = fileSystem.lstatSync(join(root, path));
      assert.ok(stat.isFile() && stat.nlink === 1, `dependency inventory nonregular or shared: ${path}`);
      assert.equal(digest(readRegularInput(root, path, 32 * 1024 * 1024, fileSystem)), sha256, `dependency bytes drift: ${binding.name}/${path}`);
    }
  }
}

export function readCommittedBlobs(entries, hashAlgorithm, git, { bootstrapCount = entries.length, validateBootstrap } = {}) {
  assert.ok(entries.length > 0 && entries.length <= 10000, "committed batch entry budget");
  assert.ok(Number.isSafeInteger(bootstrapCount) && bootstrapCount > 0 && bootstrapCount <= entries.length, "committed bootstrap entry budget");
  assert.ok(hashAlgorithm === "sha1" || hashAlgorithm === "sha256", "committed batch hash algorithm");
  const objects = entries.map(({ path, oid, maximum }) => {
    assert.match(oid, hashAlgorithm === "sha1" ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 16 * 1024 * 1024, "committed batch input budget");
    return { path, oid, maximum };
  });
  assert.equal(new Set(objects.map(object => object.path)).size, objects.length, "committed batch duplicate path");
  const metadata = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: Buffer.from(objects.map(object => `${object.oid}\n`).join("")), maxBuffer: objects.length * 128,
  });
  assert.ok(Buffer.isBuffer(metadata) && metadata.length <= objects.length * 128, "committed batch metadata budget");
  let offset = 0;
  let totalBytes = 0;
  for (const object of objects) {
    const end = metadata.indexOf(10, offset);
    assert.ok(end >= offset && end - offset < 128, "committed batch metadata framing");
    const line = metadata.toString("utf8", offset, end);
    const prefix = `${object.oid} blob `;
    assert.ok(line.startsWith(prefix), "committed batch metadata order, OID or type");
    const decimal = line.slice(prefix.length);
    const size = Number(decimal);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && String(size) === decimal, "committed batch metadata size");
    assert.ok(size <= object.maximum, `committed blob size: ${object.path}`);
    totalBytes += size;
    assert.ok(totalBytes <= 128 * 1024 * 1024, "committed source archive byte budget");
    object.size = size;
    offset = end + 1;
  }
  assert.equal(offset, metadata.length, "committed batch metadata trailing records");
  const files = new Map();
  for (let start = 0; start < objects.length;) {
    let end = start;
    let payloadBytes = 0;
    const limit = start < bootstrapCount ? bootstrapCount : objects.length;
    while (end < limit && payloadBytes + objects[end].size <= 16 * 1024 * 1024) {
      payloadBytes += objects[end].size;
      end += 1;
    }
    const batch = objects.slice(start, end);
    const framedBytes = batch.reduce((total, object) => total + Buffer.byteLength(`${object.oid} blob ${object.size}\n`) + object.size + 1, 0);
    const output = git(["cat-file", "--batch"], {
      input: Buffer.from(batch.map(object => `${object.oid}\n`).join("")), maxBuffer: framedBytes,
    });
    assert.ok(Buffer.isBuffer(output) && output.length === framedBytes, "committed batch body length");
    offset = 0;
    for (const object of batch) {
      const header = Buffer.from(`${object.oid} blob ${object.size}\n`);
      assert.deepEqual(output.subarray(offset, offset + header.length), header, "committed batch body order, OID, type or size");
      offset += header.length;
      const bytes = Buffer.from(output.subarray(offset, offset + object.size));
      offset += object.size;
      assert.equal(output[offset++], 10, "committed batch body terminator");
      const oid = createHash(hashAlgorithm).update(`blob ${object.size}\0`).update(bytes).digest("hex");
      assert.equal(oid, object.oid, `committed blob identity: ${object.path}`);
      files.set(object.path, bytes);
    }
    assert.equal(offset, output.length, "committed batch body trailing records");
    start = end;
    if (end === bootstrapCount) validateBootstrap?.(files);
  }
  return files;
}

export function inspectCommittedCandidate(repository, revision, directory, execute = spawnSync) {
  const boundaries = loadBoundaries(authority);
  const environment = cleanEnvironment(directory);
  const git = (args, { input, maxBuffer = 32 * 1024 * 1024 } = {}) => {
    const result = execute("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: repository, env: environment, timeout: 30000, input, maxBuffer,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr?.toString());
    assert.ok(Buffer.isBuffer(result.stdout) && result.stdout.length <= maxBuffer, "committed Git output budget");
    return result.stdout;
  };
  const sourceCommit = git(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]).toString().trim();
  assert.match(sourceCommit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  const hashAlgorithm = sourceCommit.length === 40 ? "sha1" : "sha256";
  const tree = new Map();
  const treeBytes = git(["ls-tree", "-rz", "--full-tree", sourceCommit]);
  assert.equal(treeBytes.at(-1), 0, "committed tree inventory must be NUL terminated");
  assert.deepEqual(Buffer.from(treeBytes.toString("utf8")), treeBytes, "committed path bytes outside supported UTF-8 domain");
  for (const record of treeBytes.subarray(0, -1).toString("utf8").split("\0")) {
    const separator = record.indexOf("\t");
    assert.ok(separator > 0, "malformed committed tree record");
    const fields = record.slice(0, separator).split(" ");
    assert.equal(fields.length, 3, "malformed committed tree header");
    const [mode, type, oid] = fields;
    const path = record.slice(separator + 1);
    assert.ok(!tree.has(path), "duplicate committed tree path");
    tree.set(path, { mode, type, oid });
  }
  assert.ok(tree.has(`${packagePrefix}/package.json`), "actual commit lacks integrated package prefix packages/safe-bash; staging or source-parent commits do not qualify");
  const admitted = new Map();
  const admit = (path, maximum = 16 * 1024 * 1024) => {
    assertLiteralInputPath(path);
    if (path.startsWith(`${packagePrefix}/`)) assertAdmittedInputPath(path.slice(packagePrefix.length + 1), boundaries);
    else assert.ok(["package.json", "package-lock.json", "scripts/guard-package-dist.mjs", ...sharedPaths, "packages/op/package.json", "packages/op/tsconfig.json"].includes(path) || path.startsWith("packages/op/src/"), `unadmitted root archive path: ${path}`);
    const entry = tree.get(path);
    assert.ok(entry, `missing committed input: ${path}`);
    assert.ok(entry.type === "blob" && ["100644", "100755"].includes(entry.mode), `not a regular committed input: ${path}`);
    assert.match(entry.oid, hashAlgorithm === "sha1" ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u);
    if (!admitted.has(path)) admitted.set(path, { path, oid: entry.oid, maximum });
  };
  const reviewed = ["tsconfig.json", "tsconfig.build.json", "integration-boundaries.json", "scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs", "scripts/build.mjs", "scripts/copy-compression-assets.mjs"];
  assert.ok(tree.has("scripts/guard-package-dist.mjs"), "missing committed root output guard");
  admit("scripts/guard-package-dist.mjs");
  for (const path of reviewed) admit(`${packagePrefix}/${path}`, 300000);
  for (const fixture of boundaries.fixtureDirectories) admit(`${packagePrefix}/${fixture.owner}`, 300000);
  admit(`${packagePrefix}/package.json`, 300000);
  admit("package.json", 300000);
  admit("package-lock.json");
  admit(`${packagePrefix}/README.md`);
  if (tree.has(sharedPrefix + "/package.json")) {
    for (const path of sharedPaths) admit(path, 300000);
    for (const path of tree.keys()) if (path.startsWith(sharedPrefix + "/src/") && !path.endsWith(".test.ts")) {
      assert.ok(sharedPaths.includes(path), "unreviewed shared archive source: " + path);
    }
  }
  const hasOp = tree.has("packages/op/package.json");
  if (hasOp) {
    admit("packages/op/package.json", 300000);
    admit("packages/op/tsconfig.json", 300000);
  }
  const bootstrapCount = admitted.size;
  if (hasOp) {
    const foldedOp = new Set();
    for (const path of tree.keys()) {
      if (!path.startsWith("packages/op/src/")) continue;
      assert.ok(!foldedOp.has(path.toLowerCase()), `case alias of committed op source: ${path}`);
      foldedOp.add(path.toLowerCase());
      admit(path);
    }
  }

  const withheldPaths = [];
  const heldCode = [];
  const folded = new Set();
  for (const path of tree.keys()) {
    if (!path.startsWith(`${packagePrefix}/`)) continue;
    const local = path.slice(packagePrefix.length + 1);
    if (!local.startsWith("src/")) continue;
    assertLiteralInputPath(local);
    assert.ok(!folded.has(local.toLowerCase()), `case alias of committed source: ${local}`);
    folded.add(local.toLowerCase());
    if (isHeldInputPath(local, boundaries)) {
      withheldPaths.push(path);
      const segments = local.split("/");
      if (segments.length > 4) assert.ok(boundaries.heldEvidenceDirectories.some(held => local.startsWith(`${held}/`)), `unclassified held source directory: ${local}`);
      else if ([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].some(extension => local.endsWith(extension))) heldCode.push(local);
      continue;
    }
    admit(path);
  }
  assert.ok(admitted.has(`${packagePrefix}/src/index.ts`), "missing committed source entrypoint");
  assert.deepEqual(heldCode.sort(), boundaries.heldSourceFiles.filter(path => path.endsWith(".ts")).sort(), "committed held source metadata inventory changed");
  let manifest, rootManifest, lock, opManifest;
  const files = readCommittedBlobs([...admitted.values()], hashAlgorithm, git, {
    bootstrapCount,
    validateBootstrap(bootstrap) {
      assert.ok(bootstrap.get("scripts/guard-package-dist.mjs").equals(readRegularInput(resolve(authority, "../.."), "scripts/guard-package-dist.mjs", 300000)), "committed guard differs from reviewed verifier authority");
      for (const path of reviewed) assert.ok(bootstrap.get(`${packagePrefix}/${path}`).equals(readRegularInput(authority, path, 300000, undefined, boundaries)), `committed build input differs from reviewed authority: ${path}`);
      for (const fixture of boundaries.fixtureDirectories) assert.equal(digest(bootstrap.get(`${packagePrefix}/${fixture.owner}`)), fixture.sha256, `committed fixture owner changed: ${fixture.owner}`);
      manifest = JSON.parse(bootstrap.get(`${packagePrefix}/package.json`));
      rootManifest = JSON.parse(bootstrap.get("package.json"));
      lock = JSON.parse(bootstrap.get("package-lock.json"));
      assert.equal(manifest.name, "virtual-bash");
      assert.equal(manifest.private, true);
      assert.equal(manifest.type, "module");
      assert.equal(manifest.engines.node, ">=22");
      assert.deepEqual(manifest.files, [
        "dist", "!dist/optional.js", "!dist/optional.js.map", "!dist/optional.d.ts", "!dist/optional.d.ts.map",
        "!dist/commands/cmp", "!dist/commands/dd", "!dist/commands/install", "!dist/commands/shuf",
        "!dist/commands/truncate", "!dist/commands/yes",
        ...["expression", "nodes", "evaluate", "native-work", "inplace", "arguments", "mike", "native-encoder"]
          .flatMap(name => ["js", "js.map", "d.ts", "d.ts.map"].map(extension => `!dist/commands/yq/${name}.${extension}`)),
        "!dist/fs/devices", "!dist/shell/extensions/arrays", "!dist/shell/extensions/trap", "!dist/shell/extensions/jobs",
        "!dist/shell/extensions/mapfile", "!dist/shell/extensions/read",
      ], "committed dist packaging contract drift");
      assertArchiveDependencyContract(manifest);
      for (const key of ["prepare", "prepublish", "prepublishOnly", "prepack", "postpack", "preinstall", "install", "postinstall", "prebuild", "postbuild"]) assert.ok(!Object.hasOwn(manifest.scripts, key), `unapproved package lifecycle: ${key}`);
      assert.equal(manifest.scripts.build, "node ../../scripts/guard-package-dist.mjs && node scripts/integration-inputs.mjs && node scripts/build.mjs && node scripts/copy-compression-assets.mjs", "unreviewed committed build command");
      assert.equal(rootManifest.name, "poe-code");
      assert.ok(rootManifest.workspaces.includes("packages/*"), "workspace package prefix missing");
      for (const [path, conditions] of Object.entries(manifest.exports)) {
        const name = path === "." ? "./safe-bash" : `./safe-bash${path.slice(1)}`;
        assert.deepEqual(rootManifest.exports[name], mirrorArchiveExportTargets(conditions), `root export mismatch: ${name}`);
      }
      assert.equal(lock.lockfileVersion, 3, "workspace lock version");
      for (const [key, expected] of [["", rootManifest], [packagePrefix, manifest]]) {
        for (const field of ["name", "version", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "engines", ...(key === "" ? ["workspaces"] : [])]) {
          assert.deepEqual(lock.packages?.[key]?.[field], expected[field], `workspace lock drift: ${key || "root"} ${field}`);
        }
      }
      assert.deepEqual(lock.packages["node_modules/virtual-bash"], { resolved: packagePrefix, link: true }, "workspace lock link drift");
      const dependencies = assertArchiveDependencyLock(manifest, lock);
      if (Object.hasOwn(dependencies, sharedName)) sharedSourceInputs({ files: bootstrap, lock });
      if (manifest.devDependencies?.["@poe-platform/op"] !== undefined) {
        assert.equal(manifest.devDependencies["@poe-platform/op"], "*");
        assert.ok(hasOp, "missing committed op build prerequisite");
        opManifest = JSON.parse(bootstrap.get("packages/op/package.json"));
        assert.equal(opManifest.name, "@poe-platform/op");
        assert.equal(opManifest.private, true);
        assert.equal(opManifest.exports?.["."]?.types, "./dist/index.d.ts");
        assert.deepEqual(lock.packages["packages/op"]?.dependencies ?? {}, opManifest.dependencies ?? {}, "op dependency workspace lock drift");
        assert.deepEqual(lock.packages["node_modules/@poe-platform/op"], { resolved: "packages/op", link: true }, "op workspace link drift");
        assert.ok(bootstrap.get("packages/op/tsconfig.json").equals(readRegularInput(resolve(authority, "../op"), "tsconfig.json", 300000)), "committed op compiler config differs from reviewed authority");
        assert.ok(admitted.has("packages/op/src/index.ts"), "missing committed op source entrypoint");
      } else assert.equal(hasOp, false, "unrequested op workspace archive");
    },
  });
  const blobReads = [...files.keys()];
  return { sourceCommit, files, blobReads, withheldPaths, manifest, rootManifest, lock, opManifest, boundaries, environment };
}

export function resolveTools() {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "committed export gate requires Node >=22");
  const require = createRequire(join(authority, "package.json"));
  const compiler = dirname(realpathSync(require.resolve("typescript/package.json")));
  const nodeTypes = dirname(realpathSync(require.resolve("@types/node/package.json")));
  const undiciTypes = dirname(realpathSync(createRequire(join(nodeTypes, "package.json")).resolve("undici-types/package.json")));
  const npmCli = realpathSync([join(dirname(process.execPath), "npm"), "/usr/bin/npm"].find(path => existsSync(path)) ?? "npm-unavailable");
  const npmRequire = createRequire(npmCli);
  const npmRoot = dirname(dirname(npmCli));
  assert.equal(JSON.parse(readRegularInput(npmRoot, "package.json", 100000)).name, "npm");
  const packages = { typescript: compiler, "@types/node": nodeTypes, "undici-types": undiciTypes };
  const identities = Object.fromEntries(Object.entries(packages).map(([name, root]) => {
    const bytes = readRegularInput(root, "package.json", 100000);
    const metadata = JSON.parse(bytes);
    assert.equal(metadata.name, name);
    return [name, { root, version: metadata.version, manifestSha256: digest(bytes) }];
  }));
  const dependencyCache = join(userInfo().homedir, ".npm", "_cacache");
  const contentPath = npmRequire("cacache/lib/content/path");
  return { packages, identities, npmCli, pack: npmRequire.resolve("libnpmpack"), tar: npmRequire("tar"), dependencyArtifactPath: integrity => contentPath(dependencyCache, integrity) };
}

export function copyRegularTree(source, destination, fileSystem = { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync }, hardlinkedInputs = []) {
  const inventory = [];
  const pending = [];
  const folded = new Set();
  const identity = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
  const directoryIndexes = new Map();
  const indexLimits = { directories: 256, names: 32768, characters: 1048576 };
  let indexedNames = 0, indexedCharacters = 0;
  const discardIndex = directory => {
    const cached = directoryIndexes.get(directory);
    if (!cached) return;
    directoryIndexes.delete(directory);
    indexedNames -= cached.names.length;
    indexedCharacters -= cached.characters;
  };
  const inputs = fileSystem;
  fileSystem = Object.create(inputs);
  Object.defineProperty(fileSystem, "readdirSync", { value: directory => {
    let stat = inputs.lstatSync(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `copy ancestor must be a nonlink regular directory: ${directory}`);
    let signature = identity(stat);
    const cached = directoryIndexes.get(directory);
    if (cached && signature.every((value, index) => Object.is(value, cached.identity[index]))) return cached.names;
    discardIndex(directory);
    const outside = directory !== source && (directory === "/" || source.startsWith(directory + "/"));
    let names;
    for (let attempt = 0; ; attempt += 1) {
      names = inputs.readdirSync(directory);
      const after = inputs.lstatSync(directory);
      assert.ok(after.isDirectory() && !after.isSymbolicLink(), `copy ancestor must be a nonlink regular directory: ${directory}`);
      if (!outside) {
        assert.deepEqual(identity(after), signature, `copy directory identity changed: ${directory}`);
        break;
      }
      for (const field of ["dev", "ino", "mode"]) assert.equal(after[field], stat[field], `copy directory identity changed: ${directory}`);
      const afterIdentity = identity(after);
      if (signature.every((value, index) => Object.is(value, afterIdentity[index]))) break;
      if (attempt === 2) return names;
      stat = after;
      signature = afterIdentity;
    }
    const complete = signature.every((value, index) => index < 5 ? Number.isSafeInteger(value) : Number.isFinite(value));
    if (!complete || names.length > indexLimits.names || directory.length > indexLimits.characters) return names;
    let characters = directory.length;
    for (const name of names) {
      characters += name.length;
      if (characters > indexLimits.characters) return names;
    }
    while (directoryIndexes.size >= indexLimits.directories || indexedNames + names.length > indexLimits.names || indexedCharacters + characters > indexLimits.characters) {
      discardIndex(directoryIndexes.keys().next().value);
    }
    const ownedNames = names.slice();
    directoryIndexes.set(directory, { identity: signature, names: ownedNames, characters });
    indexedNames += names.length;
    indexedCharacters += characters;
    return ownedNames;
  } });
  assertCanonicalRoot(source, fileSystem);
  const visit = local => {
    assertCanonicalRoot(join(source, local), fileSystem);
    for (const name of fileSystem.readdirSync(join(source, local))) {
      const path = local ? `${local}/${name}` : name;
      assertLiteralInputPath(path);
      assert.ok(!folded.has(path.toLowerCase()), `copy case alias: ${path}`);
      folded.add(path.toLowerCase());
      const stat = fileSystem.lstatSync(join(source, path));
      if (stat.isDirectory()) visit(path);
      else {
        // npm's esbuild installer links its launcher to the native package binary.
        // Explicitly admitted pairs are copied to fresh files, with the same
        // before/after identity checks as every other input.
        assert.ok(stat.isFile() && (stat.nlink === 1 || (stat.nlink === 2 && hardlinkedInputs.includes(path))), `copy input must be regular single-link: ${path}`);
        assert.ok(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= 32 * 1024 * 1024, `copy input byte budget: ${path}`);
        pending.push({ path, identity: identity(stat) });
      }
    }
  };
  visit("");
  for (const entry of pending) {
    const absolute = join(source, entry.path);
    assertCanonicalRoot(dirname(absolute), fileSystem);
    assert.deepEqual(identity(fileSystem.lstatSync(absolute)), entry.identity, `copy input identity changed: ${entry.path}`);
    const bytes = readRegularInput(source, entry.path, 32 * 1024 * 1024, fileSystem);
    assert.deepEqual(identity(fileSystem.lstatSync(absolute)), entry.identity, `copy input identity changed: ${entry.path}`);
    assert.equal(bytes.length, entry.identity[4], `copy input size changed: ${entry.path}`);
    fileSystem.mkdirSync(dirname(join(destination, entry.path)), { recursive: true });
    fileSystem.writeFileSync(join(destination, entry.path), bytes);
    inventory.push({ path: entry.path, bytes: bytes.length, sha256: digest(bytes) });
  }
  return inventory;
}

export function assertCanonicalRoot(root, fileSystem = { lstatSync, readdirSync }) {
  assert.equal(typeof root, "string", "dist root must be a literal string");
  assert.ok(isAbsolute(root) && root !== "/", "dist root must be an absolute owned directory");
  assertLiteralInputPath(root.slice(1));
  assert.equal(resolve(root), root, "dist root must use canonical absolute spelling");
  let directory = "/";
  assert.ok(fileSystem.lstatSync(directory).isDirectory(), "dist root ancestor must be a regular directory");
  for (const part of root.slice(1).split("/")) {
    assert.ok(fileSystem.readdirSync(directory).includes(part), `dist root spelling changed: ${root}`);
    directory = join(directory, part);
    assert.ok(fileSystem.lstatSync(directory).isDirectory(), `dist root ancestor must be a regular directory: ${root}`);
  }
}

export function readDistInventory(root, fileSystem = { lstatSync, readdirSync, readFileSync }) {
  assertCanonicalRoot(root, fileSystem);
  const boundaries = loadBoundaries(authority);
  assert.ok(fileSystem.readdirSync(root).includes("dist"), "dist root spelling changed");
  const files = [];
  const folded = new Set();
  let entries = 0;
  let totalBytes = 0;
  const visit = path => {
    assertLiteralInputPath(path);
    if (path !== "dist") assertAdmittedInputPath(`src/${path.slice(5)}`, boundaries);
    assert.ok(!folded.has(path.toLowerCase()), `dist case alias: ${path}`);
    folded.add(path.toLowerCase());
    entries += 1;
    assert.ok(entries <= 10000 && path.split("/").length <= 64 && Buffer.byteLength(path) <= 4096, "dist entry or depth budget");
    const stat = fileSystem.lstatSync(join(root, path));
    if (stat.isDirectory()) {
      const names = fileSystem.readdirSync(join(root, path));
      assert.ok(names.length <= 10000 - entries, "dist entry budget");
      for (const name of names.sort()) visit(`${path}/${name}`);
    } else {
      assert.ok(path !== "dist" && stat.isFile(), `dist entry must be regular: ${path}`);
      assert.ok(Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= 32 * 1024 * 1024, `dist file byte budget: ${path}`);
      totalBytes += stat.size;
      assert.ok(totalBytes <= 128 * 1024 * 1024, "dist aggregate byte budget");
      files.push({ path, bytes: stat.size });
    }
  };
  visit("dist");
  assert.ok(files.length > 0, "dist inventory must not be empty");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(files.map(entry => {
    const bytes = readRegularInput(root, entry.path, entry.bytes, fileSystem);
    assert.equal(bytes.length, entry.bytes, `dist size changed after admission: ${entry.path}`);
    return Object.freeze({ path: entry.path, sha256: digest(bytes) });
  }));
}

export function captureDistBaseline(root, identity, fileSystem) {
  const { sourceCommit, archiveSha256 } = identity;
  assert.match(sourceCommit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  assert.match(archiveSha256, /^[a-f0-9]{64}$/u);
  return Object.freeze({ sourceCommit, archiveSha256, files: readDistInventory(root, fileSystem) });
}

export function assertDistContinuity(baseline, files, identity) {
  assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.files) && baseline.files.every(Object.isFrozen), "dist continuity baseline must be immutable");
  assert.equal(identity.sourceCommit, baseline.sourceCommit, "dist continuity selected commit changed");
  assert.equal(identity.archiveSha256, baseline.archiveSha256, "dist continuity source archive changed");
  assert.deepEqual(files, baseline.files, "dist continuity ordered paths or SHA256 changed");
}

export async function readArchive(tar, filename, expectedHash, admit, fileSystem = { lstatSync, readFileSync }) {
  const stat = fileSystem.lstatSync(filename);
  assert.ok(stat.isFile() && stat.size <= 128 * 1024 * 1024, "archive size or kind");
  const bytes = fileSystem.readFileSync(filename);
  assert.equal(digest(bytes), expectedHash, "archive identity changed before parsing");
  const files = new Map();
  let expanded = 0;
  await new Promise((resolvePromise, reject) => {
    const Parser = tar.Parser ?? tar.Parse;
    const parser = new Parser({ strict: true, maxMetaEntrySize: 1024 * 1024 });
    parser.on("error", reject);
    parser.on("end", resolvePromise);
    parser.on("entry", entry => {
      try {
        assertLiteralInputPath(entry.path);
        assert.equal(entry.type, "File", `nonregular archive entry: ${entry.path}`);
        assert.ok(!files.has(entry.path) && files.size < 10000, "duplicate or excessive archive entries");
        admit(entry.path);
        expanded += entry.size;
        assert.ok(entry.size <= 32 * 1024 * 1024 && expanded <= 128 * 1024 * 1024, "expanded archive budget");
        const chunks = [];
        let length = 0;
        files.set(entry.path, undefined);
        entry.on("data", chunk => { length += chunk.length; chunks.push(chunk); });
        entry.on("end", () => {
          try { assert.equal(length, entry.size); files.set(entry.path, Buffer.concat(chunks)); }
          catch (error) { reject(error); }
        });
      } catch (error) { parser.abort(error); reject(error); }
    });
    parser.end(bytes);
  });
  return files;
}

export function assertTypeOrigins(files, consumer, installed, library) {
  for (const filename of files) {
    const canonical = realpathSync(filename.trim());
    assert.ok(contained(consumer, canonical) || (contained(library, canonical) && /^lib\.[^/]+\.d\.ts$/u.test(relative(library, canonical))), `TypeScript source fallback: ${canonical}`);
    if (contained(installed, canonical)) assert.ok(contained(join(installed, "dist"), canonical) && canonical.endsWith(".d.ts"), `TypeScript source fallback: ${canonical}`);
  }
}
