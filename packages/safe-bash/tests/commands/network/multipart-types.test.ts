import assert from "node:assert/strict";
import { test } from "node:test";
import { collectBytes, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createBody } from "../../../src/commands/network/body.js";
import { parseArguments } from "../../../src/commands/network/args.js";
import { defaultNetworkLimits } from "../../../src/commands/network/types.js";

async function upload(args: string[], filename: string, payload: Uint8Array | string): Promise<Buffer> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile(`/work/${filename}`, typeof payload === "string" ? Buffer.from(payload) : payload);
  const signal = new AbortController().signal;
  const context: CommandContext = {
    command: "curl", args, cwd: "/work", env: {}, fs, signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  };
  const body = createBody(context, parseArguments(args, defaultNetworkLimits), defaultNetworkLimits)!;
  return Buffer.from(await collectBytes(body.open(signal), { signal, maxBytes: 4096 }));
}

const types = [
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["JPG", "image/jpeg"],
  ["png", "image/png"], ["gif", "image/gif"], ["svg", "image/svg+xml"],
  ["txt", "text/plain"], ["html", "text/html"], ["htm", "text/html"],
  ["pdf", "application/pdf"], ["xml", "application/xml"],
  ["json", "application/octet-stream"], ["dat", "application/octet-stream"],
  ["", "application/octet-stream"],
] as const;

for (const flag of ["-F", "--form"]) {
  for (const [extension, type] of types) {
    test(`curl ${flag} infers ${type} for upload extension '${extension}' without changing bytes`, async () => {
      const filename = `changed image${extension ? `.${extension}` : ""}`;
      const payload = Buffer.from([0xfe, 0, 13, 10, 0xff, 65]);
      const body = await upload([flag, `changed=@${filename}`, "http://127.0.0.1/upload"], filename, payload);
      assert.ok(body.includes(Buffer.from(`name="changed"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`)));
      assert.ok(body.includes(Buffer.concat([Buffer.from("\r\n\r\n"), payload, Buffer.from("\r\n--")])));
    });
  }
}

for (const [attributes, expected] of [
  [";filename=renamed.png", "image/png"],
  [";filename=renamed.dat", "image/jpeg"],
  [";type=application/custom", "application/custom"],
  [";filename=renamed.png;type=text/plain", "text/plain"],
] as const) {
  test(`curl multipart preserves override policy ${attributes}`, async () => {
    const body = (await upload(["-F", `field=@source.jpg${attributes}`, "http://127.0.0.1/upload"], "source.jpg", "arbitrary bytes")).toString();
    assert.ok(body.includes(`Content-Type: ${expected}\r\n`), body);
  });
}
