import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadBoundaries } from "./integration-inputs.mjs";
import { assertAdmittedInputPath, readRegularInput } from "./typecheck-integration-inputs.mjs";

export const historicalTypeModelDefinitions = Object.freeze([
  {
    path: "scripts/historical-type-models/gnu-oracle.d.mts.fixture",
    bytes: 229,
    sha256: "eb7edfd43ad49520012a43d27449005c4282e2f9b0b224f87827643ac640e06c",
    provenance: {
      commit: "4d4f5ca2338cc0020dd17bf2d6b3627c6bbeb78f",
      path: "tests/commands/diff-patch-stress/gnu-target/oracle.ts",
      blob: "ffc3617ce5d95d980144df0aa170726908ca684d",
      sha256: "ad9920197aa38291dfff5d04170c5e1b87cd225bf590c8073a8ebba8c68181cc",
      lastRetiredBlob: "d51b79cf421f48858a818abb9925fdf0f1191b95",
      lastRetiredSha256: "f5b758e894e3c867a39740d73f1fac06d9d76f40bcf716a1f59331aa24805095",
      scope: "shared one-argument caller slice, not the full last-retired API",
    },
    absentPaths: [
      "tests/commands/diff-patch-stress/gnu-target/oracle.ts",
      "tests/commands/diff-patch-stress/gnu-target/oracle.js",
      "tests/commands/diff-patch-stress/gnu-target/oracle.d.ts",
      "scripts/historical-type-models/gnu-oracle.d.mts",
    ],
    callers: [
      { path: "tests/commands/diff-patch-stress/emptyfile-delta/native.ts", bytes: 4509, sha256: "1ff5846fcbda25d94007d8f1cbbd54a1743864311664cc12b7e6fd926867e5a4", specifier: "../gnu-target/oracle.js" },
      { path: "tests/commands/diff-patch-stress/gnu-revised-acceptance/capture.ts", bytes: 2329, sha256: "603b54d264f79d7ea10a535b40c7cacce83b851b729250f3031c126140f9ac0e", specifier: "../gnu-target/oracle.js" },
      { path: "tests/commands/diff-patch-stress/gnu-revised-acceptance/lab.ts", bytes: 5223, sha256: "e4d6ae1d40e98f47ddf56b38dab81e21521e39241b48e11b549079483ea24a43", specifier: "../gnu-target/oracle.js" },
      { path: "tests/commands/diff-patch-stress/gnu-safety-strip-followup/capture.ts", bytes: 994, sha256: "0421e4f097441dd90df439528c39283e7a32bd046c71baa6b7bac64ebb142878", specifier: "../gnu-target/oracle.js" },
    ],
  },
  {
    path: "scripts/historical-type-models/native-delivery.d.mts.fixture",
    bytes: 1013,
    sha256: "a8d2bc1b767cd3b31ba1514c29c799dd7b3828dfe03f1886399d0762d2416b84",
    provenance: {
      commit: "fa4c80035848ce5eab1efe3ae47862eac03ae7c9",
      path: "tests/stress/harness-timing-20260827/native-delivery.ts",
      blob: "100db5ba504bcd9f75db882f7022ef1f95955067",
      sha256: "3e415abe8d16c9e42037fa16793632c9ea23feb199580c5e6837cb9d886f1bb4",
      bytes: 8550,
      lastRetiredBlob: "100db5ba504bcd9f75db882f7022ef1f95955067",
      lastRetiredSha256: "3e415abe8d16c9e42037fa16793632c9ea23feb199580c5e6837cb9d886f1bb4",
      scope: "NativeOptions, NativeEvidence, TimingEvent, NativeHarnessError, nativeDelivery only",
    },
    absentPaths: [
      "tests/stress/harness-timing-20260827/native-delivery.ts",
      "tests/stress/harness-timing-20260827/native-delivery.js",
      "tests/stress/harness-timing-20260827/native-delivery.d.ts",
      "scripts/historical-type-models/native-delivery.d.mts",
    ],
    callers: [
      { path: "tests/stress/harness-timing-20260827/native-baseline.ts", bytes: 803, sha256: "5ce78d4e29132b26c53391845ac76e7532129e58f1ebea122af1c540709b5520", specifier: "./native-delivery.js" },
      { path: "tests/stress/harness-timing-20260827/negative-controls.ts", bytes: 6156, sha256: "aa1824f5d9da016b7f77d2dfedaf14e5cc8fdb649ee26817cb2f129fe3fe6b85", specifier: "./native-delivery.js" },
    ],
  },
].map(definition => Object.freeze({
  ...definition,
  retirement: "94cf8b10de0189255be6a8e3ebdf8d3d448a6809",
  provenance: Object.freeze(definition.provenance),
  absentPaths: Object.freeze(definition.absentPaths),
  callers: Object.freeze(definition.callers.map(caller => Object.freeze(caller))),
})));

