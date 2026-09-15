import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";
import { codeMode } from "./index.js";
import * as tree from "./tree.js";

interface CatalogSDK {
  search(params: { query: string }): Promise<unknown>;
  getSchemas(params: { names: string[] }): Promise<unknown>;
  execute(params: { source: string }): Promise<unknown>;
}

function fixture(name = "ready") {
  const handler = vi.fn(() => "ready");
  const root = defineGroup({
    name: "audit",
    children: [defineCommand({ name, scope: ["sdk"], params: S.Object({}), handler })]
  });
  const sdk = createSDK(codeMode(root, { approvals: false }), { approvals: false }) as CatalogSDK;
  return { sdk, handler };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.restoreAllMocks();
});

describe("codemode catalog failure ownership", () => {
  it("contains an unused catalog failure and preserves it for every later consumer", async () => {
    const resolve = vi.spyOn(tree, "resolveCommandTree");
    const { sdk, handler } = fixture("---");

    await new Promise<void>((finish) => setImmediate(finish));
    const results = await Promise.allSettled([
      sdk.search({ query: "ready" }),
      sdk.getSchemas({ names: ["ready"] }),
      sdk.execute({ source: "return 1;" })
    ]);

    expect(unhandled).toEqual([]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    const first = results[0];
    expect(first?.status).toBe("rejected");
    if (first?.status !== "rejected") throw new Error("Expected a rejected catalog");
    expect(first.reason).toHaveProperty(
      "message", 'Codemode command name "---" must include at least one non-separator character.'
    );
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toBe(first.reason);
    }
  });

  it("preserves immediate first-use failures", async () => {
    const { sdk, handler } = fixture("---");

    await expect(sdk.search({ query: "ready" }))
      .rejects.toThrow('Codemode command name "---" must include at least one non-separator character.');
    await new Promise<void>((finish) => setImmediate(finish));

    expect(unhandled).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    { name: "Error", reason: new Error("catalog unavailable") },
    { name: "object", reason: { message: "catalog unavailable", code: "offline" } },
    { name: "string", reason: "catalog unavailable" }
  ])("retains a deferred $name rejection without resolving the catalog again", async ({ reason }) => {
    const resolve = vi.spyOn(tree, "resolveCommandTree").mockRejectedValueOnce(reason);
    const { sdk, handler } = fixture();

    await new Promise<void>((finish) => setImmediate(finish));
    const results = await Promise.allSettled([
      sdk.search({ query: "ready" }),
      sdk.getSchemas({ names: ["ready"] }),
      sdk.execute({ source: "return 1;" })
    ]);

    expect(unhandled).toEqual([]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason).toBe(reason);
    }
  });

  it("does not run handlers for an unused healthy wrapper", async () => {
    const resolve = vi.spyOn(tree, "resolveCommandTree");
    const { handler } = fixture();

    await new Promise<void>((finish) => setImmediate(finish));

    expect(unhandled).toEqual([]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps a healthy catalog available to all delayed consumers", async () => {
    const resolve = vi.spyOn(tree, "resolveCommandTree");
    const { sdk, handler } = fixture();

    await new Promise<void>((finish) => setImmediate(finish));

    await expect(sdk.search({ query: "ready" })).resolves.toMatchObject([{ path: "ready" }]);
    await expect(sdk.getSchemas({ names: ["ready"] })).resolves.toHaveProperty("ready");
    await expect(sdk.execute({ source: 'import { ready } from "audit"; return await ready({});' }))
      .resolves.toMatchObject({ ok: true, returnValue: "ready" });
    expect(unhandled).toEqual([]);
    expect(resolve).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
  });
});
