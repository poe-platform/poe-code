import assert from "node:assert/strict";
import * as fs from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { loadBoundaries } from "./integration-inputs.mjs";
import { readRegularInput } from "./typecheck-integration-inputs.mjs";
import { admitHistoricalTypeModels, createHistoricalCompilerHost, historicalTypeModelDefinitions, checkHistoricalSources } from "./historical-type-models.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const actualBoundaries = loadBoundaries(packageRoot);
const boundaries = { heldSourceFiles: [], heldEvidenceDirectories: [] };
const root = "/package";
const options = { strict: true, noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2023, types: [], noLib: true };

function fixture() {
  const files = {
    "/package/package.json": '{"type":"module"}',
    "/package/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "NodeNext", target: "ES2023", types: [], noLib: true }, files: ["tests/check.ts"] }),
    "/package/tests/check.ts": 'export const wrong: string = 1;\nexport function untyped(value) { return value; }\n',
    "/package/tests/normal.ts": "export const ordinary = 1;\n",
  };
  for (const definition of historicalTypeModelDefinitions) {
    for (const input of [definition, ...definition.callers]) {
      files[join(root, input.path)] = readRegularInput(packageRoot, input.path, input.bytes, fs, actualBoundaries);
    }
  }
  const fileSystem = createFsFromVolume(Volume.fromJSON(files));
  const system = {
    ...ts.sys,
    getCurrentDirectory: () => root,
    fileExists: path => { try { return fileSystem.statSync(path).isFile(); } catch { return false; } },
    directoryExists: path => { try { return fileSystem.statSync(path).isDirectory(); } catch { return false; } },
    readFile: path => { try { return fileSystem.readFileSync(path, "utf8"); } catch { return undefined; } },
    readDirectory: () => assert.fail("explicit tiny config must not scan directories"),
    realpath: path => fileSystem.realpathSync(path),
    writeFile: () => assert.fail("compile-only host must not emit"),
  };
  const baseHost = {
    ...ts.createCompilerHost(options),
    ...system,
    useCaseSensitiveFileNames: () => true,
    getDefaultLibFileName: () => "/package/compiler-fixtures/lib.es5.d.ts",
    getDefaultLibLocation: () => "/package/compiler-fixtures",
    getSourceFile: (path, languageVersion) => {
      const text = system.readFile(path);
      return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
    },
  };
  return { fileSystem, system, baseHost };
}

function addStandardLibrary(fileSystem) {
  const libraryRoot = dirname(ts.getDefaultLibFilePath(options));
  fileSystem.mkdirSync("/package/compiler-fixtures", { recursive: true });
  for (const name of ["lib.es5.d.ts", "lib.decorators.d.ts", "lib.decorators.legacy.d.ts"]) {
    fileSystem.writeFileSync("/package/compiler-fixtures/" + name, readRegularInput(libraryRoot, name, 300000));
  }
}

function admittedFixture() {
  const specimen = fixture();
  const admission = admitHistoricalTypeModels(root, specimen.fileSystem, boundaries);
  const host = createHistoricalCompilerHost(options, admission, specimen.baseHost);
  return { ...specimen, admission, host };
}

function resolveImport(host, path, specifier, compilerOptions = options) {
  const source = host.getSourceFile(path, ts.ScriptTarget.ES2023) ?? ts.createSourceFile(path, "", ts.ScriptTarget.ES2023, true);
  const literal = ts.createSourceFile(path, `import ${JSON.stringify(specifier)};`, ts.ScriptTarget.ES2023, true).statements[0].moduleSpecifier;
  return host.resolveModuleNameLiterals([literal], path, undefined, compilerOptions, source, undefined)[0].resolvedModule;
}

