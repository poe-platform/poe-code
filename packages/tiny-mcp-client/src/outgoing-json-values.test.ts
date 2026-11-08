import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { JsonRpcMessageLayer } from "./internal.js";

it.each([undefined, NaN, Infinity, 1n, () => undefined, Symbol("invalid"), new Date(0), new Array(2)])(
  "rejects values JSON serialization would alter or omit before writing: %s", async (value) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const write = vi.spyOn(output, "write");
    const layer = new JsonRpcMessageLayer(input, output);
    try {
      await expect(layer.sendRequest("tools/call", { name: "work", arguments: { value } }, { timeoutMs: 0 }))
        .rejects.toThrow("JSON");
      expect(write).not.toHaveBeenCalled();
    } finally { layer.dispose(); input.destroy(); output.destroy(); }
  }
);

it("rejects getters and serialization hooks without executing them", async () => {
  const hook = vi.fn(() => "changed");
  const getter = vi.fn(() => "changed");
  const values = [{ toJSON: hook }, Object.defineProperty({}, "secret", { enumerable: true, get: getter })];
  const input = new PassThrough();
  const output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output);
  try {
    for (const value of values) {
      await expect(layer.sendRequest("tools/call", { arguments: { value } }, { timeoutMs: 0 })).rejects.toThrow("JSON");
    }
    expect(hook).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});

it.each([{ "bad key": true }, [], { "bad-prefix-/name": true }])("rejects invalid request and notification metadata before writing: %j", async (metadata) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const write = vi.spyOn(output, "write");
  const layer = new JsonRpcMessageLayer(input, output);
  layer.requestMetadata = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
  try {
    await expect(layer.sendRequest("tools/list", { _meta: metadata }, { timeoutMs: 0 })).rejects.toMatchObject({ code: -32602 });
    expect(() => layer.sendNotification("notifications/custom", { _meta: metadata })).toThrow("metadata");
    expect(write).not.toHaveBeenCalled();
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});

it("rejects notification metadata accessors without invoking them", () => {
  const getter = vi.fn(() => ({}));
  const input = new PassThrough();
  const output = new PassThrough();
  const write = vi.spyOn(output, "write");
  const layer = new JsonRpcMessageLayer(input, output);
  try {
    const params = Object.defineProperty({}, "_meta", { enumerable: true, get: getter });
    expect(() => layer.sendNotification("notifications/custom", params)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});
