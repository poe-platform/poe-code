import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createFsFromVolume, Volume } from "memfs";

test("public codec declarations compile for ES-only consumers without codec internals", () => {
  const input = fileURLToPath(new URL("./encoding.ts", import.meta.url));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, declaration: true, emitDeclarationOnly: true, skipLibCheck: true };
  const program = ts.createProgram([input], options);
  const memory = createFsFromVolume(new Volume());
  memory.mkdirSync("/consumer");
  program.emit(program.getSourceFile(input), (name, text) => {
    if (name.endsWith("/encoding.d.ts")) memory.writeFileSync("/consumer/encoding.d.ts", text);
  });
  memory.writeFileSync("/consumer/index.ts", 'import { createOpTextCodec } from "./encoding.js"; const codec = createOpTextCodec("gbk"); const bytes: Uint8Array = codec.encode("中文"); const decoder = codec.decoder({ fatal: true, ignoreBOM: true }); const text: string = decoder.decode(bytes, { stream: true }); decoder.decode(); void text;');
  const consumerOptions: ts.CompilerOptions = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: false, noUncheckedSideEffectImports: true };
  const host = ts.createCompilerHost(consumerOptions);
  const read = host.readFile, exists = host.fileExists;
  host.readFile = path => memory.existsSync(path) ? memory.readFileSync(path, "utf8") as string : read(path);
  host.fileExists = path => memory.existsSync(path) || exists(path);
  host.directoryExists = path => path === "/consumer" || ts.sys.directoryExists(path);
  host.getSourceFile = (path, version) => { const text = host.readFile(path); return text === undefined ? undefined : ts.createSourceFile(path, text, version, true); };
  const consumer = ts.createProgram(["/consumer/index.ts"], consumerOptions, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(consumer).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});
