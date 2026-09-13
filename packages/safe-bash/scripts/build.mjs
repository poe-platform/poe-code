import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";
import { loadBoundaries, validateBoundaries } from "./integration-inputs.mjs";
import { assertLiteralInputPath, isHeldInputPath } from "./typecheck-integration-inputs.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

function declarationTools(optional) {
  const nodeTypes = dirname(require.resolve("@types/node/package.json"));
  return {
    typescriptLib: dirname(require.resolve("typescript")),
    nodeTypes,
    undiciTypes: dirname(require.resolve("undici-types/package.json", { paths: [nodeTypes] })),
    ...(optional ? { yaml: dirname(require.resolve("yaml/package.json")) } : {}),
  };
}

function below(root, path) {
  return path === root || path.startsWith(root + sep);
}

function compilerInputs(root, tools, fileSystem, optional, checkCancellation) {
  let boundaries;
  let sourceNames;
  const optionalSources = [];
  const inputHashes = new Map(), emittedHashes = new Map(), identities = new Map();
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  let loadingOwners = true;
  const metadataFiles = new Set(["package.json", "tsconfig.json", "tsconfig.build.json", "integration-boundaries.json"]);
  if (optional) metadataFiles.add("tsconfig.optional.json");
  const ownerFiles = new Set();
  const toolRoots = Object.values(tools).map(path => resolve(path));
  const peerMetadata = new Set();
  const directoryIndexes = new Map();
  const indexLimits = { directories: 256, names: 32768, characters: 1048576 };
  let indexedNames = 0, indexedCharacters = 0;
  const discardIndex = directory => {
    const cached = directoryIndexes.get(directory);
    if (!cached) return;
    directoryIndexes.delete(directory);
    indexedNames -= cached.count;
    indexedCharacters -= cached.characters;
  };
  const directoryName = (directory, stat, component) => {
    let identity = [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
    const cached = directoryIndexes.get(directory);
    if (cached && identity.every((value, index) => value === cached.identity[index])) {
      directoryIndexes.delete(directory);
      directoryIndexes.set(directory, cached);
      return cached.names.get(component.toLowerCase());
    }
    discardIndex(directory);
    const outside = directory !== root && (directory === sep || below(directory, root)) && !toolRoots.some(toolRoot => below(toolRoot, directory));
    let entries;
    const uncachedName = () => {
      const aliases = entries.filter(name => name.toLowerCase() === component.toLowerCase());
      return aliases.length > 1 ? null : aliases[0];
    };
    for (let attempt = 0; ; attempt += 1) {
      entries = fileSystem.readdirSync(directory);
      const after = fileSystem.lstatSync(directory);
      assert.ok(after.isDirectory() && !after.isSymbolicLink(), "compiler ancestor must be a nonlink directory: " + directory);
      if (!outside) { sameIdentity(stat, after); break; }
      for (const key of ["dev", "ino", "mode"]) assert.equal(after[key], stat[key], "compiler input identity changed: " + key);
      const afterIdentity = [after.dev, after.ino, after.mode, after.nlink, after.size, after.mtimeMs, after.ctimeMs];
      if (identity.every((value, index) => value === afterIdentity[index])) break;
      if (attempt === 2) return uncachedName();
      stat = after;
      identity = afterIdentity;
    }
    const complete = identity.every((value, index) => index < 5 ? Number.isSafeInteger(value) : Number.isFinite(value));
    if (!complete || entries.length > indexLimits.names) return uncachedName();
    let characters = directory.length;
    for (const name of entries) {
      characters += name.length + name.toLowerCase().length;
      if (characters > indexLimits.characters) return uncachedName();
    }
    if (characters > indexLimits.characters) return uncachedName();
    while (directoryIndexes.size >= indexLimits.directories || indexedNames + entries.length > indexLimits.names || indexedCharacters + characters > indexLimits.characters) {
      discardIndex(directoryIndexes.keys().next().value);
    }
    const names = new Map();
    for (const name of entries) {
      const folded = name.toLowerCase();
      names.set(folded, names.has(folded) ? null : name);
    }
    directoryIndexes.set(directory, { identity, names, count: entries.length, characters });
    indexedNames += entries.length;
    indexedCharacters += characters;
    return names.get(component.toLowerCase());
  };
  const held = path => {
    const absolute = resolve(root, path);
    if (below(root.toLowerCase(), absolute.toLowerCase())) {
      assert.equal(absolute.slice(0, root.length), root, "case alias of package root");
      const local = relative(root, absolute).split(sep).join("/");
      if (local) {
        assertLiteralInputPath(local);
        return boundaries ? isHeldInputPath(local, boundaries) : false;
      }
    }
    return false;
  };
  const scope = path => {
    const absolute = resolve(root, path);
    assert.ok(!held(absolute), "held compiler input: " + absolute);
    const local = relative(root, absolute).split(sep).join("/");
    if (local === "src" || local.startsWith("src/")) return "source";
    if (optional && emittedHashes.has(absolute)) return "output";
    if (metadataFiles.has(local) || (loadingOwners && ownerFiles.has(local))) return "metadata";
    if (peerMetadata.has(absolute)) return "metadata";
    if (toolRoots.some(directory => below(directory, absolute))) return "tool";
    const admitted = [join(root, "src"), ...toolRoots, ...peerMetadata, ...[...metadataFiles, ...ownerFiles].map(path => join(root, path))];
    if (admitted.some(path => below(absolute, path))) return "ancestor";
    return undefined;
  };
  const physical = path => {
    const absolute = resolve(root, path);
    let current = isAbsolute(absolute) ? sep : root;
    let stat = fileSystem.lstatSync(current);
    for (const component of absolute.split(sep).filter(Boolean)) {
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "compiler ancestor must be a nonlink directory: " + current);
      const name = directoryName(current, stat, component);
      if (name === undefined) return undefined;
      assert.ok(name === component, "noncanonical compiler path spelling: " + absolute);
      current = join(current, component);
      stat = fileSystem.lstatSync(current);
      assert.ok(!stat.isSymbolicLink(), "compiler path must not be a symlink: " + current);
    }
    assert.ok(stat.isDirectory() || (stat.isFile() && stat.nlink === 1), "compiler input must be regular and single-link: " + absolute);
    return stat;
  };
  const metadata = path => { checkCancellation(); return scope(path) ? physical(path) : undefined; };
  const sameIdentity = (before, after) => {
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) assert.equal(after[key], before[key], "compiler input identity changed: " + key);
  };
  const read = (path, maximum = Infinity) => {
    checkCancellation();
    const absolute = resolve(root, path);
    const kind = scope(absolute);
    if (!kind || kind === "ancestor") return undefined;
    if (kind === "source") {
      assert.ok(sourceNames?.has(absolute) || optionalSources.some(directory => below(directory, absolute)), "compiler source is outside admitted root names: " + absolute);
    }
    if (kind === "tool" && !(absolute.endsWith(".d.ts") || absolute.endsWith(".d.mts") || absolute.endsWith(".d.cts") || absolute.endsWith("/package.json"))) return undefined;
    const before = physical(absolute);
    if (!before) return undefined;
    assert.ok(before.isFile() && before.size <= maximum, "compiler input must be a bounded regular file: " + absolute);
    checkCancellation();
    const descriptor = fileSystem.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let failed = false, failure, bytes;
    try {
      checkCancellation();
      sameIdentity(before, fileSystem.fstatSync(descriptor));
      checkCancellation();
      bytes = fileSystem.readFileSync(descriptor);
      assert.equal(bytes.length, before.size, "compiler input size changed: " + absolute);
      sameIdentity(before, fileSystem.fstatSync(descriptor));
      sameIdentity(before, physical(absolute));
      checkCancellation();
    } catch (error) { failed = true; failure = error; }
    try { fileSystem.closeSync(descriptor); } catch (error) {
      if (failed) throw new AggregateError([failure, error], "compiler read and close failed");
      throw error;
    }
    if (failed) throw failure;
    checkCancellation();
    if (optional) {
      const hashes = kind === "output" ? emittedHashes : inputHashes;
      const digest = sha256(bytes);
      if (hashes.has(absolute)) assert.equal(hashes.get(absolute), digest, "compiler " + (kind === "output" ? "output" : "input") + " bytes changed: " + absolute);
      if (identities.has(absolute)) sameIdentity(identities.get(absolute), before);
      hashes.set(absolute, digest);
      identities.set(absolute, before);
    }
    return bytes;
  };
  const entries = path => {
    const files = [], directories = [];
    if (!metadata(path)?.isDirectory()) return { files, directories };
    for (const name of fileSystem.readdirSync(path).sort()) {
      const child = join(path, name);
      if (held(child)) continue;
      const stat = metadata(child);
      if (stat?.isDirectory()) directories.push(name);
      else if (stat?.isFile()) files.push(name);
    }
    return { files, directories };
  };
  const host = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => root,
    readFile: path => read(path)?.toString("utf8"),
    fileExists: path => metadata(path)?.isFile() ?? false,
    directoryExists: path => metadata(path)?.isDirectory() ?? false,
    getDirectories: path => entries(path).directories.map(name => join(path, name)),
    readDirectory: (path, extensions, excludes, includes, depth) => ts.matchFiles(resolve(root, path), extensions, excludes, includes, true, root, depth, entries, path => {
      assert.ok(metadata(path), "unadmitted compiler realpath: " + path);
      return resolve(root, path);
    }),
    realpath: path => {
      assert.ok(metadata(path), "unadmitted compiler realpath: " + path);
      return resolve(root, path);
    },
  };
  boundaries = validateBoundaries(JSON.parse(read(join(root, "integration-boundaries.json"), 300000)));
  for (const entry of boundaries.fixtureDirectories) ownerFiles.add(entry.owner);
  loadBoundaries(root, { readAdmittedInput: read });
  loadingOwners = false;
  ownerFiles.clear();
  return {
    host,
    bindings() {
      checkCancellation();
      for (const [path, before] of identities) sameIdentity(before, physical(path));
      return { inputHashes: Object.fromEntries(inputHashes), emittedHashes: Object.fromEntries(emittedHashes) };
    },
    admitPeer() {
      const manifest = JSON.parse(read(join(root, "package.json")));
      if (optional && tools.yaml) {
        assert.equal(manifest.peerDependenciesMeta?.yaml?.optional, true, "YAML declarations require the explicit optional peer");
        assert.ok(typeof manifest.peerDependencies?.yaml === "string", "YAML peer version must be declared");
        const yaml = JSON.parse(read(join(tools.yaml, "package.json")));
        assert.equal(yaml.name, "yaml", "YAML declaration package identity");
        assert.equal(yaml.version, manifest.peerDependencies.yaml, "YAML declaration version must match the fixed peer");
      }
      let peerPaths;
      if (manifest.peerDependencies?.["poe-code"]) {
        const checkout = manifest.poeCode?.integration?.peerProfile === "checkout-root";
        if (checkout) assert.equal(manifest.devDependencies?.["poe-code"], "file:../..", "checkout peer must use the explicit local root");
        const peerRoot = checkout ? resolve(root, "../..") : join(root, "node_modules/poe-code");
        peerMetadata.add(join(peerRoot, "package.json"));
        const peer = JSON.parse(read(join(peerRoot, "package.json")));
        assert.equal(peer.name, "poe-code", "canonical public peer identity");
        const exported = peer.exports?.["./safe-fs"];
        const target = typeof exported?.types === "string" ? exported.types : exported?.types?.default;
        assert.equal(target, "./packages/safe-fs/dist/index.d.ts", "canonical public SafeFS declaration entry");
        if (checkout) assert.equal(exported.import, "./packages/safe-js/dist/safe-fs.js", "canonical public SafeFS must use the shared SafeJS runtime");
        toolRoots.push(join(peerRoot, "packages/safe-fs/dist"));
        peerPaths = { "poe-code/safe-fs": [resolve(peerRoot, target)] };
        const core = peer.exports?.["./safe-fs/core"];
        if (core !== undefined) {
          const coreTarget = typeof core.types === "string" ? core.types : core.types?.default;
          assert.equal(coreTarget, "./packages/safe-fs/dist/core.d.ts", "canonical public SafeFS core declaration entry");
          if (checkout) assert.equal(core.import, "./packages/safe-js/dist/safe-fs-core.js", "canonical public SafeFS core must use the shared SafeJS runtime");
          peerPaths["poe-code/safe-fs/core"] = [resolve(peerRoot, coreTarget)];
        }
      }
      if (Object.keys(manifest.dependencies ?? {}).length) {
        const dependencies = { "@noble/hashes": "2.4.0", pako: "3.0.1" };
        const sharedArchive = Object.hasOwn(manifest.dependencies, "@poe-code/office-package");
        assert.deepEqual(manifest.dependencies, { ...dependencies, ...(sharedArchive ? { "@poe-code/office-package": "*" } : {}) }, "portable dependency contract");
        const dependencyBase = manifest.poeCode?.integration?.peerProfile === "checkout-root" ? resolve(root, "../..") : root;
        peerPaths ??= {};
        for (const [name, version] of Object.entries(dependencies)) {
          const dependencyRoot = join(dependencyBase, "node_modules", name);
          const metadataPath = join(dependencyRoot, "package.json");
          peerMetadata.add(metadataPath);
          const dependency = JSON.parse(read(metadataPath, 64 * 1024));
          assert.equal(dependency.name, name, "portable dependency identity");
          assert.equal(dependency.version, version, "portable dependency identity");
          assert.deepEqual(dependency.dependencies ?? {}, {}, "portable dependency must not introduce declaration dependencies");
          toolRoots.push(dependencyRoot);
          if (name === "pako") peerPaths[name] = [join(dependencyRoot, "dist/pako.d.ts")];
          else peerPaths[name + "/*"] = [join(dependencyRoot, "*")];
        }
        if (sharedArchive) {
          const checkout = manifest.poeCode?.integration?.peerProfile === "checkout-root";
          const dependencyRoot = checkout ? join(dependencyBase, "packages/office-package") : join(root, "node_modules/@poe-code/office-package");
          const metadataPath = join(dependencyRoot, "package.json");
          peerMetadata.add(metadataPath);
          const dependency = JSON.parse(read(metadataPath, 64 * 1024));
          assert.equal(dependency.name, "@poe-code/office-package", "shared archive dependency identity");
          assert.equal(dependency.version, "0.0.1", "shared archive dependency version");
          assert.deepEqual(dependency.dependencies, { pako: "3.0.1" }, "shared archive dependency closure");
          const exports = {
            ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
            "./zip": { types: "./dist/zip.d.ts", import: "./dist/zip.js" },
            "./compression": { types: "./dist/compression.d.ts", import: "./dist/compression.js" },
          };
          assert.deepEqual(dependency.exports, exports, "shared archive declaration exports");
          toolRoots.push(join(dependencyRoot, "dist"));
          for (const [name, entry] of Object.entries(exports)) {
            peerPaths["@poe-code/office-package" + (name === "." ? "" : name.slice(1))] = [resolve(dependencyRoot, entry.types)];
          }
        }
      }
      return peerPaths;
    },
    admitSources(paths) {
      sourceNames = new Set(paths.map(path => resolve(root, path)));
      for (const path of sourceNames) {
        assert.equal(scope(path), "source", "build root must be admitted source");
        assert.ok(metadata(path)?.isFile(), "build root must be a regular source file");
      }
      if (optional) {
        const manifest = JSON.parse(read(join(root, "package.json")));
        for (const entry of manifest.files ?? []) {
          if (!entry.startsWith("!")) continue;
          const path = entry.slice(1);
          assertLiteralInputPath(path);
          assert.ok(path.startsWith("dist/"), "optional ownership must be declared below dist");
          if (path.endsWith(".map")) continue;
          const source = "src/" + path.slice(5);
          optionalSources.push(join(root, source.endsWith(".d.ts") ? source.slice(0, -5) + ".ts" : source.endsWith(".js") ? source.slice(0, -3) + ".ts" : source));
        }
      }
    },
    writeFile(path, data, writeByteOrderMark) {
      checkCancellation();
      const absolute = resolve(root, path);
      const output = join(root, "dist");
      assert.ok(absolute !== output && below(output, absolute), "compiler output must remain below dist");
      let directory = root;
      for (const component of relative(root, dirname(absolute)).split(sep)) {
        directory = join(directory, component);
        if (!physical(directory)) fileSystem.mkdirSync(directory);
        assert.ok(physical(directory)?.isDirectory(), "compiler output ancestor must be a directory");
      }
      const before = physical(absolute);
      assert.ok(!before || before.isFile(), "compiler output must be a regular file");
      checkCancellation();
      const descriptor = fileSystem.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o666);
      let failed = false, failure;
      try {
        discardIndex(dirname(absolute));
        checkCancellation();
        const opened = fileSystem.fstatSync(descriptor);
        assert.ok(opened.isFile() && opened.nlink === 1, "compiler output must be regular and single-link");
        if (before) sameIdentity(before, opened);
        checkCancellation();
        fileSystem.ftruncateSync(descriptor, 0);
        checkCancellation();
        fileSystem.writeFileSync(descriptor, (writeByteOrderMark ? "\uFEFF" : "") + data, "utf8");
        checkCancellation();
      } catch (error) { failed = true; failure = error; }
      try { fileSystem.closeSync(descriptor); } catch (error) {
        if (failed) throw new AggregateError([failure, error], "compiler write and close failed");
        throw error;
      }
      if (failed) throw failure;
      checkCancellation();
      if (optional) {
        emittedHashes.set(absolute, sha256(Buffer.from((writeByteOrderMark ? "\uFEFF" : "") + data, "utf8")));
        assert.ok(read(absolute), "compiler output disappeared before byte verification: " + absolute);
      }
    },
  };
}

