import { PassThrough, Readable } from "node:stream";
import { expect, it } from "vitest";
import { JsonRpcMessageLayer, readLines } from "./internal.js";

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const lines: string[] = []; for await (const line of stream) lines.push(line); return lines;
}

it.each([{ chunks: ["12345"] }, { chunks: ["12", "345"] }, { chunks: ["12345\n"] }, { chunks: ["🦊x"] }])("bounds complete and incomplete UTF-8 lines: $chunks", async ({ chunks }) => {
  await expect(collect(readLines(Readable.from(chunks), 4))).rejects.toThrow("byte limit");
});

it("applies the limit independently to coalesced frames", async () => {
  await expect(collect(readLines(Readable.from(["1234\n🦊\n1234\n"]), 4))).resolves.toEqual(["1234", "🦊", "1234"]);
});

it("rejects invalid UTF-8 instead of replacing it in a protocol value", async () => {
  await expect(collect(readLines(Readable.from([Buffer.from([0xc3, 0x28])])))).rejects.toThrow();
});

it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid line limits: %s", async (limit) => {
  await expect(collect(readLines(Readable.from([]), limit))).rejects.toThrow("positive safe integer");
});

it("decodes UTF-8 points split across byte chunks at the exact limit", async () => {
  const bytes = Buffer.from("🦊\n");
  await expect(collect(readLines(Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]), 4))).resolves.toEqual(["🦊"]);
});

it("fails pending exchanges promptly when byte input is invalid UTF-8", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const layer = new JsonRpcMessageLayer(input, output);
  const request = layer.sendRequest("tools/list", {}, { timeoutMs: null });
  const observed = expect(request).rejects.toThrow();
  try {
    input.write(Buffer.from([0xc3, 0x28]));
    await observed;
    expect(input.destroyed).toBe(true);
  } finally { layer.dispose(); input.destroy(); output.destroy(); }
});
