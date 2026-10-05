import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { generate } from "./generate.js";

it("compiles public clients and generated entrypoints with safe-bash services", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const directory = path.join(root, "packages/toolcraft-openapi/src/virtual-consumer");
  const files = new Map(generate({
    openapi: "3.1.0",
    info: { title: "Example", version: "1" },
    paths: { "/widgets": { get: {
      operationId: "listWidgets",
      responses: { "200": { description: "OK" } }
    } } }
  }, { specSha: "test" }).map(file => [path.join(directory, file.path), file.contents]));
  files.set(path.join(directory, "consumer.ts"), `
import { defineClient, defineClientFromSpec, type DefineClientOptions,
  type DefineClientFromSpecOptions, type DefinedClient } from "toolcraft-openapi";
import { createToolcraftCommandExecutor, toolcraftCommands } from "toolcraft/safe-bash";
import { defineGeneratedClient } from "./client.js";
const options = { name: "example", baseUrl: "https://example.invalid",
  auth: { commands: [], getToken: async () => "synthetic" } };
const spec = { openapi: "3.1.0", info: { title: "Example", version: "1" }, paths: {} };
const directOptions: DefineClientOptions = { ...options, commands: [] };
const runtimeOptions: DefineClientFromSpecOptions = options;
const direct: DefinedClient = defineClient(directOptions);
const runtime = await defineClientFromSpec(spec, runtimeOptions);
const inferred = defineClient({ ...options, commands: [] });
const generated = defineGeneratedClient(options);
createToolcraftCommandExecutor(direct.root, { services: direct.services });
toolcraftCommands(direct.root, { services: direct.services });
createToolcraftCommandExecutor(runtime.root, { services: runtime.services });
toolcraftCommands(runtime.root, { services: runtime.services });
createToolcraftCommandExecutor(inferred.root, { services: inferred.services });
toolcraftCommands(inferred.root, { services: inferred.services });
createToolcraftCommandExecutor(generated.root, { services: generated.services });
toolcraftCommands(generated.root, { services: generated.services });
interface CustomServices { tenant: string }
const customDirect = defineClient<CustomServices>({ ...options, commands: [] });
const customRuntime = await defineClientFromSpec<CustomServices>(spec, options);
for (const client of [customDirect, customRuntime]) {
  const services = { ...client.services, tenant: "example" };
  createToolcraftCommandExecutor(client.root, { services });
  toolcraftCommands(client.root, { services });
  // @ts-expect-error additional services must be provided
  createToolcraftCommandExecutor(client.root, { services: client.services });
  // @ts-expect-error additional services must be provided
  toolcraftCommands(client.root, { services: client.services });
  // @ts-expect-error additional services retain their declared types
  toolcraftCommands(client.root, { services: { ...client.services, tenant: 42 } });
}
`);
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: root,
    paths: { "toolcraft-openapi": ["packages/toolcraft-openapi/src/index.ts"] },
    types: ["node"]
  };
  const host = ts.createCompilerHost(options);
  const directoryExists = host.directoryExists!.bind(host);
  host.directoryExists = dir => [...files.keys()].some(file => file.startsWith(dir + path.sep)) || directoryExists(dir);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = file => files.get(file) ?? readFile(file);
  host.fileExists = file => files.has(file) || fileExists(file);
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n"
  })).toBe("");
});
