import { describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { UserError, defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

describe("createSDK JSON validation", () => {
  it.each([
    ["function", () => 42],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["symbol", Symbol("payload")],
    ["Date", new Date(0)],
    ["Map", new Map([["key", "value"]])],
    ["nested undefined", { child: undefined }],
    ["nested function", [() => 42]]
  ])("rejects %s before calling the handler", async (_name, payload) => {
    const handler = vi.fn(async () => "executed");
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [defineCommand({ name: "store", params: S.Object({ payload: S.Json() }), handler })]
      }),
      { errorReports: false }
    );

    await expect(sdk.store({ payload: payload as never })).rejects.toThrow(UserError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects circular JSON with a parameter error", async () => {
    const payload: Record<string, unknown> = {};
    payload.self = payload;
    const handler = vi.fn(async () => "executed");
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [defineCommand({ name: "store", params: S.Object({ payload: S.Json() }), handler })]
      }),
      { errorReports: false }
    );

    await expect(sdk.store({ payload: payload as never })).rejects.toThrow("payload");
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves arbitrary JSON keys and shared non-circular objects", async () => {
    const shared = { preserve_this_key: [null, true, 2, "value"] };
    const payload = { first: shared, second: shared };
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "store",
            params: S.Object({ payload: S.Json() }),
            handler: async ({ params }) => params
          })
        ]
      }),
      { errorReports: false }
    );

    await expect(sdk.store({ payload })).resolves.toEqual({ payload });
  });

  it("includes the nested SDK parameter path in JSON errors", async () => {
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "store",
            params: S.Object({ items: S.Array(S.Object({ request_body: S.Json() })) }),
            handler: async ({ params }) => params
          })
        ]
      }),
      { errorReports: false }
    );

    await expect(
      sdk.store({ items: [{ requestBody: Number.NaN }] })
    ).rejects.toThrow('Invalid value for "items[0].requestBody". Expected a JSON value');
  });
});

describe("createSDK invalid primitive diagnostics", () => {
  it.each([
    ["bigint", 1n, "bigint"],
    ["symbol", Symbol("payload"), "symbol"],
    ["function", () => 42, "function"],
    ["NaN", Number.NaN, "NaN"],
    ["positive infinity", Number.POSITIVE_INFINITY, "Infinity"],
    ["negative infinity", Number.NEGATIVE_INFINITY, "-Infinity"]
  ])("reports %s without crashing or misidentifying it", async (_name, payload, received) => {
    const handler = vi.fn(async () => "executed");
    const sdk = createSDK(
      defineGroup({
        name: "root",
        children: [defineCommand({ name: "store", params: S.Object({ payload: S.Number() }), handler })]
      }),
      { errorReports: false }
    );

    await expect(sdk.store({ payload: payload as never })).rejects.toThrow(
      new UserError(`Invalid value for "payload". Expected a number, got ${received}.`)
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