test("historical models admit exactly six pinned callers and two declaration-only texts", () => {
  const { admission, host, fileSystem, baseHost } = admittedFixture();
  assert.equal(admission.callers.size, 6);
  assert.equal(admission.models.size, 2);
  assert.equal(host.fileExists, baseHost.fileExists);
  for (const [path, caller] of admission.callers) {
    const resolved = resolveImport(host, path, caller.specifier);
    assert.equal(resolved.resolvedFileName, caller.modelFileName);
    assert.equal(resolved.extension, ts.Extension.Dmts);
    assert.equal(host.fileExists(caller.modelFileName), false);
    assert.equal(fileSystem.existsSync(caller.modelFileName), false);
    assert.equal(host.getSourceFile(path, ts.ScriptTarget.ES2023).text, caller.text);
    assert.equal(host.getSourceFile(caller.modelFileName, ts.ScriptTarget.ES2023).isDeclarationFile, true);
  }
});

test("models contain only exported declarations, with no ambient modules, any types or implementations", () => {
  const { admission, host } = admittedFixture();
  for (const path of admission.models.keys()) {
    const source = host.getSourceFile(path, ts.ScriptTarget.ES2023);
    assert.deepEqual(source.parseDiagnostics, []);
    for (const statement of source.statements) {
      assert.ok(ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement));
      assert.ok(statement.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
    }
    const inspect = node => {
      assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword);
      assert.equal(ts.isModuleDeclaration(node), false);
      if (ts.isFunctionDeclaration(node) || ts.isConstructorDeclaration(node)) assert.equal(node.body, undefined);
      if (ts.isPropertyDeclaration(node)) assert.equal(node.initializer, undefined);
      ts.forEachChild(node, inspect);
    };
    inspect(source);
  }
});

test("admission uses the existing guarded read capability with exact per-input bounds", () => {
  const { fileSystem } = fixture();
  const reads = [];
  fileSystem.readAdmittedInput = (path, maximum) => {
    reads.push([path, maximum]);
    return fileSystem.readFileSync(path);
  };
  admitHistoricalTypeModels(root, fileSystem, boundaries);
  assert.deepEqual(reads, historicalTypeModelDefinitions.flatMap(definition => [definition, ...definition.callers].map(input => [join(root, input.path), input.bytes])));
});

test("a dangling symlink at a retired runtime name is not treated as absence", () => {
  const { fileSystem } = fixture();
  const path = join(root, historicalTypeModelDefinitions[0].absentPaths[0]);
  fileSystem.mkdirSync(dirname(path), { recursive: true });
  fileSystem.symlinkSync("/does-not-exist", path);
  assert.equal(fileSystem.existsSync(path), false);
  assert.throws(() => admitHistoricalTypeModels(root, fileSystem, boundaries), /must remain absent/);
});

test("new, sibling, aliased, case-aliased and direct imports cannot borrow a warmed historical resolution", () => {
  const { admission, host } = admittedFixture();
  for (const [path, caller] of admission.callers) {
    assert.ok(resolveImport(host, path, caller.specifier));
    assert.equal(resolveImport(host, path + ".new.ts", caller.specifier), undefined);
    assert.equal(resolveImport(host, path.toUpperCase(), caller.specifier), undefined);
    assert.equal(resolveImport(host, path, caller.specifier.replace("/", "/./")), undefined);
    assert.equal(resolveImport(host, "/package/tests/current.ts", caller.modelFileName), undefined);
    assert.equal(resolveImport(host, path, "./" + relative(join(path, ".."), caller.modelFileName)), undefined);
  }
  assert.equal(resolveImport(host, "/package/tests/current.ts", "./normal.js").resolvedFileName, "/package/tests/normal.ts");
});

test("cached authenticated caller bytes are the bytes parsed by the compiler", () => {
  const { admission, host, fileSystem } = admittedFixture();
  const [path, caller] = admission.callers.entries().next().value;
  fileSystem.writeFileSync(path, "changed after admission");
  assert.equal(host.getSourceFile(path, ts.ScriptTarget.ES2023).text, caller.text);
});

