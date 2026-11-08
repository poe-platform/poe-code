import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import assert from "node:assert/strict";
const directory = join(dirname(fileURLToPath(import.meta.url)), "../src");
const filename = join(directory, "internal.ts");
const source = ts.createSourceFile(
  filename,
  readFileSync(filename, "utf8"),
  ts.ScriptTarget.Latest
);
const optionsDeclaration = source.statements.find(
  (statement) =>
    ts.isInterfaceDeclaration(statement) && statement.name.text === "HttpTransportOptions"
);
const headers = optionsDeclaration?.members.find(
  (member) => ts.isPropertySignature(member) && member.name.getText(source) === "headers"
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
];
// Let TypeScript key reusable syntax trees by the compilation settings and
// implied module format. Every profile still builds and checks its own program.
const registry = ts.createDocumentRegistry();
const documents = [];
try {
  for (const resolution of ["NodeNext", "Bundler"]) {
    for (const dom of [false, true]) {
      console.log(`Checking ${resolution} ${dom ? "DOM" : "Node-only"}: ${cases.length} cases`);
      const started = performance.now();
      assert.notEqual(headers?.type, undefined);
      assert.notEqual(headers?.questionToken, undefined);
      const virtualConsumer = join(directory, "http-headers.virtual-consumer.ts");
      const preamble = [
        `type PublicHeaders = ${headers.type.getText(source)} | undefined;`,
        "declare const init: RequestInit;"
      ];
      const text = [
        ...preamble,
        ...cases.map(
          ([, expression], index) => `const headers${index}: PublicHeaders = ${expression};`
        )
      ].join("\n");
      const options = {
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
        if (contents === undefined) return undefined;
        const parsed = registry.acquireDocument(
          path,
          options,
          ts.ScriptSnapshot.fromString(contents),
          contents,
          ts.ScriptKind.TS,
          version
        );
        documents.push({ path, options, format: parsed.impliedNodeFormat });
        return parsed;
      };
      const program = ts.createProgram([virtualConsumer], options, host);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      const unexpected = diagnostics.filter(
        (diagnostic) =>
          diagnostic.file?.fileName !== virtualConsumer ||
          diagnostic.start === undefined ||
          diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line < preamble.length
      );
      assert.deepEqual(
        unexpected.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        ),
        []
      );
      for (const [index, [name, , valid]] of cases.entries()) {
        const errors = diagnostics.filter(
          (diagnostic) =>
            diagnostic.file?.fileName === virtualConsumer &&
            diagnostic.start !== undefined &&
            diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line ===
              preamble.length + index
        );
        assert.equal(errors.length === 0, valid, name);
      }
      console.log(
        `${resolution} ${dom ? "DOM" : "Node-only"}: ${cases.length} cases passed in ${(performance.now() - started).toFixed(1)}ms`
      );
    }
  }
} finally {
  for (const { path, options, format } of documents) {
    registry.releaseDocument(path, options, ts.ScriptKind.TS, format);
  }
}
