import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const packages = fileURLToPath(new URL("../../", import.meta.url));

it.each(["toolcraft", "toolcraft-rust"])("%s infers contextual approval callbacks and SDK results", (implementation) => {
  const fixture = path.join(packages, "approval-inference.ts");
  const source = `
    import { S } from "toolcraft-schema";
    import { defineCommand, defineGroup } from "./${implementation}/src/index.js";
    import type { HumanInLoopConfig, HumanInLoopPending } from "./${implementation}/src/index.js";
    import { createSDK } from "./${implementation}/src/sdk.js";
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    const sync = defineCommand({
      name: "deploy", params: S.Object({ revision: S.Number() }),
      humanInLoop: { mode: "sync", message: ctx => {
        type Params = Assert<Equal<typeof ctx.params.revision, number>>;
        // @ts-expect-error undeclared parameters must be rejected
        ctx.params.missing;
        return ctx.commandPath + String(ctx.params.revision);
      }, plan: ctx => {
        type PlanParams = Assert<Equal<typeof ctx.params.revision, number>>;
        return { revision: ctx.params.revision };
      } },
      handler: ctx => ctx.params.revision
    });
    const queued = defineCommand({
      name: "queued", params: S.Object({ revision: S.Number() }),
      humanInLoop: { mode: "async", message: ctx => String(ctx.params.revision) },
      handler: ctx => ctx.params.revision
    });
    const plain = defineCommand({
      name: "plain", params: S.Object({ revision: S.Number() }),
      handler: ctx => ctx.params.revision
    });
    const optedOut = defineCommand({
      name: "optedOut", params: S.Object({ revision: S.Number() }), humanInLoop: null,
      handler: ctx => ctx.params.revision
    });
    const schema = S.Object({ revision: S.Number() });
    declare const config: HumanInLoopConfig<typeof schema> | null | undefined;
    defineCommand({ name: "configured", params: schema, humanInLoop: config, handler: ctx => ctx.params.revision });
    // @ts-expect-error a bare mode is not an approval configuration
    defineCommand({ name: "invalid", params: schema, humanInLoop: "sync", handler: () => 1 });
    // @ts-expect-error message is required
    defineCommand({ name: "invalid", params: schema, humanInLoop: { mode: "sync" }, handler: () => 1 });
    // @ts-expect-error unknown modes must be rejected
    defineCommand({ name: "invalid", params: schema, humanInLoop: { mode: "later", message: () => "review" }, handler: () => 1 });
    const inherited = createSDK(defineGroup({ name: "root", children: [defineGroup({ name: "review", humanInLoop: { mode: "async", message: () => "review" }, children: [plain, optedOut, sync] })] })).review;
    type Inherited = Assert<Equal<Awaited<ReturnType<typeof inherited.plain>>, HumanInLoopPending>>;
    type Disabled = Assert<Equal<Awaited<ReturnType<typeof inherited.optedOut>>, number>>;
    type Overridden = Assert<Equal<Awaited<ReturnType<typeof inherited.deploy>>, number>>;
    const sdk = createSDK(defineGroup({ name: "root", children: [sync, queued, plain, optedOut] }));
    type Sync = Assert<Equal<Awaited<ReturnType<typeof sdk.deploy>>, number>>;
    type Async = Assert<Equal<Awaited<ReturnType<typeof sdk.queued>>, HumanInLoopPending>>;
    type Plain = Assert<Equal<Awaited<ReturnType<typeof sdk.plain>>, number>>;
    type OptedOut = Assert<Equal<Awaited<ReturnType<typeof sdk.optedOut>>, number>>;
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = name => name === fixture ? source : readFile(name);
  const resolveModuleNames = (names: string[], containingFile: string) => names.map(name => {
    if (name === "toolcraft/sdk") {
      return { resolvedFileName: path.join(packages, "toolcraft/src/sdk.ts"), extension: ts.Extension.Ts };
    }
    return ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
  });
  host.resolveModuleNames = resolveModuleNames;
  const program = ts.createProgram([fixture], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName === fixture);
  expect(diagnostics.map(diagnostic => `${diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`)).toEqual([]);
});
