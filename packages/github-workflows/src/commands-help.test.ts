import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCLI } from "toolcraft/cli";
import { ghGroup } from "./commands.js";

const originalArgv = process.argv;
const written: string[] = [];

async function renderHelp(...args: string[]): Promise<string> {
  process.argv = ["node", "poe-code", "github-workflows", ...args, "--help"];
  await runCLI([ghGroup], {
    rootUsageName: "poe-code",
    rootDisplayName: "Poe"
  });
  return written.join("");
}

beforeEach(() => {
  written.length = 0;
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

describe("github-workflows help", () => {
  it("documents --dry-run on install so the write default is unambiguous", async () => {
    const help = await renderHelp("install");

    expect(help).toContain("--dry-run");
    expect(help).toContain("Preview workflow installation without writing files");
  });

  it("keeps documenting the install options it already had", async () => {
    const help = await renderHelp("install");

    expect(help).toContain("--eject");
    expect(help).toContain("[name]");
  });
});
