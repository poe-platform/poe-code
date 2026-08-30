import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const filename = join(directory, "fs.ts");
const source = ts.createSourceFile(
  filename,
  readFileSync(filename, "utf8"),
  ts.ScriptTarget.Latest
);
const names = new Set(["FsOperationName", "FsImplementation", "FsModuleOptions"]);
const declarations = source.statements
  .filter((statement) => ts.isTypeAliasDeclaration(statement) && names.has(statement.name.text))
  .map((statement) => statement.getText(source));
const contract = [
  'import * as nodeFsPromises from "node:fs/promises";',
  'import type { FileSystem } from "../../../safe-fs/src/contracts/filesystem.js";',
  ...declarations
].join("\n");
const cases = [
  ["empty", "{}", true],
  ["legacy root", '{ root: "/host" }', true],
  ["legacy implementation", "{ fs: nodeFsPromises }", true],
  ["legacy rooted implementation", '{ fs: nodeFsPromises, root: "/host" }', true],
  ["adapter", "{ adapter }", true],
  ["rooted adapter", '{ adapter, root: "/virtual" }', true],
  ["adapter cwd", '{ adapter, cwd: "/work" }', true],
  ["adapter signal", "{ adapter, signal }", true],
  ["all adapter options", '{ adapter, root: "/virtual", cwd: "/work", signal }', true],
  ["stored legacy options", "legacy", true],
  ["stored adapter options", "adapted", true],
  ["conflicting implementations", "{ adapter, fs: nodeFsPromises }", false],
  ["stored conflicting implementations", "conflicting", false],
  ["spread conflicting implementations", "{ ...legacy, adapter }", false],
  ["cwd without adapter", '{ cwd: "/work" }', false],
  ["signal without adapter", "{ signal }", false],
  ["legacy cwd", '{ fs: nodeFsPromises, cwd: "/work" }', false],
  ["legacy signal", "{ fs: nodeFsPromises, signal }", false],
  ["stored cwd without adapter", "cwdOnly", false],
  ["stored signal without adapter", "signalOnly", false],
  ["optional adapter with cwd", '{ adapter: optionalAdapter, cwd: "/work" }', false],
  ["undefined adapter with signal", "{ adapter: undefined, signal }", false],
  ["null adapter", "{ adapter: null }", false],
  ["invalid cwd type", "{ adapter, cwd: 1 }", false],
  ["invalid signal type", "{ adapter, signal: {} }", false]
] as const;

describe("FsModuleOptions public type contract", () => {
  for (const resolution of ["NodeNext", "Bundler"] as const) {
    for (const dom of [false, true]) {
      it(`${resolution} accepts valid options and rejects invalid structural options (${dom ? "DOM" : "Node-only"})`, () => {
        expect(declarations).toHaveLength(names.size);
        const virtualContract = join(directory, "fs.virtual-contract.ts");
        const virtualConsumer = join(directory, "fs.virtual-consumer.ts");
        const preamble = [
          'import type { FsModuleOptions } from "./fs.virtual-contract.js";',
          'import type { FileSystem } from "../../../safe-fs/src/contracts/filesystem.js";',
          'import * as nodeFsPromises from "node:fs/promises";',
          "declare const adapter: FileSystem;",
          "declare const optionalAdapter: FileSystem | undefined;",
          "declare const signal: AbortSignal;",
          'const legacy = { root: "/host", fs: nodeFsPromises };',
          'const adapted = { adapter, root: "/virtual", cwd: "/work", signal };',
          "const conflicting = { adapter, fs: nodeFsPromises };",
          'const cwdOnly = { cwd: "/work" };',
          "const signalOnly = { signal };"
        ];
        const files = new Map([
          [virtualContract, contract],
          [
            virtualConsumer,
            [
              ...preamble,
              ...cases.map(
                ([, expression], index) => `const option${index}: FsModuleOptions = ${expression};`
              )
            ].join("\n")
          ]
        ]);
        const options: ts.CompilerOptions = {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          target: ts.ScriptTarget.ES2022,
          module: resolution === "NodeNext" ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
          moduleResolution:
            resolution === "NodeNext"
              ? ts.ModuleResolutionKind.NodeNext
              : ts.ModuleResolutionKind.Bundler,
          lib: dom ? ["lib.es2022.d.ts", "lib.dom.d.ts"] : ["lib.es2022.d.ts"],
          types: ["node"]
        };
        const host = ts.createCompilerHost(options);
        const readFile = host.readFile.bind(host);
        const fileExists = host.fileExists.bind(host);
        host.readFile = (path) => files.get(path) ?? readFile(path);
        host.fileExists = (path) => files.has(path) || fileExists(path);
        host.getSourceFile = (path, languageVersion) => {
          const text = host.readFile(path);
          return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion);
        };
        const program = ts.createProgram([virtualConsumer], options, host);
        const diagnostics = ts.getPreEmitDiagnostics(program);
        const unexpected = diagnostics.filter(
          (diagnostic) =>
            diagnostic.file?.fileName !== virtualConsumer ||
            diagnostic.start === undefined ||
            diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line < preamble.length
        );
        expect(
          unexpected.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
          )
        ).toEqual([]);
        for (const [index, [name, , valid]] of cases.entries()) {
          const errors = diagnostics.filter(
            (diagnostic) =>
              diagnostic.file?.fileName === virtualConsumer &&
              diagnostic.start !== undefined &&
              diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line ===
                preamble.length + index
          );
          expect(errors.length === 0, name).toBe(valid);
        }
      });
    }
  }
});
