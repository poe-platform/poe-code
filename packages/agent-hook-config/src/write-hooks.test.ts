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
      statusMessage: `[generated:poe-code:${runId}] ${command}`
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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
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
              { type: "command", command: "notify", statusMessage: "[generated:poe-code:current] notify" }
            ]
          }
        ]
      }
    });
    expect(vol.readFileSync(targetPath, "utf8")).toMatch(/\n$/);
  });

  it("does not create hooks when read errors have inherited missing-file codes", async () => {
    const readFile = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("hook read denied");
    });

    try {
      await withObjectPrototypeProperties({ code: "ENOENT" }, () => {
        expect(() =>
          writeCodexHooks(targetPath, [generatedEntry("Stop", "notify", "")], "current")
        ).toThrow("hook read denied");
      });
      expect(vol.existsSync(targetPath)).toBe(false);
    } finally {
      readFile.mockRestore();
    }
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
              { type: "command", command: "same", statusMessage: "[generated:poe-code:current] same" }
            ]
          },
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: "other", statusMessage: "[generated:poe-code:current] other" }
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
            hooks: [{ type: "command", command: "new", statusMessage: "[generated:poe-code:current] new" }]
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
              { type: "command", command: "old-one", statusMessage: "[generated:poe-code:old] first" },
              { type: "command", command: "old-two", statusMessage: "[generated:poe-code:crashed] second" }
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
            hooks: [{ type: "command", command: "new", statusMessage: "[generated:poe-code:current] new" }]
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
              { type: "command", command: "stale", statusMessage: "[generated:poe-code:old] remove" },
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
          { type: "command", command: "missing", statusMessage: "[generated:poe-code:current] missing" }
        ]
      },
      {
        matcher: "",
        hooks: [{ type: "command", command: "empty", statusMessage: "[generated:poe-code:current] empty" }]
      }
    ]);
  });

  it("rejects unmarked generated entries by naming the offending entry", () => {
    const entry = generatedEntry("Stop", "unsafe", "");
    entry.handler.statusMessage = "unsafe";

    expect(() => writeCodexHooks(targetPath, [entry], "current")).toThrow(
      /generated-unsafe.*statusMessage.*\[generated:poe-code:/
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

  it("reports null event groups as malformed configuration", () => {
    writeHooks({ hooks: { Stop: null } });

    expect(() => writeCodexHooks(targetPath, [], "current")).toThrow(`Malformed hooks in ${targetPath}`);
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

  it("preserves user handlers whose message resembles a generated marker", () => {
    writeHooks({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "user", statusMessage: "[generated:note] personal" }] }]
      }
    });

    writeCodexHooks(targetPath, [generatedEntry("Stop", "new")], "current");

    expect((readHooks() as any).hooks.Stop[0].hooks.map((hook: any) => hook.command)).toEqual([
      "user",
      "new"
    ]);
  });

  it("rejects non-finite hook timeouts", () => {
    const entry = generatedEntry("Stop", "notify") as any;
    entry.handler.timeout = Number.POSITIVE_INFINITY;

    expect(() => writeCodexHooks(targetPath, [entry], "current")).toThrow("finite timeout");
  });

  it("does not follow a pre-existing temporary symlink", () => {
    vol.fromJSON({ "/outside/hooks.json": "outside" }, "/");
    vol.mkdirSync("/repo/.codex", { recursive: true });
    vol.symlinkSync("/outside/hooks.json", `${targetPath}.tmp-current-0`);

    expect(() => writeCodexHooks(targetPath, [generatedEntry("Stop", "notify")], "current")).not.toThrow();
    expect(vol.readFileSync("/outside/hooks.json", "utf8")).toBe("outside");
  });

  it("removes a partially written temporary file when creation fails", () => {
    writeHooks({ hooks: {} });
    const temporaryPath = `${targetPath}.tmp-current-0`;
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      if (String(filePath) === temporaryPath) {
        originalWriteFileSync(filePath, "partial", options);
        throw new Error("hooks disk full");
      }

      return originalWriteFileSync(filePath, data, options);
    });

    expect(() => writeCodexHooks(targetPath, [generatedEntry("Stop", "notify")], "current")).toThrow(
      "hooks disk full"
    );
    expect(vol.existsSync(temporaryPath)).toBe(false);
    expect(readHooks()).toEqual({ hooks: {} });
  });

  it("cleans stale handlers with empty input while preserving existing empty event arrays", () => {
    writeHooks({
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "old", statusMessage: "[generated:poe-code:old] old" }] }
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
