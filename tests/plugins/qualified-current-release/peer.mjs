import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import ts from "typescript";

const bindings = new WeakMap();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const contained = (root, path) => {
  const local = relative(root, path);
  return !isAbsolute(local) && local !== ".." && !local.startsWith("../");
};

function regularBytes(io, path, limit = 16 * 1024 * 1024) {
  const stat = io.lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit, `Expected bounded regular file: ${path}`);
  assert.equal(io.realpathSync(path), resolve(path), `File redirects through a symlink: ${path}`);
  const bytes = io.readFileSync(path);
  assert.equal(bytes.length, stat.size, `File changed while reading: ${path}`);
  return bytes;
}

function archiveFiles(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: 128 * 1024 * 1024 });
  assert.equal(bytes.length % 512, 0, "Peer archive is not block aligned");
  const files = new Map();
  let offset = 0;
  const text = field => field.subarray(0, field.indexOf(0) < 0 ? field.length : field.indexOf(0)).toString("utf8");
  const octal = field => {
    const value = text(field).trim();
    assert.match(value, /^[0-7]+$/u, "Peer archive requires octal header values");
    return Number.parseInt(value, 8);
  };
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    assert.ok(files.size < 20000, "Peer archive exceeds member bound");
    assert.equal(text(header.subarray(257, 263)), "ustar", "Peer archive requires USTAR headers");
    assert.ok(header[156] === 48 || header[156] === 0, "Peer archive permits regular files only");
    const checksum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(octal(header.subarray(148, 156)), checksum, "Peer archive header checksum mismatch");
    const prefix = text(header.subarray(345, 500));
    const path = `${prefix ? `${prefix}/` : ""}${text(header.subarray(0, 100))}`;
    assert.ok(path.startsWith("package/") && !path.includes("\\") && path.split("/").every(part => part !== "" && part !== "." && part !== ".."), `Unsafe peer archive path: ${path}`);
    const local = path.slice("package/".length), size = octal(header.subarray(124, 136));
    assert.ok(size <= 16 * 1024 * 1024 && offset + 512 + size <= bytes.length, "Peer archive member exceeds bounds");
    assert.equal(files.has(local), false, `Duplicate peer archive path: ${path}`);
    files.set(local, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(files.size > 0 && bytes.length - offset >= 1024 && bytes.subarray(offset).every(byte => byte === 0), "Peer archive requires an intact empty trailer");
  return files;
}

function conditionalTarget(entry, conditions) {
  if (typeof entry === "string" || entry === null) return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  for (const [condition, value] of Object.entries(entry)) {
    if (!conditions.includes(condition)) continue;
    const target = conditionalTarget(value, conditions);
    if (target !== undefined) return target;
  }
}

