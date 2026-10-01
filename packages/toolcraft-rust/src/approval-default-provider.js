import process from "node:process";
import { createRequire } from "node:module";
import { osascriptProvider } from "@poe-code/agent-human-in-loop-rust";
import { UserError } from "./index.js";
import { callNative, protect } from "./host-errors.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let provider;
const operations = {
  platform: () => process.platform,
  osascript: () => osascriptProvider({ title: "Approval needed" }),
  noProvider: () => ({
    id: "noProviderConfigured",
    async requestApproval() {
      throw new UserError("No human-in-loop provider is configured. Pass {humanInLoop: {provider: ...}} to runCLI / createMCPServer / createSDK, or run on macOS to use the default osascript provider.");
    }
  })
};
const host = { operate: protect((name, args) => operations[name](...args)) };

export function defaultProviderForPlatform() {
  provider = callNative(native.approvalCommandsPolicy, "defaultProvider", [provider], host);
  return provider;
}
