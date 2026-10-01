import path from "node:path";
import ts from "typescript";
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
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    file === filename ? ts.createSourceFile(file, source, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  expect(diagnostics).toEqual([]);
});
