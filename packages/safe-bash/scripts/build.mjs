import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertSafeOutputDirectory } from "../../../scripts/guard-package-dist.mjs";
import { loadBoundaries, validateBoundaries } from "./integration-inputs.mjs";
import { assertLiteralInputPath, isHeldInputPath } from "./typecheck-integration-inputs.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

function declarationTools() {
  const nodeTypes = dirname(require.resolve("@types/node/package.json"));
  return {
    typescriptLib: dirname(require.resolve("typescript")),
    nodeTypes,
    undiciTypes: dirname(require.resolve("undici-types/package.json", { paths: [nodeTypes] })),
  };
}

function below(root, path) {
  return path === root || path.startsWith(root + sep);
}

function compilerInputs(root, tools, fileSystem) {
  let boundaries;
  let sourceNames;
  let loadingOwners = true;
  const metadataFiles = new Set(["package.json", "tsconfig.json", "tsconfig.build.json", "integration-boundaries.json"]);
  const ownerFiles = new Set();
  const toolRoots = Object.values(tools).map(path => resolve(path));
  const peerMetadata = new Set();
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
      const entries = fileSystem.readdirSync(current);
      const aliases = entries.filter(name => name.toLowerCase() === component.toLowerCase());
      if (aliases.length === 0) return undefined;
      assert.ok(aliases.length === 1 && aliases[0] === component, "noncanonical compiler path spelling: " + absolute);
      current = join(current, component);
      stat = fileSystem.lstatSync(current);
      assert.ok(!stat.isSymbolicLink(), "compiler path must not be a symlink: " + current);
    }
    assert.ok(stat.isDirectory() || (stat.isFile() && stat.nlink === 1), "compiler input must be regular and single-link: " + absolute);
    return stat;
  };
  const metadata = path => scope(path) ? physical(path) : undefined;
  const sameIdentity = (before, after) => {
    for (const key of ["dev", "ino", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]) assert.equal(after[key], before[key], "compiler input identity changed: " + key);
  };
  const read = (path, maximum = Infinity) => {
    const absolute = resolve(root, path);
    const kind = scope(absolute);
    if (!kind || kind === "ancestor") return undefined;
    if (kind === "source") {
      assert.ok(sourceNames?.has(absolute), "compiler source is outside admitted root names: " + absolute);
    }
    if (kind === "tool" && !(absolute.endsWith(".d.ts") || absolute.endsWith(".d.mts") || absolute.endsWith(".d.cts") || absolute.endsWith("/package.json"))) return undefined;
    const before = physical(absolute);
    if (!before) return undefined;
    assert.ok(before.isFile() && before.size <= maximum, "compiler input must be a bounded regular file: " + absolute);
    const descriptor = fileSystem.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let failed = false, failure, bytes;
    try {
      sameIdentity(before, fileSystem.fstatSync(descriptor));
      bytes = fileSystem.readFileSync(descriptor);
      assert.equal(bytes.length, before.size, "compiler input size changed: " + absolute);
      sameIdentity(before, fileSystem.fstatSync(descriptor));
      sameIdentity(before, physical(absolute));
    } catch (error) { failed = true; failure = error; }
    try { fileSystem.closeSync(descriptor); } catch (error) {
      if (failed) throw new AggregateError([failure, error], "compiler read and close failed");
      throw error;
    }
    if (failed) throw failure;
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
    admitPeer() {
      const manifest = JSON.parse(read(join(root, "package.json")));
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
      }
      return peerPaths;
    },
    admitSources(paths) {
      sourceNames = new Set(paths.map(path => resolve(root, path)));
      for (const path of sourceNames) {
        assert.equal(scope(path), "source", "build root must be admitted source");
        assert.ok(metadata(path)?.isFile(), "build root must be a regular source file");
      }
    },
    writeFile(path, data, writeByteOrderMark) {
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
      const descriptor = fileSystem.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o666);
      let failed = false, failure;
      try {
        const opened = fileSystem.fstatSync(descriptor);
        assert.ok(opened.isFile() && opened.nlink === 1, "compiler output must be regular and single-link");
        if (before) sameIdentity(before, opened);
        fileSystem.ftruncateSync(descriptor, 0);
        fileSystem.writeFileSync(descriptor, (writeByteOrderMark ? "\uFEFF" : "") + data, "utf8");
      } catch (error) { failed = true; failure = error; }
      try { fileSystem.closeSync(descriptor); } catch (error) {
        if (failed) throw new AggregateError([failure, error], "compiler write and close failed");
        throw error;
      }
      if (failed) throw failure;
    },
  };
}

