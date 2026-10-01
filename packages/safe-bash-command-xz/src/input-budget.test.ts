import assert from "node:assert/strict";
import test from "node:test";
import { chunks, run } from "../tests/helpers.js";
import { createXzCommand, createXzCommands, xzCommands, type XzCommandsOptions } from "./index.js";

for (const args of [["-c"], ["-qqc"], ["-dc", "/input.xz"], ["-qqdc", "/input.xz"], ["-k", "/input"], ["-qqk", "/input"], ["--list", "/input.xz"], ["-qq", "--list", "/input.xz"]]) {
  test(`XZ enforces host input budget: ${args.join(" ")}`, async () => {
    const plain = Buffer.from("bounded input".repeat(50));
    const encoded = await run("xz", ["-0c"], chunks(plain));
    await encoded.fs.writeFile("/input", plain);
    if (args.includes("/input.xz")) await encoded.fs.writeFile("/input.xz", encoded.stdout);
    const failure = new Error("host input exceeded");
    await assert.rejects(run("xz", args, chunks(plain), {
      fs: encoded.fs, inputBudget: { maxBytes: 8, check(total) { if (total > 8) throw failure; } },
    }), error => error === failure);
    assert.deepEqual(Buffer.from(await encoded.fs.readFile("/input")), plain);
  });
}

test("XZ counts stdin and retained file reads cumulatively without double charging", async () => {
  const initial = await run("xz", ["-c"], chunks());
  await initial.fs.writeFile("/input", Buffer.from("abc"));
  let total = 0;
  const result = await run("xz", ["-c", "/input", "-"], chunks(Buffer.from("de")), {
    fs: initial.fs, inputBudget: { maxBytes: 5, check(value) { total = value; assert.ok(value <= 5); } },
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(total, 5);
});

test("XZ public factories register and round-trip legacy aliases", async () => {
  const options: XzCommandsOptions = {};
  assert.equal(createXzCommand(options).name, "xz");
  assert.equal(xzCommands(options).name, "xz-commands");
  assert.deepEqual(createXzCommands().map(command => command.name), ["xz", "unxz", "xzcat", "lzma", "unlzma", "lzcat"]);
  const plain = Buffer.from("legacy aliases");
  const encoded = await run("lzma", ["-0c"], chunks(plain));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  assert.equal(encoded.stdout[0], 0x5d);
  for (const name of ["unlzma", "lzcat"]) {
    const decoded = await run(name, ["-c"], chunks(encoded.stdout));
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdout, plain);
  }
});
