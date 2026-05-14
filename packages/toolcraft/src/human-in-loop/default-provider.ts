import process from "node:process";
import { osascriptProvider } from "@poe-code/agent-human-in-loop";
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { UserError } from "../user-error.js";

function noProviderConfigured(): HumanInLoopProvider {
  return {
    id: "noProviderConfigured",
    async requestApproval() {
      throw new UserError(
        "No human-in-loop provider is configured. Pass {humanInLoop: {provider: ...}} to runCLI / createMCPServer / createSDK, or run on macOS to use the default osascript provider."
      );
    }
  };
}

function createDefaultProviderFactory(): () => HumanInLoopProvider {
  let provider: HumanInLoopProvider | undefined;

  return () => {
    if (provider !== undefined) {
      return provider;
    }

    provider =
      process.platform === "darwin"
        ? osascriptProvider({ title: "Approval needed" })
        : noProviderConfigured();

    return provider;
  };
}

const getDefaultProvider = createDefaultProviderFactory();

export function defaultProviderForPlatform(): HumanInLoopProvider {
  return getDefaultProvider();
}