function assertAbsentInput(root, path, fileSystem, boundaries) {
  assertAdmittedInputPath(path, boundaries);
  let directory = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    if (!fileSystem.readdirSync(directory).includes(part)) return;
    assert.notEqual(index, parts.length - 1, `historical runtime/model path must remain absent: ${path}`);
    directory = join(directory, part);
    assert.ok(fileSystem.lstatSync(directory).isDirectory(), `historical path ancestor must be a regular directory: ${path}`);
  }
}

function readBoundInput(root, input, fileSystem, boundaries) {
  const bytes = readRegularInput(root, input.path, input.bytes, fileSystem, boundaries);
  assert.equal(bytes.length, input.bytes, `historical input size changed: ${input.path}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), input.sha256, `historical input hash changed: ${input.path}`);
  return bytes.toString("utf8");
}

export function admitHistoricalTypeModels(root, fileSystem = fs, boundaries = loadBoundaries(root, fileSystem)) {
  root = resolve(root);
  const callers = new Map();
  const models = new Map();
  for (const definition of historicalTypeModelDefinitions) {
    for (const path of definition.absentPaths) assertAbsentInput(root, path, fileSystem, boundaries);
    const modelFileName = join(root, definition.path.slice(0, -".fixture".length));
    models.set(modelFileName, readBoundInput(root, definition, fileSystem, boundaries));
    for (const caller of definition.callers) {
      const path = join(root, caller.path);
      const text = readBoundInput(root, caller, fileSystem, boundaries);
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      assert.equal(source.statements.filter(statement => ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === caller.specifier).length, 1, `historical import edge changed: ${caller.path}`);
      callers.set(path, Object.freeze({ text, specifier: caller.specifier, modelFileName }));
    }
  }
  return { callers, models };
}

export function createHistoricalCompilerHost(options, admission, baseHost = ts.createCompilerHost(options)) {
  const host = {
    ...baseHost,
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const text = admission.callers.get(fileName)?.text ?? admission.models.get(fileName);
      const source = text === undefined
        ? baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, text, languageVersion, true);
      for (const reference of source?.referencedFiles ?? []) {
        assert.ok(!admission.models.has(resolve(dirname(fileName), reference.fileName.split("\\").join("/"))), `historical model cannot be referenced directly: ${fileName}`);
      }
      return source;
    },
    resolveModuleNameLiterals(literals, containingFile, redirectedReference, compilerOptions, containingSourceFile) {
      return literals.map(literal => {
        const resolution = ts.resolveModuleName(literal.text, containingFile, compilerOptions, host, undefined, redirectedReference, ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions));
        const caller = admission.callers.get(containingFile);
        if (!caller || literal.text !== caller.specifier) return resolution;
        assert.equal(containingSourceFile.text, caller.text, `historical compiler caller changed: ${containingFile}`);
        assert.equal(resolution.resolvedModule, undefined, `retired historical import must remain unresolved: ${containingFile}`);
        return { resolvedModule: { resolvedFileName: caller.modelFileName, extension: ts.Extension.Dmts, isExternalLibraryImport: false } };
      });
    },
  };
  return host;
}

export function checkHistoricalSources(root, { fileSystem = fs, system = ts.sys, baseHost, boundaries = loadBoundaries(root, fileSystem) } = {}) {
  root = resolve(root);
  const admission = admitHistoricalTypeModels(root, fileSystem, boundaries);
  const configPath = join(root, "tsconfig.json");
  const configText = readRegularInput(root, "tsconfig.json", 100000, fileSystem, boundaries).toString("utf8");
  const configDiagnostics = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { noEmit: true }, {
    ...system,
    readFile: path => path === configPath ? configText : system.readFile(path),
    onUnRecoverableConfigFileDiagnostic: diagnostic => configDiagnostics.push(diagnostic),
  });
  if (!parsed) return { status: 1, diagnostics: configDiagnostics };
  assert.equal(parsed.options.strict, true, "historical source typecheck requires existing strict configuration");
  for (const path of parsed.fileNames) assert.ok(!admission.models.has(resolve(path)), `historical model cannot be a source root: ${path}`);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: parsed.errors,
    host: createHistoricalCompilerHost(parsed.options, admission, baseHost),
  });
  const diagnostics = [...configDiagnostics, ...ts.getPreEmitDiagnostics(program)];
  return { status: diagnostics.length === 0 ? 0 : 1, program, diagnostics };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.deepEqual(process.argv.slice(2), ["--noEmit"], "historical source driver accepts only --noEmit");
    const root = fileURLToPath(new URL("../", import.meta.url));
    const result = checkHistoricalSources(root);
    process.stdout.write(ts.formatDiagnostics(result.diagnostics, {
      getCanonicalFileName: path => path,
      getCurrentDirectory: () => root,
      getNewLine: () => ts.sys.newLine,
    }));
    process.stdout.write("historical models: six authenticated compile-only caller edges; no runtime availability or qualification\n");
    process.exitCode = result.status;
  } catch (error) {
    process.stderr.write(`historical source typecheck: ${error.message}\n`);
    process.exitCode = 2;
  }
}
