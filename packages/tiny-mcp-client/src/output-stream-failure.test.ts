import { setImmediate } from "node:timers/promises";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { JsonRpcMessageLayer } from "./internal.js";

it.each(["error", "close"])("settles pending requests after output %s", async (event) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output);
  const reason = new Error("write EPIPE");
  const observed = layer.sendRequest("pending").catch((error: unknown) => error);
  try {
    expect(() => output.emit(event, reason)).not.toThrow();
    const result = await Promise.race([observed, setImmediate().then(() => "still pending")]);
    expect(result).toBeInstanceOf(Error);
    if (event === "error") expect(result).toBe(reason);
    expect(() => layer.sendNotification("later")).toThrow();
  } finally {
    layer.dispose(); input.destroy(); output.destroy(); await observed;
  }
});