for (const definition of historicalTypeModelDefinitions) {
  for (const input of [definition, ...definition.callers]) {
    test(`historical admission refuses hash drift: ${input.path}`, () => {
      const { fileSystem } = fixture();
      const bytes = fileSystem.readFileSync(join(root, input.path));
      bytes[0] ^= 1;
      fileSystem.writeFileSync(join(root, input.path), bytes);
      assert.throws(() => admitHistoricalTypeModels(root, fileSystem, boundaries), /hash changed/);
    });
  }
  for (const path of definition.absentPaths) {
    test(`historical admission refuses restored runtime or shadow declaration: ${path}`, () => {
      const { fileSystem } = fixture();
      fileSystem.mkdirSync(join(root, path, ".."), { recursive: true });
      fileSystem.writeFileSync(join(root, path), "export {};\n");
      assert.throws(() => admitHistoricalTypeModels(root, fileSystem, boundaries), /must remain absent/);
    });
  }
}

test("held, oversized and symlink inputs fail before payload reads", () => {
  const input = historicalTypeModelDefinitions[0];
  for (const kind of ["held", "oversized", "symlink"]) {
    const { fileSystem } = fixture();
    let selectedBoundaries = boundaries;
    if (kind === "held") selectedBoundaries = { ...boundaries, heldEvidenceDirectories: ["scripts/historical-type-models"] };
    if (kind === "oversized") fileSystem.writeFileSync(join(root, input.path), Buffer.alloc(input.bytes + 1));
    if (kind === "symlink") {
      fileSystem.renameSync(join(root, input.path), join(root, input.path + ".target"));
      fileSystem.symlinkSync(join(root, input.path + ".target"), join(root, input.path));
    }
    const read = fileSystem.readFileSync;
    fileSystem.readFileSync = (path, ...args) => {
      assert.notEqual(path, join(root, input.path), "inadmissible input payload was read");
      return read(path, ...args);
    };
    assert.throws(() => admitHistoricalTypeModels(root, fileSystem, selectedBoundaries), /held type-input|unadmitted type-input/);
  }
});

test("source driver preserves config roots/options, noEmit and unrelated strict diagnostics", () => {
  const specimen = fixture();
  const baseline = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), { noEmit: true }, { ...specimen.system, onUnRecoverableConfigFileDiagnostic: diagnostic => assert.fail(String(diagnostic.code)) });
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  assert.deepEqual(result.program.getRootFileNames(), baseline.fileNames);
  assert.deepEqual(result.program.getCompilerOptions(), baseline.options);
  assert.equal(result.program.getCompilerOptions().noEmit, true);
  assert.equal(result.status, 1);
  for (const code of [2322, 7006]) assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code), `missing strict diagnostic TS${code}`);
  assert.equal(result.program.getSourceFiles().some(source => source.fileName.endsWith(".fixture")), false);
});

test("a valid tiny source passes with real standard declarations and cannot emit", () => {
  const specimen = fixture();
  addStandardLibrary(specimen.fileSystem);
  specimen.fileSystem.writeFileSync(join(root, "tests/check.ts"), 'export const checked: string = "valid";\n');
  specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "NodeNext", types: [] }, files: ["tests/check.ts"] }));
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  assert.equal(result.status, 0, ts.formatDiagnostics(result.diagnostics, specimen.baseHost));
  assert.deepEqual(result.diagnostics, []);
  result.program.emit(undefined, () => assert.fail("noEmit program attempted output"));
});

test("source driver retains config diagnostics without filtering", () => {
  const specimen = fixture();
  specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"strict":true,"unknownOption605":true},"files":["tests/check.ts"]}');
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  assert.equal(result.status, 1);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 5023));
});

