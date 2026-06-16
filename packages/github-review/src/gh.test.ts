import { describe, expect, it } from "vitest";
import { ghPrDiff, ghPrView } from "./gh.js";

describe("GitHub CLI wrappers", () => {
  it("passes canonical PR URLs to gh commands after validation", () => {
    const calls: { command: string; args: string[] }[] = [];
    const prUrl = "  https://github.com/Acme/Widgets/pull/123  ";
    const runner = (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: command === "gh" && args[1] === "view" ? JSON.stringify({ number: 123 }) : "diff",
        stderr: "",
      };
    };

    expect(ghPrDiff(prUrl, { runner })).toBe("diff");
    expect(ghPrView(prUrl, ["number"], { runner })).toEqual({
      number: 123,
      url: "https://github.com/Acme/Widgets/pull/123",
    });
    expect(calls).toEqual([
      { command: "gh", args: ["pr", "diff", "https://github.com/Acme/Widgets/pull/123"] },
      {
        command: "gh",
        args: ["pr", "view", "https://github.com/Acme/Widgets/pull/123", "--json", "number"],
      },
    ]);
  });
});