export async function buildPackage({ root = packageRoot, args = [], fileSystem = fs, tools = declarationTools(), write = text => process.stdout.write(text) } = {}) {
  root = resolve(root);
  await assertSafeOutputDirectory(root, join(root, "dist"), {
    lstat: async path => fileSystem.lstatSync(path),
    realpath: async path => fileSystem.realpathSync(path),
  });
  assert.ok(args.every(argument => !argument.startsWith("@")), "compiler response files are not an admitted build route");
  const command = ts.parseCommandLine(args);
  for (const option of ts.optionDeclarations) {
    const value = command.options[option.name];
    if (option.isFilePath && typeof value === "string") command.options[option.name] = resolve(root, value);
    if (option.element?.isFilePath && Array.isArray(value)) command.options[option.name] = value.map(path => resolve(root, path));
  }
  assert.equal(command.fileNames.length, 0, "build source roots come only from the admitted config");
  assert.ok(!command.options.project || resolve(root, command.options.project) === join(root, "tsconfig.build.json"), "build project must remain tsconfig.build.json");
  for (const option of ["watch", "build", "incremental", "composite", "showConfig", "listFilesOnly", "generateTrace", "generateCpuProfile", "help", "all", "init", "version", "diagnostics", "extendedDiagnostics", "locale"]) assert.ok(!command.options[option], "unsupported guarded build mode: " + option);
  const inputs = compilerInputs(root, tools, fileSystem);
  const configuration = ts.readConfigFile(join(root, "tsconfig.build.json"), inputs.host.readFile);
  const parsed = ts.parseJsonConfigFileContent(configuration.config ?? {}, inputs.host, root, command.options, join(root, "tsconfig.build.json"));
  assert.ok(!parsed.projectReferences?.length, "project references are not supported by the guarded one-shot build");
  assert.equal(parsed.options.rootDir, join(root, "src"), "build rootDir must remain src");
  assert.equal(parsed.options.outDir, join(root, "dist"), "build outDir must remain dist");
  assert.ok(!parsed.options.declarationDir || below(join(root, "dist"), parsed.options.declarationDir), "build declarationDir must remain below dist");
  assert.ok(!parsed.options.outFile && !parsed.options.incremental && !parsed.options.composite, "build must emit individual nonincremental dist files");
  const errors = [...command.errors, ...(configuration.error ? [configuration.error] : []), ...parsed.errors];
  const formatHost = { getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n" };
  const report = diagnostics => write((parsed.options.pretty ? ts.formatDiagnosticsWithColorAndContext : ts.formatDiagnostics)(diagnostics, formatHost));
  if (errors.length) { report(errors); return { status: 1, rootNames: parsed.fileNames, emittedFiles: [] }; }
  const peerPaths = inputs.admitPeer();
  if (peerPaths) parsed.options.paths = { ...parsed.options.paths, ...peerPaths };
  inputs.admitSources(parsed.fileNames);
  const emittedFiles = [];
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
      inputs.writeFile(path, data, writeByteOrderMark);
      emittedFiles.push(path);
    },
  };
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const emitted = program.emit();
  const allDiagnostics = ts.sortAndDeduplicateDiagnostics([...diagnostics, ...emitted.diagnostics]);
  report(allDiagnostics);
  if (parsed.options.listFiles) for (const source of program.getSourceFiles()) write(source.fileName + "\n");
  if (parsed.options.listEmittedFiles) for (const path of emittedFiles) write("TSFILE: " + path + "\n");
  return { status: allDiagnostics.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ? (emitted.emitSkipped ? 1 : 2) : 0, rootNames: parsed.fileNames, emittedFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await buildPackage({ args: process.argv.slice(2) })).status; }
  catch (error) { console.error(error); process.exitCode = 1; }
}
