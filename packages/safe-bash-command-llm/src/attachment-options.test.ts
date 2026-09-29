import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

for (const args of [["--at", "/image", "image/png"], ["--attachment-type", "/image", "image/png"], ["--attachment-type=/image", "image/png"]]) {
  test(`typed attachment spelling ${args[0]} preserves MIME and bytes`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/image", Uint8Array.of(1, 2, 3));
    let calls = 0;
    const command = createLlmCommand({ defaultModel: "fixture", providers: [{
      name: "fixture", models: [{ id: "fixture", attachmentTypes: ["image/png"] }],
      async *complete(request) {
        calls++;
        assert.deepEqual(request.attachments, [{ mimeType: "image/png", bytes: Uint8Array.of(1, 2, 3) }]);
        yield "answer";
      },
    }] });
    const errors: Uint8Array[] = [];
    const result = await command.execute({ command: "llm", args, fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(calls, 1);
  });
}
