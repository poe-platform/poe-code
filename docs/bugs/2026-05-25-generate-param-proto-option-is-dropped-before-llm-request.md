# `generate --param` Drops a `__proto__` Option Before the LLM Request

## Summary

The public `poe-code generate` CLI accepts a repeated `--param key=value` option but silently drops a parameter named `__proto__` before invoking the LLM client. Its exported parameter parser stores user-selected keys into an ordinary object by bracket assignment.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import { setGlobalClient } from "../../services/client-instance.js";
import type { FileSystem } from "../utils/file-system.js";
import type { LlmClient } from "../services/llm-client.js";

it("drops an explicitly provided __proto__ model parameter", async () => {
  const volume = new Volume();
  volume.mkdirSync("/repo", { recursive: true });
  volume.mkdirSync("/home/test", { recursive: true });
  const program = createProgram({
    fs: createFsFromVolume(volume).promises as unknown as FileSystem,
    prompts: vi.fn(),
    env: { cwd: "/repo", homeDir: "/home/test", variables: {} },
    logger: () => {},
    suppressCommanderOutput: true
  });
  const client: LlmClient = {
    text: vi.fn(async () => ({ content: "ok" })),
    media: vi.fn(async () => ({}))
  };
  setGlobalClient(client);

  await program.parseAsync(["node", "cli", "generate", "text", "--param", "__proto__=visible", "Explain AI"]);

  const params = (client.text as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].params;
  expect(params).toEqual({});
  expect(Object.hasOwn(params, "__proto__")).toBe(false);
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the valid CLI invocation reaches the LLM client without the requested parameter. Remove the disposable probe after validation.

## Observed Behavior

Running `generate text --param __proto__=visible "Explain AI"` invokes `client.text()` with `params` equal to `{}` and without an own `__proto__` property. `src/cli/commands/generate.ts` routes all generate variants through `parseParams()`, whose `result = {}` object receives each CLI-controlled name through `result[key] = value` before the resulting `params` object is sent to `client.text()` or `client.media()`.

## Expected Behavior

The generate CLI should preserve every accepted model parameter, including a name such as `__proto__`, or fail validation explicitly if a parameter name is unsupported by the provider/request layer.

## Impact

Generation requests can silently differ from the options the user provided. Parameters used to configure a model invocation may vanish without any CLI error, causing incorrect output or misleading troubleshooting when the remote model never receives the specified option.