export function bindPeerArtifact({ root, artifact, declarations, io = filesystem }) {
  root = io.realpathSync(root);
  assert.equal(typeof artifact, "string", "An explicit canonical peer artifact is required");
  artifact = join(io.realpathSync(dirname(resolve(artifact))), basename(artifact));
  const manifestBytes = regularBytes(io, join(root, "package.json"));
  const lockBytes = regularBytes(io, join(root, "package-lock.json"));
  const manifest = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes);
  assert.deepEqual(manifest.peerDependencies, { "poe-code": ">=13.0.0" }, "This qualification profile requires only the canonical peer >=13.0.0");
  assert.notEqual(manifest.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical peer must be required");
  assert.equal(manifest.devDependencies?.["poe-code"], "13.0.0", "Qualification requires the exact published development pin");
  assert.deepEqual(lock.packages?.[""]?.peerDependencies, manifest.peerDependencies, "Locked required peers differ");
  assert.equal(lock.packages?.[""]?.devDependencies?.["poe-code"], "13.0.0", "Locked development pin differs");
  const locked = lock.packages["node_modules/poe-code"];
  assert.equal(locked.version, "13.0.0");
  assert.equal(locked.resolved, "https://registry.npmjs.org/poe-code/-/poe-code-13.0.0.tgz", "Peer must identify the published registry artifact");
  const compressed = regularBytes(io, artifact, 64 * 1024 * 1024);
  assert.equal(`sha512-${createHash("sha512").update(compressed).digest("base64")}`, locked.integrity, "Canonical peer artifact SRI mismatch");
  const archive = archiveFiles(compressed), metadata = archive.get("package.json");
  assert.ok(metadata, "Peer artifact has no package metadata");
  const peer = JSON.parse(metadata);
  assert.equal(peer.name, "poe-code");
  assert.equal(peer.version, locked.version);
  assert.equal(peer.type, "module");
  const declaration = declarations?.peer;
  assert.ok(declaration?.declarations instanceof Map && declaration.publicEntries instanceof Map && declaration.publicEntries.size > 0, "Authenticated public declaration binding is required");
  assert.equal(declaration.version, peer.version);
  assert.equal(declaration.integrity, locked.integrity);
  assert.equal(declaration.metadataSha256, digest(metadata), "Declaration peer metadata differs from artifact");
  const tooling = join(root, "node_modules/poe-code");
  assert.ok(io.lstatSync(tooling).isDirectory() && !io.lstatSync(tooling).isSymbolicLink(), "Build peer directory must not redirect");
  const selected = new Map([["package.json", Buffer.from(metadata)]]), declarationPaths = new Set();
  const capture = local => {
    assert.ok(local.startsWith("packages/") && local.includes("/dist/") && contained(tooling, resolve(tooling, local)), `Peer closure requires built package paths: ${local}`);
    const bytes = archive.get(local);
    assert.ok(bytes, `Peer closure missing from artifact: ${local}`);
    assert.equal(digest(regularBytes(io, join(tooling, local))), digest(bytes), `Build peer differs from artifact: ${local}`);
    if (!selected.has(local)) selected.set(local, Buffer.from(bytes));
    return bytes;
  };
  assert.equal(digest(regularBytes(io, join(tooling, "package.json"))), digest(metadata), "Build peer metadata differs from artifact");
  for (const [path, expected] of declaration.declarations) {
    assert.match(path, /\.d\.(?:ts|mts|cts)$/u, "Peer declaration binding must contain declarations only");
    assert.equal(digest(capture(path)), expected, `Peer declaration differs from binding: ${path}`);
    declarationPaths.add(path);
  }
  const pending = [], entries = {};
  const publicRuntime = specifier => {
    assert.ok(specifier.startsWith("poe-code/"), `Unadmitted peer public route: ${specifier}`);
    const target = conditionalTarget(peer.exports?.[`.${specifier.slice("poe-code".length)}`], ["node", "import", "default"]);
    assert.ok(typeof target === "string" && target.startsWith("./"), `Peer public runtime route is not exported: ${specifier}`);
    const local = target.slice(2);
    assert.ok(contained(tooling, resolve(tooling, local)), "Peer public runtime route escapes package");
    entries[specifier] = local;
    return local;
  };
  for (const [specifier, path] of declaration.publicEntries) {
    const target = conditionalTarget(peer.exports?.[`.${specifier.slice("poe-code".length)}`], ["types", "node", "import", "default"]);
    assert.equal(target, `./${path}`, `Peer public declaration export changed: ${specifier}`);
    assert.ok(declarationPaths.has(path), "Public declaration is missing from the bound closure");
    pending.push(publicRuntime(specifier));
  }
  const edges = {};
  while (pending.length) {
    const local = pending.pop();
    if (Object.hasOwn(edges, local)) continue;
    assert.ok(Object.keys(edges).length < 1024, "Peer runtime closure exceeds file bound");
    assert.match(local, /\.(?:js|mjs)$/u, "Peer runtime requires built ESM");
    const source = ts.createSourceFile(local, capture(local).toString("utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, `Invalid peer runtime source: ${local}`);
    const imports = new Set();
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        assert.ok(ts.isStringLiteral(node.moduleSpecifier), "Runtime import must be literal");
        imports.add(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        assert.ok(node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]), "Dynamic runtime import is outside the admitted closure");
        imports.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    edges[local] = {};
    for (const specifier of imports) {
      if (isBuiltin(specifier)) { edges[local][specifier] = specifier; continue; }
      let target;
      if (specifier.startsWith(".")) target = relative(tooling, resolve(tooling, dirname(local), specifier));
      else target = publicRuntime(specifier);
      capture(target);
      edges[local][specifier] = target;
      pending.push(target);
    }
  }
  const result = Object.freeze({ version: peer.version, integrity: locked.integrity, tarballSha256: digest(compressed), metadataSha256: digest(metadata), entries: Object.freeze(entries), runtimeFiles: Object.keys(edges).length, declarationFiles: declarationPaths.size, files: Object.freeze([...selected].map(([path, bytes]) => Object.freeze({ path, sha256: digest(bytes) }))) });
  bindings.set(result, { io, root, tooling, artifact, selected, declarationPaths, manifestSha256: digest(manifestBytes), lockSha256: digest(lockBytes) });
  return result;
}

function stateFor(binding) {
  const state = bindings.get(binding);
  assert.ok(state, "Unknown canonical peer binding");
  return state;
}

function assertInputs(binding, state) {
  const { io, root, tooling, selected } = state;
  assert.equal(digest(regularBytes(io, join(root, "package.json"))), state.manifestSha256, "Source manifest changed after peer admission");
  assert.equal(digest(regularBytes(io, join(root, "package-lock.json"))), state.lockSha256, "Source lock changed after peer admission");
  for (const [path, bytes] of selected) assert.equal(digest(regularBytes(io, join(tooling, path))), digest(bytes), `Build peer changed after admission: ${path}`);
  assert.equal(digest(regularBytes(io, state.artifact, 64 * 1024 * 1024)), binding.tarballSha256, "Peer artifact changed after admission");
}

export function stagePeerArtifact(binding, consumer) {
  const state = stateFor(binding), { io, selected } = state;
  assertInputs(binding, state);
  consumer = io.realpathSync(consumer);
  const modules = join(consumer, "node_modules"), destination = join(modules, "poe-code");
  if (io.existsSync(modules)) assert.ok(io.lstatSync(modules).isDirectory() && !io.lstatSync(modules).isSymbolicLink() && io.realpathSync(modules) === modules, "Consumer modules directory redirects through a symlink");
  assert.equal(io.existsSync(destination), false, "Consumer already contains a canonical peer");
  for (const [path, bytes] of selected) {
    const target = join(destination, path);
    io.mkdirSync(dirname(target), { recursive: true });
    io.writeFileSync(target, bytes, { flag: "wx" });
  }
  assertPeerArtifact(binding, consumer);
}

export function assertPeerArtifact(binding, consumer) {
  const state = stateFor(binding), { io, selected } = state;
  const destination = join(io.realpathSync(consumer), "node_modules/poe-code"), actual = [];
  const walk = directory => {
    assert.ok(io.lstatSync(directory).isDirectory() && !io.lstatSync(directory).isSymbolicLink() && io.realpathSync(directory) === directory, "Consumer peer directory redirects");
    for (const name of io.readdirSync(directory)) {
      const path = join(directory, name), stat = io.lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else { regularBytes(io, path); actual.push(relative(destination, path)); }
    }
  };
  walk(destination);
  assert.deepEqual(actual.sort(), [...selected.keys()].sort(), "Consumer peer closure file set changed");
  for (const [path, bytes] of selected) assert.equal(digest(regularBytes(io, join(destination, path))), digest(bytes), `Consumer peer bytes changed: ${path}`);
}

export function assertPeerDeclarationFiles(binding, files, consumer) {
  const { io, declarationPaths } = stateFor(binding);
  const destination = join(io.realpathSync(consumer), "node_modules/poe-code");
  for (const path of files) {
    if (!path.includes("/node_modules/poe-code/")) continue;
    assert.ok(contained(destination, path), `Foreign peer declaration fallback: ${path}`);
    assert.ok(declarationPaths.has(relative(destination, path)), `Unadmitted peer declaration closure: ${path}`);
    regularBytes(io, path);
  }
  assertPeerArtifact(binding, consumer);
}

export function assertConsumerDeclarationFiles(files, installed, binding, io = filesystem) {
  installed = io.realpathSync(installed);
  const selected = files.filter(path => contained(installed, path) || path.includes("/node_modules/virtual-bash/"));
  assert.ok(selected.length > 0, "Consumer must include authenticated candidate declarations");
  for (const path of selected) {
    assert.ok(contained(join(installed, "dist"), path), `Candidate declaration used foreign/source fallback: ${path}`);
    const expected = binding.declarations.get(relative(installed, path));
    assert.equal(typeof expected, "string", `Candidate declaration is outside the bound closure: ${path}`);
    assert.equal(digest(regularBytes(io, path)), expected, `Candidate declaration bytes changed: ${path}`);
  }
}
