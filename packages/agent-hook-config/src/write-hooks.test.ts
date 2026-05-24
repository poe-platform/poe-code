import * as fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { writeCodexHooks } = await import("./index.js");

const targetPath = "/repo/.codex/hooks.json";

function generatedEntry(
  event: "SessionStart" | "Stop",
  command: string,
  matcher?: string,
  runId = "current"
) {
  return {
    event,
    matcher,
    handler: {
      type: "command" as const,
      command,
      statusMessage: `[generated:${runId}] ${command}`
    },
    generatedId: `generated-${command}`
  };
}

function writeHooks(hooks: unknown): void {
  vol.fromJSON({ [targetPath]: JSON.stringify(hooks) }, "/");
}

function readHooks(): unknown {
  return JSON.parse(vol.readFileSync(targetPath, "utf8") as string);
}

describe("writeCodexHooks", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("creates an absent target and writes generated hooks", () => {
    expect(writeCodexHooks(targetPath, [generatedEntry("Stop", "notify", "")], "current")).toEqual({
      path: targetPath,
      fileCreated: true,
      previousGeneratedRemoved: 0,
      generatedWritten: 1
    });

    expect(readHooks()).toEqual({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: "notify", statusMessage: "[generated:current] notify" }
            ]
          }
        ]
      }
    });
    expect(vol.readFileSync(targetPath, "utf8")).toMatch(/\n$/);
  });

  it("creates an absent target without inventing event keys for empty input", () => {
    expect(writeCodexHooks(targetPath, [], "current")).toEqual({
      path: targetPath,
      fileCreated: true,
      previousGeneratedRemoved: 0,
      generatedWritten: 0
    });

    expect(readHooks()).toEqual({ hooks: {} });
  });

  it("preserves user entries and merges matching or new matcher groups", () => {
    const userHandler = { type: "command", command: "user" };
    writeHooks({
      hooks: { Stop: [{ matcher: "", hooks: [userHandler] }] }
    });

    writeCodexHooks(
      targetPath,
      [generatedEntry("Stop", "same", ""), generatedEntry("Stop", "other", "Bash")],
      "current"
    );

    expect(readHooks()).toEqual({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              userHandler,
              { type: "command", command: "same", statusMessage: "[generated:current] same" }
            ]
          },
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "other", statusMessage: "[generated:current] other" }
            ]
          }
        ]
      }
    });
  });

  it("adds the hooks map when an existing JSON target omits it", () => {
    writeHooks({ version: 1 });

    expect(
      writeCodexHooks(targetPath, [generatedEntry("Stop", "new")], "current").fileCreated
    ).toBe(false);
    expect(readHooks()).toEqual({
      version: 1,
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: "new", statusMessage: "[generated:current] new" }]
          }
        ]
      }
    });
  });

  it("removes stale generated handlers from prior runs before writing", () => {
    writeHooks({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: "old-one", statusMessage: "[generated:old] first" },
              { type: "command", command: "old-two", statusMessage: "[generated:crashed] second" }
            ]
          }
        ]
      }
    });

    const result = writeCodexHooks(targetPath, [generatedEntry("Stop", "new", "")], "current");

    expect(result.previousGeneratedRemoved).toBe(2);
    expect(readHooks()).toEqual({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "new", statusMessage: "[generated:current] new" }]
          }
        ]
      }
    });
  });

  it("preserves user handler order while stripping stale handlers in the same group", () => {
    writeHooks({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              { type: "command", command: "first-user" },
              { type: "command", command: "stale", statusMessage: "[generated:old] remove" },
              { type: "command", command: "second-user" }
            ]
          }
        ]
      }
    });

    writeCodexHooks(targetPath, [generatedEntry("Stop", "new", "")], "current");

    expect((readHooks() as any).hooks.Stop[0].hooks.map((hook: any) => hook.command)).toEqual([
      "first-user",
      "second-user",
      "new"
    ]);
  });

  it("does not collapse missing and empty matchers", () => {
    writeCodexHooks(
      targetPath,
      [generatedEntry("Stop", "missing"), generatedEntry("Stop", "empty", "")],
      "current"
    );

    expect((readHooks() as any).hooks.Stop).toEqual([
      {
        hooks: [
          { type: "command", command: "missing", statusMessage: "[generated:current] missing" }
        ]
      },
      {
        matcher: "",
        hooks: [{ type: "command", command: "empty", statusMessage: "[generated:current] empty" }]
      }
    ]);
  });

  it("rejects unmarked generated entries by naming the offending entry", () => {
    const entry = generatedEntry("Stop", "unsafe", "");
    entry.handler.statusMessage = "unsafe";

    expect(() => writeCodexHooks(targetPath, [entry], "current")).toThrow(
      /generated-unsafe.*statusMessage.*\[generated:/
    );
    expect(vol.existsSync(targetPath)).toBe(false);
  });

  it("reports malformed JSON without modifying the target", () => {
    vol.fromJSON({ [targetPath]: "{ broken" }, "/");

    expect(() => writeCodexHooks(targetPath, [generatedEntry("Stop", "new")], "current")).toThrow(
      `Malformed JSON in ${targetPath}`
    );
    expect(vol.readFileSync(targetPath, "utf8")).toBe("{ broken");
  });

  it("reports malformed JSON before rejecting an unmarked incoming entry", () => {
    const entry = generatedEntry("Stop", "unsafe");
    entry.handler.statusMessage = "unsafe";
    vol.fromJSON({ [targetPath]: "{ broken" }, "/");

    expect(() => writeCodexHooks(targetPath, [entry], "current")).toThrow(
      `Malformed JSON in ${targetPath}`
    );
    expect(vol.readFileSync(targetPath, "utf8")).toBe("{ broken");
  });

  it("leaves the original target intact when the atomic rename fails", () => {
    writeHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] } });
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(() => writeCodexHooks(targetPath, [generatedEntry("Stop", "new")], "current")).toThrow(
      "rename failed"
    );
    expect(readHooks()).toEqual({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "user" }] }] }
    });
  });

  it("cleans stale handlers with empty input while preserving existing empty event arrays", () => {
    writeHooks({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "old", statusMessage: "[generated:old] old" }] }
        ],
        SessionStart: []
      }
    });

    expect(writeCodexHooks(targetPath, [], "current")).toMatchObject({
      previousGeneratedRemoved: 1,
      generatedWritten: 0
    });
    expect(readHooks()).toEqual({ hooks: { Stop: [], SessionStart: [] } });
  });
});
