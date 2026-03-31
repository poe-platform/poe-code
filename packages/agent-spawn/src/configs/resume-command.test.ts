import { describe, it, expect } from "bun:test";
import { codexSpawnConfig } from "./codex.js";
import { claudeCodeSpawnConfig } from "./claude-code.js";
import { openCodeSpawnConfig } from "./opencode.js";
import { kimiSpawnConfig } from "./kimi.js";

describe("resumeCommand", () => {
  const threadId = "thread_abc123";
  const cwd = "/projects/demo";

  it("codex returns resume subcommand with -C flag", () => {
    expect(codexSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "resume",
      "-C",
      cwd,
      threadId
    ]);
  });

  it("claude-code returns --resume flag with threadId", () => {
    expect(claudeCodeSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "--resume",
      threadId
    ]);
  });

  it("opencode returns positional cwd with --session flag", () => {
    expect(openCodeSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      cwd,
      "--session",
      threadId
    ]);
  });

  it("kimi returns --session and --work-dir flags", () => {
    expect(kimiSpawnConfig.resumeCommand!(threadId, cwd)).toEqual([
      "--session",
      threadId,
      "--work-dir",
      cwd
    ]);
  });
});
