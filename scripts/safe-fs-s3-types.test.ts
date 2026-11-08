import path from "node:path";
import ts from "typescript";
import { declarationSource } from "./publish-declarations.mjs";
import { expect, it } from "vitest";

it.each(["@poe-code/safe-fs", "poe-code/safe-fs"].flatMap(specifier =>
  ["browser", "node"].map(profile => ({ specifier, profile }))
))("type-checks $specifier for $profile consumers", ({ specifier, profile }) => {
  const filename = path.join(process.cwd(), "out/s3-type-consumer.mts");
  const source = `
    import type { S3HttpRequestFactory, S3HttpTransportOptions } from "${specifier}";
    const options: S3HttpTransportOptions = {
      endpoint: "https://s3.example.test", region: "test",
      credentials: { accessKeyId: "test", secretAccessKey: "test" }
    };
    ${profile === "browser" ? `
      type Assert<T extends true> = T;
      type RejectsNodeFactory = Assert<S3HttpRequestFactory extends never ? true : false>;
    ` : `
      import { request } from "node:http";
      const factory: S3HttpRequestFactory = request;
      const configured: S3HttpTransportOptions = { ...options, request: factory };
    `}
  `;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, strict: true,
    types: profile === "node" ? ["node"] : [],
    customConditions: profile === "browser" ? ["browser"] : [],
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], skipLibCheck: false
  };
  const host = ts.createCompilerHost(options);
  // Unit builds produce workspace declarations; publication mirrors them under dist/types.
  const root = process.cwd();
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists!.bind(host);
  host.readFile = file => readFile(declarationSource(root, file));
  host.fileExists = file => fileExists(declarationSource(root, file));
  host.directoryExists = directory => directory === path.join(root, "dist/types")
    || directoryExists(declarationSource(root, directory));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    file === filename ? ts.createSourceFile(file, source, languageVersion, true)
      : declarationSource(root, file) !== file
        ? (() => {
          const text = host.readFile(file);
          return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
        })()
        : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(diagnostics).toEqual([]);
});
