import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { agent } from "./agent.js";
import { openaiChatCompletionsPlugin } from "./plugins/poe-agent-plugin-openai-chat-completions.js";
import { openaiResponsesPlugin } from "./plugins/poe-agent-plugin-openai-responses.js";
const get = vi.hoisted(() => vi.fn(async () => "synthetic-host-key"));
vi.mock("auth-store", () => ({ createSecretStore: () => ({ store: { get } }) }));

it("requires an explicit key instead of reading host credential storage with a custom filesystem", async () => {
  vi.stubEnv("POE_API_KEY", "");
  try {
    for (const plugin of [openaiChatCompletionsPlugin(), openaiResponsesPlugin()]) {
      await expect(agent({ fs: createMemoryFileSystem() }).model("gpt-5").use(plugin).acp("hello")).rejects.toThrow("explicit apiKey");
    }
    expect(get).not.toHaveBeenCalled();
  } finally { vi.unstubAllEnvs(); }
});
