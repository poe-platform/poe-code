import process from "node:process";
import { osascriptProvider } from "@poe-code/agent-human-in-loop";
import type { HumanInLoopProvider } from "@poe-code/agent-human-in-loop";
import { UserError } from "../user-error.js";

function noProviderConfigured(): HumanInLoopProvider {
  return {
    id: "noProviderConfigured",
    async requestApproval() {
      throw new UserError(
        "no human-in-loop provider configured for this platform — pass humanInLoop.provider to the runtime"
      );
    },
  };
}

function createDefaultProviderFactory(): () => HumanInLoopProvider {
  let provider: HumanInLoopProvider | undefined;

  return () => {
    if (provider !== undefined) {
      return provider;
    }

    provider =
      process.platform === "darwin" ? osascriptProvider({ title: "Approval needed" }) : noProviderConfigured();

    return provider;
  };
}

const getDefaultProvider = createDefaultProviderFactory();

export function defaultProviderForPlatform(): HumanInLoopProvider {
  return getDefaultProvider();
}
