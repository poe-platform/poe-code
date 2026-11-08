import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createOpenAiProvider } from "./openai.js";

test("OpenAI provider supports non-streaming chat completion JSON responses when stream is false", async () => {
  const encoder = new TextEncoder();
  const requestBodies: string[] = [];
  let disposed = 0;
  const provider = createOpenAiProvider({
    apiKey: "synthetic-test-key",
    models: [{ id: "fixture", endpoint: "chat" }],
    transport: async request => {
      let body = "";
      for await (const bytes of request.body!) body += new TextDecoder().decode(bytes);
      requestBodies.push(body);
      return {
        status: 200,
        statusText: "OK",
        headers: [],
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode(JSON.stringify({
              id: "fixture-id",
              model: "fixture",
              choices: [{ message: { role: "assistant", content: "hello😀" } }],
              usage: { prompt_tokens: 2, completion_tokens: 3 },
            }));
          },
        },
        async dispose() { disposed++; },
      };
    },
  });
  let text = "";
  for await (const part of provider.complete({
    model: "fixture",
    prompt: "hi",
    stream: false,
    attachments: [],
    options: {},
    signal: new AbortController().signal,
  })) {
    text += part;
  }
  assert.equal(disposed, 1);
  assert.equal(JSON.parse(requestBodies[0]!).stream, false);
  assert.equal(text, "hello😀");
});

test("CLI extraction flags (-x, --extract, --xl, --extract-last) and template extract fields select fenced blocks and set stream=false", async () => {
  for (const sources of [false, true]) {
    for (const [argv, expected] of [
      [["prompt", "fixture"], { stream: true, out: "```\nfirst\n```\n```\nlast\n```\n" }],
      [["prompt", "fixture", "--no-stream"], { stream: false, out: "```\nfirst\n```\n```\nlast\n```\n" }],
      [["prompt", "fixture", "-x"], { stream: false, out: "first\n\n" }],
      [["prompt", "fixture", "--extract"], { stream: false, out: "first\n\n" }],
      [["prompt", "fixture", "--xl"], { stream: false, out: "last\n\n" }],
      [["prompt", "fixture", "--extract-last"], { stream: false, out: "last\n\n" }],
      [["prompt", "fixture", "-x", "--xl"], { stream: false, out: "last\n\n" }],
      [["prompt", "fixture", "--xl", "-x"], { stream: false, out: "last\n\n" }],
    ] as const) {
      const modes: unknown[] = [];
      const complete = async function* (request: { stream?: boolean | undefined }) {
        modes.push(request.stream);
        yield "```\nfirst\n```\n```\nlast\n```";
      };
      const fs = new MemoryFileSystem();
      const command = createLlmCommand({
        defaultModel: "fixture",
        providers: [{ name: "fixture", models: [{ id: "fixture" }], complete, ...(sources ? { completeSources: complete } : {}) }],
      });
      let stdout = "", stderr = "";
      const result = await command.execute({
        command: "llm",
        args: argv,
        fs,
        cwd: "/",
        env: {},
        signal: new AbortController().signal,
        stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(modes, [expected.stream]);
      assert.equal(stdout, expected.out);
    }
  }
});
