# Poe agent mcp servers proto input is silently dropped before spawn

## Summary

The standalone `poe-agent` CLI accepts a syntactically valid `--mcp-servers` JSON object containing a server named `__proto__`, but silently removes that server before launching the agent. When that is the only supplied MCP server, the downstream spawn call receives `mcpServers: undefined` even though the command-line input declared a valid server configuration.

## Reproduction

From the repository root, add a disposable probe at `src/cli/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPoeAgentProgram, normalizePoeAgentArgv } from "./poe-agent-main.js";

const spawnPoeAgentWithAcpMock = vi.hoisted(() =>
  vi.fn(() => ({
    events: (async function* () {})(),
    done: Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
  }))
);

vi.mock("../providers/poe-agent.js", () => ({
  spawnPoeAgentWithAcp: spawnPoeAgentWithAcpMock,
}));

vi.mock("@poe-code/agent-spawn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/agent-spawn")>();
  return { ...actual, renderAcpStream: vi.fn() };
});

describe("poe-agent special MCP server input", () => {
  it("drops an explicitly supplied __proto__ server before spawning", async () => {
    const program = createPoeAgentProgram();
    program.exitOverride();

    await program.parseAsync(normalizePoeAgentArgv([
      "node",
      "poe-agent",
      "--mcp-servers",
      '{"__proto__":{"command":"custom-server"}}',
      "Test prompt"
    ]));

    expect(spawnPoeAgentWithAcpMock).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServers: undefined })
    );
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/cli/__probe__.test.ts > poe-agent special MCP server input > drops an explicitly supplied __proto__ server before spawning
```

Remove the disposable probe after running it.

## Observed Behavior

Running the CLI parser with `--mcp-servers '{"__proto__":{"command":"custom-server"}}'` successfully proceeds to agent startup, but the captured call to `spawnPoeAgentWithAcp()` contains `mcpServers: undefined`. In `src/cli/poe-agent-main.ts`, `parseMcpSpawnConfig()` constructs `servers` as `{}` and copies every parsed dynamic name with `servers[name] = ...`; for `__proto__`, assignment changes the map's prototype rather than creating an own server entry. The subsequent `Object.keys(servers).length > 0` check observes no own entries and returns `undefined`.

## Expected Behavior

An explicitly supplied MCP server should either be preserved as an own server configuration entry passed to the spawn implementation, or rejected with a clear validation error if its name is unsupported. Valid JSON input must not be accepted and silently discarded because its key has JavaScript prototype semantics.

## Impact

Users can launch `poe-agent` believing a required MCP tool server was enabled while the agent actually runs without it. This produces confusing missing-tool failures and makes a valid-looking command-line configuration disappear without warning.