export async function buildPackage({ root = packageRoot, args = [], profile = "default", signal, fileSystem = fs, tools, write = text => process.stdout.write(text) } = {}) {
  assert.ok(profile === "default" || profile === "optional", "unknown guarded compiler profile");
  const flags = args.filter(argument => argument === "--optional").length;
  assert.ok(flags <= 1 && !(flags && profile === "optional"), "duplicate optional compiler profile");
  const optional = profile === "optional" || flags === 1;
  const checkCancellation = () => { if (signal?.aborted) throw signal.reason; };
  checkCancellation();
  tools ??= declarationTools(optional);
  root = resolve(root);
  await assertSafeOutputDirectory(root, join(root, "dist"), {
    lstat: async path => fileSystem.lstatSync(path),
    realpath: async path => fileSystem.realpathSync(path),
  });
  checkCancellation();
  assert.ok(args.every(argument => !argument.startsWith("@")), "compiler response files are not an admitted build route");
  const command = ts.parseCommandLine(args.filter(argument => argument !== "--optional"));
  for (const option of ts.optionDeclarations) {
    const value = command.options[option.name];
    if (option.isFilePath && typeof value === "string") command.options[option.name] = resolve(root, value);
    if (option.element?.isFilePath && Array.isArray(value)) command.options[option.name] = value.map(path => resolve(root, path));
  }
  assert.equal(command.fileNames.length, 0, "build source roots come only from the admitted config");
  const configName = optional ? "tsconfig.optional.json" : "tsconfig.build.json";
  assert.ok(!command.options.project || resolve(root, command.options.project) === join(root, configName), "build project must remain " + configName);
  if (optional) assert.ok(Object.keys(command.options).every(option => ["project", "pretty", "listFiles", "listEmittedFiles"].includes(option)), "optional profile does not permit compiler option overrides");
  for (const option of ["watch", "build", "incremental", "composite", "showConfig", "listFilesOnly", "generateTrace", "generateCpuProfile", "help", "all", "init", "version", "diagnostics", "extendedDiagnostics", "locale"]) assert.ok(!command.options[option], "unsupported guarded build mode: " + option);
  const inputs = compilerInputs(root, tools, fileSystem, optional, checkCancellation);
  const configuration = ts.readConfigFile(join(root, configName), inputs.host.readFile);
  const parsed = ts.parseJsonConfigFileContent(configuration.config ?? {}, inputs.host, root, command.options, join(root, configName));
  assert.ok(!parsed.projectReferences?.length, "project references are not supported by the guarded one-shot build");
  assert.equal(parsed.options.rootDir, join(root, "src"), "build rootDir must remain src");
  assert.equal(parsed.options.outDir, join(root, "dist"), "build outDir must remain dist");
  assert.ok(!parsed.options.declarationDir || below(join(root, "dist"), parsed.options.declarationDir), "build declarationDir must remain below dist");
  assert.ok(!parsed.options.outFile && !parsed.options.incremental && !parsed.options.composite, "build must emit individual nonincremental dist files");
  if (optional) {
    assert.deepEqual(parsed.fileNames, [join(root, "src/optional.ts")], "optional profile must retain the single declared optional root");
    assert.ok(parsed.options.declaration && !parsed.options.noEmit && !parsed.options.emitDeclarationOnly, "optional profile must emit runtime and declarations");
    assert.ok(!parsed.options.declarationDir || parsed.options.declarationDir === join(root, "dist"), "optional declarations must remain in dist");
  }
  const errors = [...command.errors, ...(configuration.error ? [configuration.error] : []), ...parsed.errors];
  let admitted = parsed.fileNames;
  if (optional) {
    const baseConfig = ts.readConfigFile(join(root, "tsconfig.build.json"), inputs.host.readFile);
    const base = ts.parseJsonConfigFileContent(baseConfig.config ?? {}, inputs.host, root, undefined, join(root, "tsconfig.build.json"));
    assert.ok(!base.projectReferences?.length, "project references are not supported by the guarded one-shot build");
    errors.push(...(baseConfig.error ? [baseConfig.error] : []), ...base.errors);
    admitted = [...new Set([...base.fileNames, ...parsed.fileNames])];
  }
  const formatHost = { getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n" };
  const report = diagnostics => write((parsed.options.pretty ? ts.formatDiagnosticsWithColorAndContext : ts.formatDiagnostics)(diagnostics, formatHost));
  if (errors.length) { report(errors); return { status: 1, rootNames: parsed.fileNames, emittedFiles: [], ...(optional ? inputs.bindings() : {}) }; }
  const peerPaths = inputs.admitPeer();
  if (peerPaths) parsed.options.paths = { ...parsed.options.paths, ...peerPaths };
  inputs.admitSources(admitted);
  const emittedFiles = [];
  let emissionFailed = false, emissionFailure;
  const host = {
    ...ts.createCompilerHost(parsed.options),
    ...inputs.host,
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: path => path,
    getDefaultLibFileName: options => join(tools.typescriptLib, ts.getDefaultLibFileName(options)),
    getDefaultLibLocation: () => tools.typescriptLib,
    getSourceFile(path, languageVersion) {
      const text = inputs.host.readFile(path);
      return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
    },
    trace: text => write(text + "\n"),
    writeFile(path, data, writeByteOrderMark) {
      if (emissionFailed) throw emissionFailure;
      try {
        inputs.writeFile(path, data, writeByteOrderMark);
        emittedFiles.push(path);
      } catch (error) {
        if (optional) { emissionFailed = true; emissionFailure = error; }
        throw error;
      }
    },
  };
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  checkCancellation();
  if (optional) {
    inputs.bindings();
    if (diagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
      report(diagnostics);
      return { status: 1, rootNames: parsed.fileNames, emittedFiles: [], ...inputs.bindings() };
    }
  }
  let emitted;
  try { emitted = program.emit(); }
  catch (error) { throw emissionFailed ? emissionFailure : error; }
  if (emissionFailed) throw emissionFailure;
  const allDiagnostics = ts.sortAndDeduplicateDiagnostics([...diagnostics, ...emitted.diagnostics]);
  report(allDiagnostics);
  if (parsed.options.listFiles) for (const source of program.getSourceFiles()) write(source.fileName + "\n");
  if (parsed.options.listEmittedFiles) for (const path of emittedFiles) write("TSFILE: " + path + "\n");
  checkCancellation();
  return { status: allDiagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ? (emitted.emitSkipped ? 1 : 2) : 0, rootNames: parsed.fileNames, emittedFiles, ...(optional ? inputs.bindings() : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await buildPackage({ args: process.argv.slice(2) })).status; }
  catch (error) { console.error(error); process.exitCode = 1; }
}
