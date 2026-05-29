import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import type { CliContainer } from "../container.js";
import type { LlmClient } from "../../services/llm-client.js";

const client = vi.hoisted<LlmClient>(() => ({
  text: vi.fn(async () => ({ content: "generated" })),
  media: vi.fn(async () => ({}))
}));
const initializeClient = vi.hoisted(() => vi.fn(async () => undefined));
const getGlobalClient = vi.hoisted(() => vi.fn());

vi.mock("../../services/client-instance.js", () => ({
  getGlobalClient,
  initializeClient
}));

vi.mock("@poe-code/design-system", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  withSpinner: vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) => await fn())
}));

const { registerGenerateCommand } = await import("./generate.js");

describe("generate command authentication", () => {
  beforeEach(() => {
    initializeClient.mockClear();
    getGlobalClient.mockReset()
      .mockImplementationOnce(() => { throw new Error("not initialized"); })
      .mockReturnValue(client);
    vi.mocked(client.text).mockClear();
  });

  it("uses POE_API_KEY when no stored credential exists", async () => {
    const program = new Command();
    program.name("poe-code").option("--dry-run").option("--yes");
    const container = {
      env: {
        cwd: "/repo",
        poeApiBaseUrl: "https://api.poe.com/v1",
        variables: { POE_API_KEY: "environment-key" },
        getVariable: vi.fn((name: string) => name === "POE_API_KEY" ? "environment-key" : undefined)
      },
      fs: {},
      loggerFactory: {
        create: vi.fn(() => ({ dryRun: vi.fn() }))
      },
      commandRunner: vi.fn(),
      contextFactory: {
        create: vi.fn(() => ({}))
      },
      readApiKey: vi.fn(async () => null)
    } as unknown as CliContainer;
    registerGenerateCommand(program, container);

    await program.parseAsync(["node", "cli", "generate", "text", "--model", "test/model", "Hello"]);

    expect(initializeClient).toHaveBeenCalledWith({
      apiKey: "environment-key",
      baseUrl: "https://api.poe.com/v1",
      httpClient: undefined
    });
    expect(client.text).toHaveBeenCalledWith({
      model: "test/model",
      prompt: "Hello",
      params: {}
    });
  });
});
