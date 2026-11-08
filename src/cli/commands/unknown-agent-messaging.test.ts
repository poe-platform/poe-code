import { describe, it, expect, vi } from "vitest";
import { createCliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { executeConfigure } from "./configure.js";
import { executeUnconfigure } from "./unconfigure.js";
import { executeInstall } from "./install.js";
import { executeTest } from "./test.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createContainer() {
  return createCliContainer({
    fs: createHomeFs(homeDir),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir, variables: {} },
    logger: () => {}
  });
}

async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the command to reject");
}

/**
 * Every command that takes an agent argument must reject a bad value the same
 * way: a user-facing ValidationError (no "See logs" noise), the word "agent",
 * the allow-list for that command, and a did-you-mean when one is close.
 */
describe("unknown agent messaging is shared across agent commands", () => {
  // unconfigure reports the "configure" capability: it is the same provider set,
  // so the matrix does not carry a separate flag for it.
  const cases = [
    { command: "configure", capability: "configure", run: (agent: string) => executeConfigure(createTestProgram(), createContainer(), agent, {}) },
    { command: "unconfigure", capability: "configure", run: (agent: string) => executeUnconfigure(createTestProgram(), createContainer(), agent, {}) },
    { command: "install", capability: "install", run: (agent: string) => executeInstall(createTestProgram(), createContainer(), agent) },
    { command: "test", capability: "test", run: (agent: string) => executeTest(createTestProgram(), createContainer(), agent) }
  ] as const;

  for (const { command, capability, run } of cases) {
    it(`${command} rejects an unknown agent with an allow-list and suggestion`, async () => {
      const error = await captureError(() => run("claude-cod"));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('Unknown agent "claude-cod".');
      expect(error.message).toContain("Did you mean: claude-code?");
      expect(error.message).toContain(`Agents supporting ${capability}:`);
    });

    it(`${command} tells the user pi is spawn-only instead of unknown`, async () => {
      const error = await captureError(() => run("pi"));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(`Agent "pi" does not support ${capability}.`);
      expect(error.message).toContain("pi supports: spawn.");
      expect(error.message).not.toContain("Unknown agent");
    });
  }
});
