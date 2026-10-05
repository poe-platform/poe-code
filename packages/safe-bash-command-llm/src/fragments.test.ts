import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import type { LlmSourceRequest } from "./types.js";

// Captured from llm==0.27.1 Prompt.prompt and Prompt.system with a deterministic model.
const cases = [
  {
    fragments: ["first", "second"],
    prompt: "question",
    systems: [" rules ", "\n extra\t"],
    system: " end ",
    expectedPrompt: "first\nsecond\nquestion",
    expectedSystem: "rules\n\nextra\n\nend"
  },
  {
    fragments: ["", "x", ""],
    prompt: "",
    systems: ["", " \n", "\u001c yes \u001f", "\ufeff"],
    system: "",
    expectedPrompt: "\nx\n",
    expectedSystem: "yes\n\n\ufeff"
  },
  {
    fragments: ["é\n", "🙂"],
    prompt: "stdin question",
    systems: [" a\n b "],
    system: undefined,
    expectedPrompt: "é\n\n🙂\nstdin question",
    expectedSystem: "a\n b"
  }
];
async function text(source: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let value = "";
  for await (const chunk of source) value += decoder.decode(chunk, { stream: true });
  return value + decoder.decode();
}
for (const streamed of [false, true])
  for (const [index, fixture] of cases.entries()) {
    test(`reference fragment composition ${index}, source=${streamed}`, async () => {
      const fs = new MemoryFileSystem();
      const args: string[] = [];
      for (const [i, value] of fixture.fragments.entries()) {
        await fs.writeFile(`/f${i}`, new TextEncoder().encode(value));
        args.push("-f", `/f${i}`);
      }
      for (const [i, value] of fixture.systems.entries()) {
        await fs.writeFile(`/s${i}`, new TextEncoder().encode(value));
        args.push("--sf", `/s${i}`);
      }
      if (fixture.system !== undefined) args.push("-s", fixture.system);
      if (fixture.prompt) args.push(fixture.prompt);
      let calls = 0,
        stderr = "";
      const verify = (prompt: string, system: string | undefined) => {
        calls++;
        assert.equal(prompt, fixture.expectedPrompt);
        assert.equal(system, fixture.expectedSystem);
      };
      const command = createLlmCommand({
        defaultModel: "fixture",
        providers: [
          {
            name: "fixture",
            models: [{ id: "fixture" }],
            async *complete(request) {
              verify(request.prompt, request.system);
              yield "ok";
            },
            ...(streamed
              ? {
                  async *completeSources(request: LlmSourceRequest) {
                    verify(
                      await text(request.prompt.bytes),
                      request.system ? await text(request.system.bytes) : undefined
                    );
                    yield "ok";
                  }
                }
              : {})
          }
        ]
      });
      const result = await command.execute({
        command: "llm",
        args,
        fs,
        cwd: "/",
        env: {},
        signal: new AbortController().signal,
        stdin: toByteSource(""),
        stdout: { async write() {} },
        stderr: {
          async write(bytes) {
            stderr += new TextDecoder().decode(bytes);
          }
        }
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(calls, 1);
      assert.ok((await fs.readdir("/")).every((entry) => !entry.name.startsWith(".llm-")));
    });
  }

test("template fragments precede CLI fragments and use universal newlines", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first", new TextEncoder().encode("one\r\ntwo\rthree"));
  await fs.writeFile("/second", new TextEncoder().encode("four"));
  await fs.writeFile(
    "/template.yaml",
    new TextEncoder().encode("prompt: question\nfragments: [/first]\nsystem_fragments: [/first]\n")
  );
  let received = "",
    stderr = "";
  const command = createLlmCommand({
    defaultModel: "fixture",
    providers: [
      {
        name: "fixture",
        models: [{ id: "fixture" }],
        async *complete(request) {
          received = request.prompt;
          assert.equal(request.system, "one\ntwo\nthree");
          yield "ok";
        }
      }
    ]
  });
  const result = await command.execute({
    command: "llm",
    args: ["-t", "/template.yaml", "--fragment=/second"],
    fs,
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: toByteSource(""),
    stdout: { async write() {} },
    stderr: {
      async write(bytes) {
        stderr += new TextDecoder().decode(bytes);
      }
    }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(received, "one\ntwo\nthree\nfour\nquestion");
});

test("saving fragment paths does not acquire files and reloads their current content", async () => {
  const fs = new MemoryFileSystem();
  let received = "";
  const command = createLlmCommand({
    defaultModel: "fixture",
    providers: [
      {
        name: "fixture",
        models: [{ id: "fixture" }],
        async *complete(request) {
          received = request.prompt;
          assert.equal(request.system, "rules");
          yield "ok";
        }
      }
    ]
  });
  const run = async (args: string[]) => {
    let stderr = "";
    const result = await command.execute({
      command: "llm",
      args,
      fs,
      cwd: "/",
      env: { LLM_USER_PATH: "/settings" },
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: {
        async write(bytes) {
          stderr += new TextDecoder().decode(bytes);
        }
      }
    });
    assert.equal(result.exitCode, 0, stderr);
  };
  await run(["--save", "saved", "-f", "/later", "--system-fragment", "/rules", "question"]);
  assert.equal(received, "");
  await fs.writeFile("/later", new TextEncoder().encode("fresh context"));
  await fs.writeFile("/rules", new TextEncoder().encode("rules"));
  await run(["-t", "saved"]);
  assert.equal(received, "fresh context\nquestion");
});
