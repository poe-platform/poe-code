import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup, defineStreamCommand, UserError, type Scope } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";
import { makeExecuteCommand } from "./execute.js";
import { makeGetSchemasCommand } from "./get-schemas.js";
import { buildHostModules } from "./host-modules.js";
import { makeSearchCommand } from "./search.js";
import { resolveCommandTree, type CommandEntry } from "./tree.js";

function fixture(nested = false, scope?: Scope[]) {
  const producer = vi.fn(async function* () { yield 1; });
  const ordinary = vi.fn(() => ({ ready: true }));
  const stream = defineStreamCommand({
    name: "watch-updates",
    scope,
    params: S.Object({}),
    event: S.Number(),
    handler: producer
  });
  const root = defineGroup({
    name: "events",
    scope: ["sdk"],
    children: [
      defineCommand({ name: "ready", params: S.Object({}), handler: ordinary }),
      ...(nested ? [defineGroup({ name: "remote-events", children: [stream] })] : [stream])
    ]
  });
  const path = nested ? "remote_events.watch_updates" : "watch_updates";
  return {
    root,
    stream,
    producer,
    ordinary,
    path,
    message: `Codemode does not support streaming command "${path}". Expose a bounded ordinary command instead.`
  };
}

describe.each([false, true])("stream catalog validation, nested: %s", (nested) => {
  it.each([
    { name: "inherited SDK scope", scope: undefined },
    { name: "explicit SDK scope", scope: ["sdk"] as Scope[] },
    { name: "all surfaces", scope: ["cli", "sdk", "mcp"] as Scope[] }
  ])("rejects $name before returning an executable catalog", async ({ scope }) => {
    const { root, producer, ordinary, message } = fixture(nested, scope);

    await expect(resolveCommandTree(root)).rejects.toThrow(new UserError(message));

    expect(producer).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  });

  it.each([
    { scope: ["cli"] as Scope[] },
    { scope: ["mcp"] as Scope[] },
    { scope: ["cli", "mcp"] as Scope[] }
  ])("keeps SDK-excluded streams out of otherwise executable catalogs: $scope", async ({ scope }) => {
    const { root, producer, ordinary } = fixture(nested, scope);
    const tree = await resolveCommandTree(root);
    expect(tree.entries.map((entry) => entry.path)).toEqual(["ready"]);
    const sdk = createSDK(codeMode(root), { errorReports: false }) as {
      execute(params: { source: string }): Promise<unknown>;
    };

    await expect(sdk.execute({ source: 'import { ready } from "events"; return await ready({});' }))
      .resolves.toMatchObject({ ok: true, returnValue: { ready: true } });

    expect(producer).not.toHaveBeenCalled();
    expect(ordinary).toHaveBeenCalledOnce();
  });

  it.each(["search", "getSchemas", "execute"] as const)("rejects %s consistently without starting handlers", async (surface) => {
    const { root, producer, ordinary, path, message } = fixture(nested);
    const sdk = createSDK(codeMode(root), { errorReports: false }) as {
      search(params: { query: string }): Promise<unknown>;
      getSchemas(params: { names: string[] }): Promise<unknown>;
      execute(params: { source: string }): Promise<unknown>;
    };
    const operation = surface === "search"
      ? sdk.search({ query: "updates" })
      : surface === "getSchemas"
        ? sdk.getSchemas({ names: [path] })
        : sdk.execute({ source: "return 1;" });

    await expect(operation).rejects.toThrow(new UserError(message));
    expect(producer).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  });
});

describe.each([false, true])("caller-supplied stream catalog, deferred: %s", (deferred) => {
  it.each(["search", "getSchemas", "hostModules", "execute"] as const)("validates %s entries before advertising or invoking them", async (surface) => {
    const { root, stream, producer, ordinary, message } = fixture();
    const list: CommandEntry[] = [{ path: "watch_updates", groupPath: "", name: "watch_updates", sdkPath: ["watchUpdates"], command: stream }];
    const entries = deferred ? Promise.resolve(list) : list;
    const sdk = { watchUpdates: vi.fn(() => 1) };
    let operation: Promise<unknown>;
    if (surface === "hostModules") {
      operation = buildHostModules(root, sdk, entries);
    } else {
      const command = surface === "search"
        ? makeSearchCommand({ entries })
        : surface === "getSchemas"
          ? makeGetSchemasCommand({ entries })
          : makeExecuteCommand({ root, sdk, entries });
      const adapter = createSDK(defineGroup({ name: "catalog", children: [command] }), { errorReports: false }) as Record<string, (params: Record<string, unknown>) => Promise<unknown>>;
      operation = adapter[surface]!({
        ...(surface === "search" ? { query: "updates" } : surface === "getSchemas" ? { names: ["watch_updates"] } : { source: 'import { watch_updates } from "events"; return await watch_updates({});' })
      });
    }

    await expect(operation).rejects.toThrow(new UserError(message));
    expect(sdk.watchUpdates).not.toHaveBeenCalled();
    expect(producer).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  });
});

it("owns an unused rejected stream catalog without an unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const listener = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", listener);
  try {
    const { root, producer, ordinary, message } = fixture();
    const sdk = createSDK(codeMode(root), { errorReports: false }) as {
      search(params: { query: string }): Promise<unknown>;
    };
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(sdk.search({ query: "updates" })).rejects.toThrow(new UserError(message));
    expect(unhandled).toEqual([]);
    expect(producer).not.toHaveBeenCalled();
    expect(ordinary).not.toHaveBeenCalled();
  } finally {
    process.off("unhandledRejection", listener);
  }
});
