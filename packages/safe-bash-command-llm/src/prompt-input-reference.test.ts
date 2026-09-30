import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import type { LlmSourceRequest } from "./types.js";

// llm==0.27.1, deterministic echo provider, Click CliRunner with explicit stdin.
const reference = [
  { prompt: "question", stdin: "context 🙂", stdout: "context 🙂 question\n" },
  { prompt: "question", stdin: "context\n", stdout: "context\n question\n" },
  { prompt: "", stdin: "context", stdout: "context\n" },
  { prompt: "question", stdin: "", stdout: "question\n" },
];
for (const mode of ["buffered", "source"] as const) {
  for (const fixture of reference) {
    test(`llm 0.27.1 ${mode} prompt composition ${JSON.stringify(fixture)}`, async () => {
      const command = createLlmCommand({ defaultModel: "fixture", providers: [{
        name: "echo", models: [{ id: "fixture" }],
        async *complete(request) { yield request.prompt; },
        ...(mode === "source" ? { async *completeSources(request: LlmSourceRequest) {
          const decoder = new TextDecoder("utf-8", { fatal: true });
          for await (const bytes of request.prompt.bytes) yield decoder.decode(bytes, { stream: true });
          yield decoder.decode();
        } } : {}),
      }] });
      let stdout = "", stderr = "";
      const result = await command.execute({ command: "llm", args: fixture.prompt ? [fixture.prompt] : [],
        fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: toByteSource(fixture.stdin), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, fixture.stdout);
    });
  }
}
