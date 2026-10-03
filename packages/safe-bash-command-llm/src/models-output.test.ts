import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";

for (const args of [["models"], ["models", "list", "--options"]]) {
  test(`${args.join(" ")} distinguishes output types from attachment inputs`, async () => {
    let completions = 0;
    const command = createLlmCommand({
      providers: [{
        name: "Fixture",
        models: [
          { id: "a" },
          { id: "b", attachmentTypes: ["image/png"] },
          { id: "c", outputType: "image/*", attachmentTypes: ["image/png"] },
          { id: "d", outputType: "image/*" },
          { id: "e", outputType: "audio/wav" },
          { id: "f", outputType: "video/mp4" },
        ],
        complete() {
          completions++;
          throw new Error("listing must not execute a provider");
        },
      }],
    });
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await command.execute({
      command: "llm", args, fs: new MemoryFileSystem(), cwd: "/", env: {},
      signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { errors.push(chunk.slice()); } },
    });
    const attachment = args.includes("--options") ? "\n  Attachment types:\n    image/png" : "";
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(errors).toString(), "");
    assert.equal(Buffer.concat(chunks).toString(), [
      "Fixture: a",
      `Fixture: b${attachment}`,
      `Fixture: c\n  Output type: image/*${attachment}`,
      "Fixture: d\n  Output type: image/*",
      "Fixture: e\n  Output type: audio/wav",
      "Fixture: f\n  Output type: video/mp4",
      "",
    ].join("\n"));
    assert.equal(completions, 0);
  });
}
