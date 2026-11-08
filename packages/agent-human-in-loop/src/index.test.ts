import { describe, expect, it } from "vitest";

import * as api from "./index.js";
import { mockProvider } from "./providers/mock.js";
import { osascriptProvider } from "./providers/osascript.js";
import { requestApproval } from "./request-approval.js";
import type {
  ApprovalRequest,
  ApprovalResult,
  HumanInLoopProvider,
  OsascriptProviderOptions,
} from "./index.js";

describe("@poe-code/agent-human-in-loop public surface", () => {
  it("exports the package type surface", async () => {
    const request: ApprovalRequest = { message: "continue?" };
    const providerOptions: OsascriptProviderOptions = {
      title: "Claude",
      binary: "osascript",
    };
    const provider: HumanInLoopProvider = mockProvider({ outcome: "approved" });
    const result: ApprovalResult = await requestApproval({
      ...request,
      provider,
    });

    expect(result).toEqual({ outcome: "approved" });
    expect(providerOptions).toEqual({
      title: "Claude",
      binary: "osascript",
    });
  });

  it("exposes only the runtime entrypoints", () => {
    expect(api).not.toHaveProperty("ApprovalRequest");
    expect(api).not.toHaveProperty("ApprovalResult");
    expect(api).not.toHaveProperty("HumanInLoopProvider");
    expect(api).not.toHaveProperty("OsascriptProviderOptions");
    expect(api.requestApproval).toBe(requestApproval);
    expect(api.osascriptProvider).toBe(osascriptProvider);
    expect(api.mockProvider).toBe(mockProvider);
    expect(Object.keys(api)).toEqual([
      "requestApproval",
      "osascriptProvider",
      "mockProvider",
    ]);
  });
});
