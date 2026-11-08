import { describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup, UserError, type HandlerEnv } from "toolcraft";
import { createHumanInLoop } from "toolcraft/human-in-loop";
import { createSDK } from "toolcraft/sdk";
import { S } from "toolcraft-schema";

import { codeMode } from "./index.js";

type MetaSDK = {
  search(params: { query: string }): Promise<Array<{ path: string }>>;
  getSchemas(params: { names: string[] }): Promise<Record<string, unknown>>;
  execute(params: { source: string }): Promise<{ ok: boolean; returnValue?: unknown }>;
};

function fixture() {
  const requestApproval = vi.fn(async () => ({ outcome: "approved" as const }));
  const runtime = createHumanInLoop({ provider: { id: "test", requestApproval } });
  const invoke = vi.spyOn(runtime, "invoke");
  const handler = vi.fn(async () => "pong");
  const root = defineGroup({
    name: "original_tools",
    children: [defineCommand({ name: "ping", scope: ["sdk"], params: S.Object({}), handler })]
  });
  return { runtime, requestApproval, invoke, root, handler };
}

describe("codemode approval root composition", () => {
  it.each([false, true])("discovers enabled built-ins with precomposition: %s", async (precomposed) => {
    const { runtime, requestApproval, invoke, root, handler } = fixture();
    const sourceRoot = precomposed ? runtime.mergeApprovalsGroup(root) : root;
    const merge = vi.spyOn(runtime, "mergeApprovalsGroup");
    const sdk = createSDK(codeMode(sourceRoot, {
      approvals: true,
      humanInLoop: runtime,
      errorReports: false
    }), { errorReports: false }) as MetaSDK;

    const results = await sdk.search({ query: "approvals" });
    expect(results.map((entry) => entry.path).sort()).toEqual(["approvals.list", "approvals.show"]);
    const schemas = await sdk.getSchemas({ names: ["approvals.list", "approvals.show"] });
    expect(Object.keys(schemas)).toEqual(["approvals.list", "approvals.show"]);
    await expect(sdk.getSchemas({ names: ["approvals.run"] })).rejects.toThrow("Unknown command path(s)");
    expect(merge).toHaveBeenCalledExactlyOnceWith(sourceRoot);
    expect(handler).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("does not implicitly merge built-ins when approvals is %s", async (approvals) => {
    const { runtime, requestApproval, root } = fixture();
    const merge = vi.spyOn(runtime, "mergeApprovalsGroup");
    const sdk = createSDK(codeMode(root, { approvals, humanInLoop: runtime, errorReports: false }), {
      errorReports: false
    }) as MetaSDK;

    await expect(sdk.search({ query: "approvals" })).resolves.toEqual([]);
    await expect(sdk.getSchemas({ names: ["approvals.list"] })).rejects.toThrow("Unknown command path(s)");
    expect(merge).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("retains explicitly composed commands when approvals is %s", async (approvals) => {
    const { runtime, requestApproval, root } = fixture();
    const composed = runtime.mergeApprovalsGroup(root);
    const merge = vi.spyOn(runtime, "mergeApprovalsGroup");
    const sdk = createSDK(codeMode(composed, { approvals, humanInLoop: runtime, errorReports: false }), {
      errorReports: false
    }) as MetaSDK;

    const results = await sdk.search({ query: "approvals" });
    expect(results.map((entry) => entry.path).sort()).toEqual(["approvals.list", "approvals.show"]);
    expect(merge).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("uses one custom effective root for discovery and execution without repeating the merge", async () => {
    const { runtime, requestApproval, invoke, root, handler } = fixture();
    const inspect = vi.fn(async ({ env }: { env: HandlerEnv }) => env.get("AUDIT_MARKER"));
    const merge = vi.spyOn(runtime, "mergeApprovalsGroup").mockImplementation(function (sourceRoot) {
      expect(this).toBe(runtime);
      return defineGroup({
        ...sourceRoot,
        name: "effective_tools",
        children: [...sourceRoot.children, defineGroup({
          name: "approvals",
          children: [defineCommand({
            name: "inspect",
            scope: ["sdk"],
            params: S.Object({}),
            handler: inspect
          })]
        })]
      });
    });
    const sdk = createSDK(codeMode(root, {
      approvals: true,
      humanInLoop: runtime,
      env: { AUDIT_MARKER: "preserved" },
      errorReports: false
    }), { errorReports: false }) as MetaSDK;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(sdk.search({ query: "inspect" })).resolves.toMatchObject([{ path: "approvals.inspect" }]);
      const schemas = await sdk.getSchemas({ names: ["approvals.inspect"] });
      expect(Object.hasOwn(schemas, "approvals.inspect")).toBe(true);
      await expect(sdk.execute({
        source: 'import { inspect } from "approvals"; return await inspect({});'
      })).resolves.toMatchObject({ ok: true, returnValue: "preserved" });
      await expect(sdk.execute({
        source: 'import { ping } from "effective_tools"; return await ping({});'
      })).resolves.toMatchObject({ ok: true, returnValue: "pong" });
    }

    expect(merge).toHaveBeenCalledExactlyOnceWith(root);
    expect(root.name).toBe("original_tools");
    expect(root.children).toHaveLength(1);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("retains the actionable missing-runtime error", () => {
    const { root } = fixture();

    expect(() => codeMode(root, { approvals: true })).toThrow(UserError);
    expect(() => codeMode(root, { approvals: true })).toThrow("approvals: true requires a wired humanInLoop runtime");
  });
});
