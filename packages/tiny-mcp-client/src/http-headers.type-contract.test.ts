import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const filename = join(directory, "internal.ts");
const source = ts.createSourceFile(
  filename,
  readFileSync(filename, "utf8"),
  ts.ScriptTarget.Latest
);
const optionsDeclaration = source.statements.find(
  (statement): statement is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === "HttpTransportOptions"
);
const headers = optionsDeclaration?.members.find(
  (member): member is ts.PropertySignature =>
    ts.isPropertySignature(member) && member.name.getText(source) === "headers"
);
const cases = [
  ["record", '{ Authorization: "Bearer token" }', true],
  ["pairs", '[["Accept", "application/json"]]', true],
  ["Headers instance", "new Headers()", true],
  ["empty record", "{}", true],
  ["fetch headers", "init.headers", true],
  ["number", "123", false],
  ["numeric header value", "{ Authorization: 123 }", false],
  ["numeric pair value", '[["Accept", 123]]', false],
  ["null", "null", false]
] as const;

describe("HttpTransportOptions.headers public type", () => {
  for (const resolution of ["NodeNext", "Bundler"] as const) {
    for (const dom of [false, true]) {
      it(`${resolution} supports fetch headers (${dom ? "DOM" : "Node-only"})`, () => {
        expect(headers?.type).toBeDefined();
        expect(headers?.questionToken).toBeDefined();
        const virtualConsumer = join(directory, "http-headers.virtual-consumer.ts");
        const preamble = [
          `type PublicHeaders = ${headers!.type!.getText(source)} | undefined;`,
          "declare const init: RequestInit;"
        ];
        const text = [
          ...preamble,
          ...cases.map(
            ([, expression], index) => `const headers${index}: PublicHeaders = ${expression};`
          )
        ].join("\n");
        const options: ts.CompilerOptions = {
          strict: true,
          skipLibCheck: false,
          exactOptionalPropertyTypes: true,
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
        const read = host.readFile.bind(host);
        const exists = host.fileExists.bind(host);
        host.readFile = (path) => (path === virtualConsumer ? text : read(path));
        host.fileExists = (path) => path === virtualConsumer || exists(path);
        host.getSourceFile = (path, version) => {
          const contents = host.readFile(path);
          return contents === undefined ? undefined : ts.createSourceFile(path, contents, version);
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