test("real compiler resolves all six authentic edges but not a same-directory current import", context => {
  const specimen = fixture();
  const callerPaths = historicalTypeModelDefinitions.flatMap(definition => definition.callers.map(caller => caller.path));
  const currentPath = "tests/stress/harness-timing-20260827/current.ts";
  specimen.fileSystem.writeFileSync(join(root, currentPath), 'import { nativeDelivery } from "./native-delivery.js";\nvoid nativeDelivery;\n');
  specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", target: "ES2023", types: [], noLib: true, skipLibCheck: true },
    files: [...callerPaths, currentPath],
  }));
  const baseline = ts.createProgram({ rootNames: callerPaths.map(path => join(root, path)), options, host: specimen.baseHost });
  const baselineDiagnostics = ts.getPreEmitDiagnostics(baseline);
  for (const definition of historicalTypeModelDefinitions) {
    for (const caller of definition.callers) {
      const source = baseline.getSourceFile(join(root, caller.path));
      const declaration = source.statements.find(statement => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === caller.specifier);
      assert.ok(baselineDiagnostics.some(diagnostic => diagnostic.code === 2307 && diagnostic.file === source && diagnostic.start === declaration.moduleSpecifier.getStart(source)), `baseline did not reject retired edge: ${caller.path}`);
    }
  }
  context.diagnostic("ordinary compiler baseline: all six retired edges produce TS2307; full diagnostic set retained");
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  for (const definition of historicalTypeModelDefinitions) {
    for (const caller of definition.callers) {
      const source = result.program.getSourceFile(join(root, caller.path));
      const declaration = source.statements.find(statement => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === caller.specifier);
      assert.ok(result.program.getTypeChecker().getSymbolAtLocation(declaration.moduleSpecifier), `unresolved authentic edge: ${caller.path}`);
    }
  }
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 2307 && diagnostic.file.fileName === join(root, currentPath)));
  assert.equal(result.program.getSourceFiles().filter(source => source.fileName.endsWith("/gnu-oracle.d.mts") || source.fileName.endsWith("/native-delivery.d.mts")).length, 2);
  assert.equal(result.status, 1);
});

test("retired resolution cannot be replaced through ordinary TypeScript path mapping", () => {
  const { admission, host, fileSystem } = admittedFixture();
  const [path, caller] = admission.callers.entries().next().value;
  const replacement = join(root, "redirect/gnu-target/oracle.ts");
  fileSystem.mkdirSync(dirname(replacement), { recursive: true });
  fileSystem.writeFileSync(replacement, "export const oraclePath = 1;\n");
  assert.throws(() => resolveImport(host, path, caller.specifier, {
    ...options,
    baseUrl: root,
    rootDirs: [join(root, "tests/commands/diff-patch-stress"), join(root, "redirect")],
  }), /retired historical import must remain unresolved/);
});

test("current direct imports cannot use a virtual module already loaded for a historical caller", () => {
  const specimen = fixture();
  const historicalPath = historicalTypeModelDefinitions[1].callers[0].path;
  const currentPath = "tests/current.ts";
  specimen.fileSystem.writeFileSync(join(root, currentPath), [
    'import { nativeDelivery } from "../scripts/historical-type-models/native-delivery.mjs";',
    'import type { NativeOptions } from "../scripts/historical-type-models/native-delivery.d.mts";',
    'void nativeDelivery; export type Options = NativeOptions;',
  ].join("\n"));
  specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", target: "ES2023", types: [], noLib: true, skipLibCheck: true },
    files: [historicalPath, currentPath],
  }));
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  const currentSource = result.program.getSourceFile(join(root, currentPath));
  const checker = result.program.getTypeChecker();
  assert.ok(result.program.getSourceFile(join(root, "scripts/historical-type-models/native-delivery.d.mts")));
  for (const declaration of currentSource.statements.filter(ts.isImportDeclaration)) {
    assert.equal(checker.getSymbolAtLocation(declaration.moduleSpecifier), undefined);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 2307 && diagnostic.file === currentSource && diagnostic.start === declaration.moduleSpecifier.getStart(currentSource)));
  }
});

