import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codeReviewGroup, readCodeReviewDraftCommand } from "./cli.js";

const BIN_PATH = resolve(import.meta.dirname, "bin.ts");

describe("code-review command group", () => {
  it("exposes the root command surface", () => {
    expect(codeReviewGroup.children.map(({ name }) => name).sort()).toEqual([
      "agent-mcp",
      "commit",
      "drafts",
      "ingest",
      "install",
      "profiles",
      "run"
    ]);
  });

  it("reports a missing requested draft instead of a successful empty result", async () => {
    await expect(
      readCodeReviewDraftCommand.handler({
        params: {
          prUrl: "https://github.com/acme/repo/pull/404",
          cwd: "/repo"
        }
      } as never)
    ).rejects.toThrow("No active code review draft found");
  });

  it("uses a Node-compatible standalone binary entrypoint", () => {
    expect(readFileSync(BIN_PATH, "utf8").split("\n", 1)[0]).toBe("#!/usr/bin/env node");
  });

  it("renders ingest help from the standalone binary", () => {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", BIN_PATH, "ingest", "--help"],
      { encoding: "utf8" }
    );

    expect(output).toContain("ingest");
    expect(output).toContain("--repo");
  });
});
