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

const nativeSeek = Object.freeze({
  specifier: "#safe-fs-native-seek",
  directory: "packages/safe-js/dist/native/fs-seek",
  napi: 6,
  maxBinaryBytes: 1048576,
  target: Object.freeze({ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31" }),
});

function nativeObject(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Native peer metadata requires an object");
  if (keys) assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), "Native peer metadata schema changed");
  return value;
}

function nativeHash(value) {
  assert.ok(typeof value === "string" && value.length === 64 && [...value].every(character => "0123456789abcdef".includes(character)), "Native peer digest must be lowercase sha256");
}

function nativeSize(value, limit) {
  assert.ok(Number.isSafeInteger(value) && value > 0 && value <= limit, "Native peer asset exceeds its finite byte limit");
}

function nativeDirectoryMembers(io, tooling, directory, expected) {
  const path = join(tooling, directory), stat = io.lstatSync(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && io.realpathSync(path) === resolve(path), "Native peer asset directory redirects");
  const names = io.readdirSync(path);
  assert.deepEqual([...names].sort(), [...expected].sort(), "Native peer asset closure membership changed");
  for (const name of names) {
    const child = io.lstatSync(join(path, name));
    assert.ok(child.isFile() && !child.isSymbolicLink(), "Native peer assets must be regular files");
  }
}