for (const reference of [
  "../scripts/historical-type-models/native-delivery.d.mts",
  "../scripts/historical-type-models/../historical-type-models/native-delivery.d.mts",
  "..\\scripts\\historical-type-models\\native-delivery.d.mts",
  "../scripts\\historical-type-models/native-delivery.d.mts",
]) {
  test(`current triple-slash references cannot bypass exact-edge admission: ${reference}`, () => {
    const specimen = fixture();
    const historicalPath = historicalTypeModelDefinitions[1].callers[0].path;
    specimen.fileSystem.writeFileSync(join(root, "tests/current.ts"), `/// <reference path="${reference}" />\nexport {};\n`);
    specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, module: "NodeNext", types: [], noLib: true },
      files: [historicalPath, "tests/current.ts"],
    }));
    assert.throws(() => checkHistoricalSources(root, { ...specimen, boundaries }), /historical model cannot be referenced directly/);
  });
}

test("explicit virtual model roots are rejected, not appended to or removed from config membership", () => {
  const specimen = fixture();
  specimen.fileSystem.writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "NodeNext", types: [], noLib: true },
    files: ["tests/check.ts", "scripts/historical-type-models/native-delivery.d.mts"],
  }));
  assert.throws(() => checkHistoricalSources(root, { ...specimen, boundaries }), /historical model cannot be a source root/);
});

test("ordinary triple-slash file references still use the unchanged compiler host", () => {
  const specimen = fixture();
  specimen.fileSystem.writeFileSync(join(root, "tests/ordinary.d.ts"), "export interface Ordinary { value: string; }\n");
  specimen.fileSystem.writeFileSync(join(root, "tests/check.ts"), '/// <reference path="./ordinary.d.ts" />\nexport const checked = 1;\n');
  const result = checkHistoricalSources(root, { ...specimen, boundaries });
  assert.ok(result.program.getSourceFile(join(root, "tests/ordinary.d.ts")));
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 6053), false);
  assert.deepEqual(result.program.getRootFileNames(), [join(root, "tests/check.ts")]);
});

test("maintained reporting exposes only successful source-phase stdout and preserves failure routing", () => {
  const text = readRegularInput(packageRoot, "scripts/typecheck.mjs", 20000, fs, actualBoundaries).toString("utf8");
  const source = ts.createSourceFile("typecheck.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(variable => ts.isIdentifier(variable.name) && variable.name.text === "compile");
  assert.ok(declaration?.initializer);
  const classification = "historical models: six authenticated compile-only caller edges; no runtime availability or qualification\n";
  for (const status of [0, 1]) {
    for (const label of ["source-and-tests", "historical-build-first-consumer", "negative-consumer", "resolution-consumer"]) {
      const stdout = [], stderr = [], messages = [], phases = [], launches = [];
      const compile = new Script(`(${declaration.initializer.getText(source)})`).runInNewContext({
        assert, root, compiler: "/tsc", historicalCompiler: "/historical-models",
        report: { phases }, console: { log: message => messages.push(message) },
        process: { execPath: "/node", env: {}, stdout: { write: value => stdout.push(value) }, stderr: { write: value => stderr.push(value) } },
        spawnSync: (...args) => {
          launches.push(args);
          return { status, signal: null, error: undefined, stdout: classification, stderr: "compiler stderr\n" };
        },
      });
      const record = compile(label, ["--noEmit"]);
      const ordinaryFailure = status !== 0 && !label.startsWith("negative-") && !label.startsWith("resolution-");
      assert.deepEqual(stdout, ordinaryFailure || (status === 0 && label === "source-and-tests") ? [classification] : [], `${label} status ${status} stdout`);
      assert.deepEqual(stderr, ordinaryFailure ? ["compiler stderr\n"] : [], `${label} status ${status} stderr`);
      assert.deepEqual(messages, label.startsWith("resolution-") ? [] : [`typecheck: ${label}: exit ${status}`]);
      assert.equal(record, phases[0]);
      assert.equal(record.stdout, classification);
      assert.equal(launches[0][1][0], label === "source-and-tests" ? "/historical-models" : "/tsc");
    }
  }
});
