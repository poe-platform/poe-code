import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createLlmConfiguration } from "./configuration.js";

test("llm keys CLI and configuration store manage keys.json and resolve --key for prompt requests", async () => {
  const fs = new MemoryFileSystem();
  const receivedKeys: (string | undefined)[] = [];
  const command = createLlmCommand({
    defaultModel: "fixture",
    providers: [
      {
        name: "fixture",
        models: [{ id: "fixture" }],
        async *complete(request) {
          receivedKeys.push(request.key);
          yield "ok";
        },
      },
    ],
  });
  const run = async (args: readonly string[], stdin = "") => {
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: "llm",
      args,
      fs,
      cwd: "/work",
      env: { LLM_USER_PATH: "/settings" },
      signal: new AbortController().signal,
      stdin: toByteSource(stdin),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    return { exitCode: result.exitCode, stdout, stderr };
  };

  assert.deepEqual(await run(["keys", "path"]), {
    exitCode: 0,
    stdout: "/settings/keys.json\n",
    stderr: "",
  });
  assert.deepEqual(await run(["keys"]), {
    exitCode: 0,
    stdout: "No keys found\n",
    stderr: "",
  });
  const missingFileGet = await run(["keys", "get", "openai"]);
  assert.equal(missingFileGet.exitCode, 1);
  assert.match(missingFileGet.stderr, /Error: No keys found/);
  assert.deepEqual(await run(["keys", "set", "openai", "--value", "sk-stored-123"]), {
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  assert.deepEqual(await run(["keys", "set", "anthropic"], "sk-stdin-456\n"), {
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
  assert.deepEqual(await run(["keys", "list"]), {
    exitCode: 0,
    stdout: "anthropic\nopenai\n",
    stderr: "",
  });
  assert.deepEqual(await run(["keys", "get", "openai"]), {
    exitCode: 0,
    stdout: "sk-stored-123\n",
    stderr: "",
  });
  const missingKeyGet = await run(["keys", "get", "missing"]);
  assert.equal(missingKeyGet.exitCode, 1);
  assert.match(missingKeyGet.stderr, /Error: No key found with name 'missing'/);

  const raw = JSON.parse(new TextDecoder().decode(await fs.readFile("/settings/keys.json")));
  assert.equal(raw["// Note"], "This file stores secret API credentials. Do not share!");
  assert.equal(raw.openai, "sk-stored-123");
  assert.equal(raw.anthropic, "sk-stdin-456");

  assert.deepEqual(await run(["--key", "openai", "hello"]), {
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });
  assert.deepEqual(await run(["--key", "sk-literal-789", "hello"]), {
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });
  assert.deepEqual(receivedKeys, ["sk-stored-123", "sk-literal-789"]);

  const config = createLlmConfiguration({
    fs,
    cwd: "/work",
    env: { LLM_USER_PATH: "/settings" },
    signal: new AbortController().signal,
  });
  assert.deepEqual(await config.keys(), { anthropic: "sk-stdin-456", openai: "sk-stored-123" });
});