function nativeImports(source, binaryNames) {
  const imports = new Set(), factories = new Set(), urlConverters = new Set(), requires = new Set();
  const declarations = new Map();
  const program = ts.createProgram([source.fileName], { allowJs: true, noLib: true, noResolve: true }, {
    getSourceFile: path => path === source.fileName ? source : undefined,
    getDefaultLibFileName: () => "",
    writeFile: () => assert.fail("Native peer AST validation cannot emit"),
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: path => path === source.fileName,
    readFile: path => path === source.fileName ? source.text : undefined,
  });
  const checker = program.getTypeChecker();
  const metaUrl = node => ts.isPropertyAccessExpression(node) && node.name.text === "url" && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.expression.name.text === "meta";
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (statement.moduleSpecifier.text === "node:module" && statement.importClause) {
      assert.ok(!statement.importClause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(binding => (binding.propertyName ?? binding.name).text === "createRequire"), "Native peer module access requires the named createRequire boundary");
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text;
      if (statement.moduleSpecifier.text === "node:module" && name === "createRequire") factories.add(checker.getSymbolAtLocation(binding.name));
      if (statement.moduleSpecifier.text === "node:url" && name === "fileURLToPath") urlConverters.add(checker.getSymbolAtLocation(binding.name));
    }
  }
  const createRequire = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.has(checker.getSymbolAtLocation(node.expression)) && node.arguments.length === 1 && metaUrl(node.arguments[0]);
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(checker.getSymbolAtLocation(node.name), node);
      if (createRequire(node.initializer)) {
        assert.ok(ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const), "Native peer require must be a retained const binding");
        requires.add(checker.getSymbolAtLocation(node.name));
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const adjacent = argument => {
    if (ts.isStringLiteral(argument)) return argument.text.startsWith("./") && binaryNames.has(argument.text.slice(2));
    if (!ts.isIdentifier(argument)) return false;
    const declaration = declarations.get(checker.getSymbolAtLocation(argument)), initializer = declaration?.initializer;
    if (!declaration || !(declaration.parent.flags & ts.NodeFlags.Const) || !initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression) || !urlConverters.has(checker.getSymbolAtLocation(initializer.expression)) || initializer.arguments.length !== 1) return false;
    const url = initializer.arguments[0];
    if (!ts.isNewExpression(url) || !ts.isIdentifier(url.expression) || url.expression.text !== "URL" || checker.getSymbolAtLocation(url.expression) || url.arguments?.length !== 2 || !metaUrl(url.arguments[1])) return false;
    const template = url.arguments[0];
    if (!ts.isTemplateExpression(template) || template.head.text !== "" || template.templateSpans.length !== 3) return false;
    let target;
    return template.templateSpans.every((span, index) => {
      if (!ts.isPropertyAccessExpression(span.expression) || !ts.isIdentifier(span.expression.expression) || span.expression.name.text !== ["platform", "arch", "libc"][index] || span.literal.text !== (index === 2 ? ".node" : "-")) return false;
      const current = checker.getSymbolAtLocation(span.expression.expression);
      if (index === 0) target = current;
      return Boolean(current) && current === target;
    });
  };
  const builtin = node => {
    assert.ok(node && ts.isStringLiteral(node) && isBuiltin(node.text), "Native peer loader permits builtin imports only");
    imports.add(node.text);
  };
  const visit = node => {
    if (ts.isIdentifier(node) && (factories.has(checker.getSymbolAtLocation(node)) || urlConverters.has(checker.getSymbolAtLocation(node)) || requires.has(checker.getSymbolAtLocation(node)))) {
      const parent = node.parent;
      assert.ok(ts.isImportSpecifier(parent) || ts.isVariableDeclaration(parent) && parent.name === node || ts.isCallExpression(parent) && parent.expression === node, "Native peer loader binding escapes its admitted call boundary");
    }
    if (ts.isPropertyAccessExpression(node) && ["require", "createRequire"].includes(node.name.text)) assert.fail("Indirect native peer require is not admitted");
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && ["require", "createRequire"].includes(node.argumentExpression.text)) assert.fail("Computed native peer require is not admitted");
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) builtin(node.moduleSpecifier);
    if (ts.isImportTypeNode(node)) {
      assert.ok(ts.isLiteralTypeNode(node.argument), "Native peer declaration import must be literal");
      builtin(node.argument.literal);
    }
    if (ts.isImportEqualsDeclaration(node)) {
      assert.ok(ts.isExternalModuleReference(node.moduleReference), "Native peer declaration import must be external");
      builtin(node.moduleReference.expression);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.equal(node.arguments.length, 1, "Native peer dynamic import requires one argument");
        builtin(node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && factories.has(checker.getSymbolAtLocation(node.expression))) {
        assert.ok(createRequire(node), "Native peer require must be relative to import.meta.url");
        const parent = node.parent;
        assert.ok(ts.isVariableDeclaration(parent) && parent.initializer === node || ts.isCallExpression(parent) && parent.expression === node, "Native peer require factory escapes");
      } else if (createRequire(node.expression) || ts.isIdentifier(node.expression) && requires.has(checker.getSymbolAtLocation(node.expression))) {
        assert.ok(node.arguments.length === 1 && adjacent(node.arguments[0]), "Native peer require escapes the registry-adjacent binary closure");
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") assert.fail("Unbound native peer require is not admitted");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(source.referencedFiles.length + source.typeReferenceDirectives.length + source.libReferenceDirectives.length, 0, "Native peer declaration references are not admitted");
  return imports;
}

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

export function resolvePeerProfile(root, io = filesystem) {
  root = io.realpathSync(root);
  const manifest = JSON.parse(regularBytes(io, join(root, "package.json")));
  assert.deepEqual(manifest.peerDependencies, { "poe-code": ">=13.0.0" }, "Canonical published peer range must remain explicit");
  assert.notEqual(manifest.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical peer must be required");
  const checkout = manifest.poeCode?.integration?.peerProfile === "checkout-root";
  const directory = checkout ? resolve(root, "../..") : io.realpathSync(join(root, "node_modules/poe-code"));
  const lockPath = join(checkout ? directory : root, "package-lock.json");
  const metadata = regularBytes(io, join(directory, "package.json"));
  const peer = JSON.parse(metadata), lock = JSON.parse(regularBytes(io, lockPath));
  assert.equal(peer.name, "poe-code");
  if (checkout) {
    assert.equal(relative(directory, root), "packages/safe-bash", "Checkout profile requires the integrated package location");
    assert.equal(manifest.private, true);
    assert.equal(manifest.devDependencies?.["poe-code"], "file:../..");
    assert.equal(peer.devDependencies?.["poe-code"], "file:.");
    assert.equal(lock.packages?.["packages/safe-bash"]?.devDependencies?.["poe-code"], "file:../..");
    assert.deepEqual(lock.packages?.["node_modules/poe-code"], { resolved: "", link: true });
    assert.equal(peer.exports?.["./safe-fs"]?.import, "./packages/safe-js/dist/safe-fs.js", "Public SafeFS must preserve shared SafeJS runtime identity");
    assert.equal(conditionalTarget(peer.exports?.["./safe-fs"]?.types, ["node", "default"]), "./packages/safe-fs/dist/index.d.ts");
    return { profile: "checkout-root", qualification: "integrated checkout; not published peer-range satisfaction", directory, metadata, peer, lock, lockPath, integrity: null };
  }
  const locked = lock.packages?.["node_modules/poe-code"];
  assert.equal(manifest.devDependencies?.["poe-code"], "13.0.0", "Release qualification requires the exact published development pin");
  assert.equal(peer.version, "13.0.0");
  assert.equal(locked?.version, peer.version);
  assert.equal(locked.resolved, "https://registry.npmjs.org/poe-code/-/poe-code-13.0.0.tgz");
  assert.match(locked.integrity, /^sha512-/u);
  return { profile: "registry-release", qualification: "published exact peer artifact required", directory, metadata, peer, lock, lockPath, integrity: locked.integrity };
}

export function bindPeerArtifact({ root, artifact, declarations, checkout = false, io = filesystem }) {
  assert.equal(typeof checkout, "boolean", "Checkout qualification requires an explicit boolean selector");
  root = io.realpathSync(root);
  const profile = resolvePeerProfile(root, io);
  if (checkout) {
    assert.equal(profile.profile, "checkout-root", "Only an explicit checkout profile may bind live built peer inputs");
    assert.equal(artifact, undefined, "Checkout and packed-root profiles must not be conflated");
  } else {
    assert.equal(typeof artifact, "string", "An explicit canonical peer artifact is required");
    artifact = join(io.realpathSync(dirname(resolve(artifact))), basename(artifact));
  }
  const manifestBytes = regularBytes(io, join(root, "package.json"));
  const lockBytes = regularBytes(io, profile.lockPath);
  const manifest = JSON.parse(manifestBytes), lock = JSON.parse(lockBytes);
  assert.deepEqual(manifest.peerDependencies, { "poe-code": ">=13.0.0" }, "This qualification profile requires only the canonical peer >=13.0.0");
  assert.notEqual(manifest.peerDependenciesMeta?.["poe-code"]?.optional, true, "Canonical peer must be required");
  if (profile.profile === "registry-release") {
    assert.deepEqual(lock.packages?.[""]?.peerDependencies, manifest.peerDependencies, "Locked required peers differ");
    assert.equal(lock.packages?.[""]?.devDependencies?.["poe-code"], "13.0.0", "Locked development pin differs");
  }
  const compressed = checkout ? undefined : regularBytes(io, artifact, 64 * 1024 * 1024);
  if (profile.integrity !== null) assert.equal(`sha512-${createHash("sha512").update(compressed).digest("base64")}`, profile.integrity, "Canonical peer artifact SRI mismatch");
  const archive = checkout ? undefined : archiveFiles(compressed), metadata = checkout ? profile.metadata : archive.get("package.json");
  assert.ok(metadata, "Peer artifact has no package metadata");
  const peer = JSON.parse(metadata);
  assert.equal(peer.name, "poe-code");
  assert.equal(digest(metadata), digest(profile.metadata), "Artifact must match the selected canonical peer metadata");
  assert.equal(peer.type, "module");
  const declaration = declarations?.peer;
  assert.ok(declaration?.declarations instanceof Map && declaration.publicEntries instanceof Map && declaration.publicEntries.size > 0, "Authenticated public declaration binding is required");
  assert.equal(declaration.version, peer.version);
  assert.equal(declaration.integrity, profile.integrity);
  assert.equal(declaration.metadataSha256, digest(metadata), "Declaration peer metadata differs from artifact");
  const tooling = profile.directory;
  assert.ok(io.lstatSync(tooling).isDirectory() && !io.lstatSync(tooling).isSymbolicLink(), "Build peer directory must not redirect");
  const selected = new Map([["package.json", Buffer.from(metadata)]]), declarationPaths = new Set(), nativeDirectories = new Map(), captureLimits = new Map();
  const capture = (local, limit = 16 * 1024 * 1024) => {
    limit = Math.min(limit, captureLimits.get(local) ?? limit);
    assert.ok(local.startsWith("packages/") && local.includes("/dist/") && contained(tooling, resolve(tooling, local)), `Peer closure requires built package paths: ${local}`);
    assert.ok(!local.split("/").some(part => part.toLowerCase() === "xan"), "Held peer input is forbidden");
    assert.ok(selected.size < 256, "Peer closure exceeds member bound");
    const bytes = checkout ? regularBytes(io, join(tooling, local), limit) : archive.get(local);
    assert.ok(bytes, `Peer closure missing from artifact: ${local}`);
    assert.ok(bytes.length <= limit, `Peer closure member exceeds its byte bound: ${local}`);
    assert.equal(digest(regularBytes(io, join(tooling, local), limit)), digest(bytes), `Build peer differs from artifact: ${local}`);
    if (!selected.has(local)) selected.set(local, Buffer.from(bytes));
    captureLimits.set(local, limit);
    assert.ok([...selected.values()].reduce((total, value) => total + value.length, 0) <= 32 * 1024 * 1024, "Peer closure exceeds byte bound");
    return bytes;
  };
  assert.equal(digest(regularBytes(io, join(tooling, "package.json"))), digest(metadata), "Build peer metadata differs from artifact");
  for (const [path, expected] of declaration.declarations) {
    assert.match(path, /\.d\.(?:ts|mts|cts)$/u, "Peer declaration binding must contain declarations only");
    assert.equal(digest(capture(path)), expected, `Peer declaration differs from binding: ${path}`);
    declarationPaths.add(path);
  }
  let native;
  const nativeRuntime = importer => {
    assert.ok(importer.startsWith("packages/safe-js/dist/") && !importer.startsWith("packages/safe-js/dist/browser/") && !importer.startsWith(`${nativeSeek.directory}/`), "Private native peer edge requires the canonical Node runtime");
    assert.equal(peer.exports?.["./safe-fs"]?.import, "./packages/safe-js/dist/safe-fs.js", "Native peer requires canonical Node SafeFS ownership");
    const mapping = nativeObject(peer.imports?.[nativeSeek.specifier]);
    assert.deepEqual(Object.keys(mapping), ["types", "workerd", "browser", "default"], "Native peer import condition order changed");
    assert.deepEqual(mapping, { types: `./${nativeSeek.directory}/loader.d.ts`, workerd: null, browser: null, default: `./${nativeSeek.directory}/loader.mjs` }, "Native peer import mapping changed");
    if (native) return native.loader;
    const directory = nativeSeek.directory;
    for (const scope of ["packages/safe-js/dist/package.json", "packages/safe-js/dist/native/package.json"]) {
      assert.ok(!io.existsSync(join(tooling, scope)) && !archive?.has(scope), "Native peer cannot introduce a nested package scope");
    }
    const manifest = nativeObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(capture(`${directory}/manifest.json`, 16384))), ["version", "napi", "maxBinaryBytes", "targets", "build"]);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.napi, nativeSeek.napi);
    assert.equal(manifest.maxBinaryBytes, nativeSeek.maxBinaryBytes);
    assert.ok(Array.isArray(manifest.targets) && manifest.targets.length <= 1, "Native peer target set is outside the qualified registry projection");
    const names = ["loader.mjs", "loader.d.ts", "manifest.json"];
    const binaryName = `${nativeSeek.target.platform}-${nativeSeek.target.arch}-${nativeSeek.target.libc}.node`;
    for (const target of manifest.targets) {
      nativeObject(target, ["platform", "arch", "libc", "minimumLibc", "size", "sha256"]);
      for (const [key, value] of Object.entries(nativeSeek.target)) assert.equal(target[key], value, "Native peer target differs from the qualified registry projection");
      nativeSize(target.size, nativeSeek.maxBinaryBytes);
      nativeHash(target.sha256);
      names.push(binaryName);
    }
    nativeDirectoryMembers(io, tooling, directory, names);
    if (archive) assert.deepEqual([...archive.keys()].filter(path => path.startsWith(`${directory}/`)).sort(), names.map(name => `${directory}/${name}`).sort(), "Packed native peer asset closure membership changed");
    const build = nativeObject(manifest.build, ["sourceSha256", "loaderSha256", "declarationSha256", "headers", "compiler"]);
    for (const key of ["sourceSha256", "loaderSha256", "declarationSha256"]) nativeHash(build[key]);
    if (manifest.targets.length === 0) {
      assert.equal(build.headers, null, "Empty native target set requires null header provenance");
      assert.equal(build.compiler, null, "Empty native target set requires null compiler provenance");
    } else {
      const headers = nativeObject(build.headers, ["version", "files"]);
      assert.equal(headers.version, "1.9.0");
      const files = nativeObject(headers.files), entries = Object.entries(files);
      assert.ok(entries.length > 0 && entries.length <= 32, "Native header provenance exceeds bound");
      for (const [name, entry] of entries) {
        assert.ok(name.length <= 128 && name.endsWith(".h") && [...name].every(character => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-".includes(character)), "Invalid native header provenance basename");
        nativeObject(entry, ["size", "sha256"]);
        nativeSize(entry.size, 1048576); nativeHash(entry.sha256);
      }
      const compiler = nativeObject(build.compiler, ["path", "sha256", "version"]);
      assert.equal(compiler.path, "/usr/bin/cc");
      nativeHash(compiler.sha256);
      assert.ok(typeof compiler.version === "string" && compiler.version.length > 0 && compiler.version.length <= 8192 && !compiler.version.includes("\0"), "Invalid native compiler provenance");
    }
    for (const target of manifest.targets) {
      const bytes = capture(`${directory}/${binaryName}`, nativeSeek.maxBinaryBytes);
      assert.equal(bytes.length, target.size, "Native peer binary size differs from manifest");
      assert.equal(digest(bytes), target.sha256, "Native peer binary digest differs from manifest");
    }
    const loader = `${directory}/loader.mjs`, types = `${directory}/loader.d.ts`;
    assert.equal(digest(capture(loader, 65536)), build.loaderSha256, "Native peer loader digest differs from manifest");
    const typeBytes = capture(types, 65536);
    assert.equal(digest(typeBytes), build.declarationSha256, "Native peer declaration digest differs from manifest");
    const source = ts.createSourceFile(types, new TextDecoder("utf-8", { fatal: true }).decode(typeBytes), ts.ScriptTarget.Latest, true);
    assert.equal(source.parseDiagnostics.length, 0, "Invalid native peer declaration syntax");
    nativeImports(source, new Set());
    declarationPaths.add(types);
    native = { loader, binaryNames: new Set([binaryName]) };
    nativeDirectories.set(directory, [...names]);
    return loader;
  };
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
    const runtime = publicRuntime(specifier);
    if (profile.profile === "checkout-root" && specifier === "poe-code/safe-fs/core") {
      assert.equal(path, "packages/safe-fs/dist/core.d.ts", "Public SafeFS core must select the portable declaration entry");
      assert.equal(runtime, "packages/safe-js/dist/safe-fs-core.js", "Public SafeFS core must preserve shared SafeJS runtime identity");
    }
    pending.push(runtime);
  }
  const edges = {}, nativeEdges = [];
  while (pending.length) {
    const local = pending.pop();
    if (Object.hasOwn(edges, local)) continue;
    assert.ok(Object.keys(edges).length < 1024, "Peer runtime closure exceeds file bound");
    assert.match(local, /\.(?:js|mjs)$/u, "Peer runtime requires built ESM");
    const bytes = capture(local, native?.loader === local ? 65536 : 16 * 1024 * 1024);
    const source = ts.createSourceFile(local, native?.loader === local ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes.toString("utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, `Invalid peer runtime source: ${local}`);
    const imports = native?.loader === local ? nativeImports(source, native.binaryNames) : new Set();
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
    if (native?.loader !== local) visit(source);
    edges[local] = {};
    for (const specifier of imports) {
      if (isBuiltin(specifier)) { edges[local][specifier] = specifier; continue; }
      let target;
      if (specifier === nativeSeek.specifier) {
        target = nativeRuntime(local);
        nativeEdges.push(Object.freeze({ importer: local, specifier, target }));
      }
      else if (specifier.startsWith(".")) {
        target = relative(tooling, resolve(tooling, dirname(local), specifier));
        assert.ok(!target.startsWith(`${nativeSeek.directory}/`), "Native peer assets require the exact private import boundary");
      }
      else target = publicRuntime(specifier);
      capture(target);
      edges[local][specifier] = target;
      pending.push(target);
    }
  }
  const result = Object.freeze({ profile: checkout ? "checkout-root" : profile.profile === "checkout-root" ? "packed-root" : profile.profile, qualification: profile.qualification, version: peer.version, integrity: profile.integrity, tarballSha256: compressed ? digest(compressed) : null, metadataSha256: digest(metadata), entries: Object.freeze(entries), runtimeFiles: Object.keys(edges).length, declarationFiles: declarationPaths.size, files: Object.freeze([...selected].map(([path, bytes]) => Object.freeze({ path, sha256: digest(bytes) }))) });
  const runtimeFacts = Object.freeze({
    edges: Object.freeze(Object.fromEntries(Object.entries(edges).map(([path, imports]) => [path, Object.freeze(imports)]))),
    nativeEdges: Object.freeze(nativeEdges),
    nativeAssets: Object.freeze([...nativeDirectories].flatMap(([directory, names]) => names.map(name => {
      const path = `${directory}/${name}`;
      return Object.freeze({ path, sha256: digest(selected.get(path)), maxBytes: captureLimits.get(path) });
    }))),
  });
  bindings.set(result, { io, root, tooling, artifact, selected, declarationPaths, nativeDirectories, captureLimits, runtimeFacts, lockPath: profile.lockPath, manifestSha256: digest(manifestBytes), lockSha256: digest(lockBytes) });
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
  assert.equal(digest(regularBytes(io, state.lockPath)), state.lockSha256, "Source lock changed after peer admission");
  for (const [path, bytes] of selected) assert.equal(digest(regularBytes(io, join(tooling, path), state.captureLimits.get(path))), digest(bytes), `Build peer changed after admission: ${path}`);
  for (const [directory, names] of state.nativeDirectories) nativeDirectoryMembers(io, tooling, directory, names);
  if (state.artifact) assert.equal(digest(regularBytes(io, state.artifact, 64 * 1024 * 1024)), binding.tarballSha256, "Peer artifact changed after admission");
}

export function capturePeerRuntimeFacts(binding, consumer) {
  const state = stateFor(binding);
  assertInputs(binding, state);
  assertPeerArtifact(binding, consumer);
  return state.runtimeFacts;
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
  const destination = join(io.realpathSync(consumer), "node_modules/poe-code"), actual = new Map();
  for (const [directory, names] of state.nativeDirectories) nativeDirectoryMembers(io, destination, directory, names);
  const walk = directory => {
    assert.ok(io.lstatSync(directory).isDirectory() && !io.lstatSync(directory).isSymbolicLink() && io.realpathSync(directory) === directory, "Consumer peer directory redirects");
    for (const name of io.readdirSync(directory)) {
      const path = join(directory, name), stat = io.lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else {
        const local = relative(destination, path);
        actual.set(local, digest(regularBytes(io, path, state.captureLimits.get(local))));
      }
    }
  };
  walk(destination);
  assert.deepEqual([...actual.keys()].sort(), [...selected.keys()].sort(), "Consumer peer closure file set changed");
  for (const [path, bytes] of selected) assert.equal(actual.get(path), digest(bytes), `Consumer peer bytes changed: ${path}`);
}

export function assertPeerDeclarationFiles(binding, files, consumer) {
  const { io, declarationPaths, captureLimits } = stateFor(binding);
  const destination = join(io.realpathSync(consumer), "node_modules/poe-code");
  for (const path of files) {
    if (!path.includes("/node_modules/poe-code/")) continue;
    assert.ok(contained(destination, path), `Foreign peer declaration fallback: ${path}`);
    assert.ok(declarationPaths.has(relative(destination, path)), `Unadmitted peer declaration closure: ${path}`);
    regularBytes(io, path, captureLimits.get(relative(destination, path)));
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
