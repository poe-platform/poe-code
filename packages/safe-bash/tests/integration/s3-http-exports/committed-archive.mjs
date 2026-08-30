import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBoundaries } from "../../../scripts/integration-inputs.mjs";
import { assertAdmittedInputPath, assertLiteralInputPath, isHeldInputPath, readRegularInput } from "../../../scripts/typecheck-integration-inputs.mjs";

export const packagePrefix = "packages/safe-bash";
export const authority = fileURLToPath(new URL("../../../", import.meta.url));
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const contained = (root, filename) => {
  const local = relative(root, filename);
  return !isAbsolute(local) && local !== ".." && !local.startsWith("../");
};

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

export function inspectCommittedCandidate(repository, revision, directory, execute = spawnSync) {
  const boundaries = loadBoundaries(authority);
  const environment = cleanEnvironment(directory);
  const git = args => {
    const result = execute("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: repository, env: environment, timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr?.toString());
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
    const [mode, type, oid] = record.slice(0, separator).split(" ");
    const path = record.slice(separator + 1);
    assert.ok(!tree.has(path), "duplicate committed tree path");
    tree.set(path, { mode, type, oid });
  }
  assert.ok(tree.has(`${packagePrefix}/package.json`), "actual commit lacks integrated package prefix packages/safe-bash; staging or source-parent commits do not qualify");
  const files = new Map();
  const blobReads = [];
  let admittedBytes = 0;
  const readBlob = (path, maximum = 16 * 1024 * 1024) => {
    assertLiteralInputPath(path);
    if (path.startsWith(`${packagePrefix}/`)) assertAdmittedInputPath(path.slice(packagePrefix.length + 1), boundaries);
    else assert.ok(["package.json", "package-lock.json", "scripts/guard-package-dist.mjs"].includes(path), `unadmitted root archive path: ${path}`);
    const entry = tree.get(path);
    assert.ok(entry, `missing committed input: ${path}`);
    assert.ok(entry.type === "blob" && ["100644", "100755"].includes(entry.mode), `not a regular committed input: ${path}`);
    assert.match(entry.oid, hashAlgorithm === "sha1" ? /^[a-f0-9]{40}$/u : /^[a-f0-9]{64}$/u);
    if (files.has(path)) return files.get(path);
    const size = Number(git(["cat-file", "-s", entry.oid]).toString().trim());
    assert.ok(Number.isSafeInteger(size) && size >= 0 && size <= maximum, `committed blob size: ${path}`);
    admittedBytes += size;
    assert.ok(admittedBytes <= 128 * 1024 * 1024, "committed source archive byte budget");
    blobReads.push(path);
    const bytes = git(["cat-file", "blob", entry.oid]);
    assert.equal(bytes.length, size);
    const oid = createHash(hashAlgorithm).update(`blob ${size}\0`).update(bytes).digest("hex");
    assert.equal(oid, entry.oid, `committed blob identity: ${path}`);
    files.set(path, bytes);
    return bytes;
  };
  const reviewed = ["tsconfig.json", "tsconfig.build.json", "integration-boundaries.json", "scripts/integration-inputs.mjs", "scripts/typecheck-integration-inputs.mjs"];
  assert.ok(tree.has("scripts/guard-package-dist.mjs"), "missing committed root output guard");
  assert.deepEqual(readBlob("scripts/guard-package-dist.mjs"), readRegularInput(resolve(authority, "../.."), "scripts/guard-package-dist.mjs", 300000), "committed guard differs from reviewed verifier authority");
  for (const path of reviewed) assert.deepEqual(readBlob(`${packagePrefix}/${path}`, 300000), readRegularInput(authority, path, 300000, undefined, boundaries), `committed build input differs from reviewed authority: ${path}`);
  for (const fixture of boundaries.fixtureDirectories) assert.equal(digest(readBlob(`${packagePrefix}/${fixture.owner}`, 300000)), fixture.sha256, `committed fixture owner changed: ${fixture.owner}`);
  const manifest = JSON.parse(readBlob(`${packagePrefix}/package.json`, 300000));
  const rootManifest = JSON.parse(readBlob("package.json", 300000));
  const lock = JSON.parse(readBlob("package-lock.json"));
  assert.equal(manifest.name, "virtual-bash");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=22");
  assert.deepEqual(manifest.files, ["dist"]);
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "bundleDependencies"]) assert.equal(Object.keys(manifest[key] ?? {}).length, 0, `runtime dependency: ${key}`);
  for (const key of ["prepare", "prepublish", "prepublishOnly", "prepack", "postpack", "preinstall", "install", "postinstall", "prebuild", "postbuild"]) assert.ok(!Object.hasOwn(manifest.scripts, key), `unapproved package lifecycle: ${key}`);
  assert.equal(manifest.scripts.build, "node ../../scripts/guard-package-dist.mjs && node scripts/integration-inputs.mjs && tsc -p tsconfig.build.json", "unreviewed committed build command");
  assert.equal(rootManifest.name, "poe-code");
  assert.ok(rootManifest.workspaces.includes("packages/*"), "workspace package prefix missing");
  for (const [path, conditions] of Object.entries(manifest.exports)) {
    const name = path === "." ? "./safe-bash" : `./safe-bash${path.slice(1)}`;
    assert.deepEqual(rootManifest.exports[name], Object.fromEntries(Object.entries(conditions).map(([condition, target]) => [condition, `./${packagePrefix}/${target.slice(2)}`])), `root export mismatch: ${name}`);
  }
  assert.equal(lock.lockfileVersion, 3, "workspace lock version");
  for (const [key, expected] of [["", rootManifest], [packagePrefix, manifest]]) {
    for (const field of ["name", "version", "dependencies", "devDependencies", "optionalDependencies", "engines", ...(key === "" ? ["workspaces"] : [])]) {
      assert.deepEqual(lock.packages?.[key]?.[field], expected[field], `workspace lock drift: ${key || "root"} ${field}`);
    }
  }
  assert.deepEqual(lock.packages["node_modules/virtual-bash"], { resolved: packagePrefix, link: true }, "workspace lock link drift");
  readBlob(`${packagePrefix}/README.md`);
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
    readBlob(path);
  }
  assert.ok(files.has(`${packagePrefix}/src/index.ts`), "missing committed source entrypoint");
  assert.deepEqual(heldCode.sort(), boundaries.heldSourceFiles.filter(path => path.endsWith(".ts")).sort(), "committed held source metadata inventory changed");
  return { sourceCommit, files, blobReads, withheldPaths, manifest, rootManifest, lock, boundaries, environment };
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
  return { packages, identities, npmCli, pack: npmRequire.resolve("libnpmpack"), tar: npmRequire("tar") };
}

export function copyRegularTree(source, destination) {
  const inventory = [];
  const visit = local => {
    for (const entry of readdirSync(join(source, local), { withFileTypes: true })) {
      const path = local ? `${local}/${entry.name}` : entry.name;
      assertLiteralInputPath(path);
      assert.ok(!entry.isSymbolicLink(), `unadmitted symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else {
        const bytes = readRegularInput(source, path, 32 * 1024 * 1024);
        mkdirSync(dirname(join(destination, path)), { recursive: true });
        writeFileSync(join(destination, path), bytes);
        inventory.push({ path, bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  };
  visit("");
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
    const parser = new tar.Parser({ strict: true, maxMetaEntrySize: 1024 * 1024 });
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
