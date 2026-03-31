import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { TerminalPilot } from "./terminal-pilot.js";
import { TerminalScreen } from "./terminal-screen.js";
import { TerminalSession } from "./terminal-session.js";

describe("terminal-pilot public entry point", () => {
  it("re-exports the public runtime API through the package entry point", () => {
    expect(api).toHaveProperty("TerminalPilot", TerminalPilot);
    expect(api).toHaveProperty("TerminalSession", TerminalSession);
    expect(api).toHaveProperty("TerminalScreen", TerminalScreen);
  });

  it("keeps type-only exports out of the runtime namespace", () => {
    expect(api).not.toHaveProperty("TerminalKey");
    expect(api).not.toHaveProperty("NewSessionOptions");
    expect(api).not.toHaveProperty("WaitForOptions");
    expect(api).not.toHaveProperty("HistoryOptions");
  });
});
