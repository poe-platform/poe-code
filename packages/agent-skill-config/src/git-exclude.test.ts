import * as fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

import { appendExcludeBlock, removeExcludeBlock, setGitDirRunnerForTest } from "./git-exclude.js";

const cwd = "/repo";
const gitDir = "/repo/.git";
const excludePath = path.join(gitDir, "info/exclude");

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

function stubGitRepo(): () => void {
  return setGitDirRunnerForTest(() => gitDir);
}

describe("git exclude blocks", () => {
  let restoreRunner: () => void;

  beforeEach(() => {
    restoreRunner?.();
    vol.reset();
    vol.mkdirSync(cwd, { recursive: true });
    restoreRunner = stubGitRepo();
  });

  afterEach(() => {
    restoreRunner?.();
  });

  it("appends to a fresh exclude file and preserves pre-existing content", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n.DS_Store\n");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# user ignore",
        ".DS_Store",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("creates the exclude file when it does not exist", () => {
    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("rejects multiline run identifiers", () => {
    expect(() => appendExcludeBlock(cwd, "run\nextra", [".poe-code/skills/run"])).toThrow("single line");
  });

  it("rejects multiline exclude entries", () => {
    expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/helper\nsecret.env"])).toThrow("single line");
  });

  it("uses an optional marker prefix for sibling bridge features", () => {
    appendExcludeBlock(cwd, "run-1", [".codex/hooks.json"], {
      markerPrefix: "custom-prefix"
    });

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      ["# custom-prefix:run-1 begin", ".codex/hooks.json", "# custom-prefix:run-1 end", ""].join(
        "\n"
      )
    );

    removeExcludeBlock(cwd, "run-1", { markerPrefix: "custom-prefix" });
    expect(vol.readFileSync(excludePath, "utf8")).toBe("");
  });

  it("keeps blocks with different marker prefixes independent", () => {
    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);
    appendExcludeBlock(cwd, "run-1", [".codex/hooks.json"], {
      markerPrefix: "custom-prefix"
    });

    removeExcludeBlock(cwd, "run-1", { markerPrefix: "custom-prefix" });

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );

    appendExcludeBlock(cwd, "run-1", [".codex/hooks.json"], {
      markerPrefix: "custom-prefix"
    });
    removeExcludeBlock(cwd, "run-1");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      ["# custom-prefix:run-1 begin", ".codex/hooks.json", "# custom-prefix:run-1 end", ""].join(
        "\n"
      )
    );
  });

  it("resolves relative git dirs from cwd", () => {
    restoreRunner();
    restoreRunner = setGitDirRunnerForTest(() => ".git");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("separates appended blocks from content without a final newline", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "node_modules/");

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "node_modules/",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );
  });

  it("appends when another run block is present so both coexist", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        ""
      ].join("\n")
    );

    appendExcludeBlock(cwd, "run-2", [".poe-code/skills/run-2"]);

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );
  });

  it("keeps duplicate caller run ids in independently removable blocks", () => {
    const firstId = appendExcludeBlock(cwd, "run-1", [".poe-code/skills/one"]);
    const secondId = appendExcludeBlock(cwd, "run-1", [".poe-code/skills/two"]);

    expect(firstId).toBe("run-1");
    expect(secondId).not.toBe(firstId);

    removeExcludeBlock(cwd, firstId!);

    expect(vol.readFileSync(excludePath, "utf8")).toContain(".poe-code/skills/two");
  });

  it("removes this run block while leaving other run blocks intact", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# user ignore",
        "# poe-code-spawn-skills:run-1 begin",
        ".poe-code/skills/run-1",
        "# poe-code-spawn-skills:run-1 end",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        "node_modules/",
        ""
      ].join("\n")
    );

    removeExcludeBlock(cwd, "run-1");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# user ignore",
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        "node_modules/",
        ""
      ].join("\n")
    );
  });

  it("is idempotent when removing an already removed block", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(
      excludePath,
      [
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );

    removeExcludeBlock(cwd, "run-1");
    removeExcludeBlock(cwd, "run-1");

    expect(vol.readFileSync(excludePath, "utf8")).toBe(
      [
        "# poe-code-spawn-skills:run-2 begin",
        ".poe-code/skills/run-2",
        "# poe-code-spawn-skills:run-2 end",
        ""
      ].join("\n")
    );
  });

  it("rejects a symlinked exclude file", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    vol.writeFileSync("/outside/exclude", "# outside\n");
    fs.symlinkSync("/outside/exclude", excludePath);

    expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow(
      /symbolic link/
    );
    expect(vol.readFileSync("/outside/exclude", "utf8")).toBe("# outside\n");
  });

  it("does not treat inherited lstat error codes as missing exclude paths", async () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    const originalLstatSync = fs.lstatSync.bind(fs);
    const lstat = vi.spyOn(fs, "lstatSync").mockImplementation((filePath, options) => {
      if (String(filePath) === excludePath) {
        throw new Error("exclude lstat denied");
      }

      return originalLstatSync(filePath, options);
    });

    try {
      await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
        expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow(
          "exclude lstat denied"
        );
      });
    } finally {
      lstat.mockRestore();
    }
  });

  it("does not follow or remove a colliding temporary exclude symlink", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.mkdirSync("/outside", { recursive: true });
    vol.writeFileSync("/outside/exclude.tmp", "outside-state\n");
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    let tempPath: string | undefined;
    const writeFile = vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      const targetPath = String(filePath);
      if (targetPath.includes(".poe-code-") && targetPath.endsWith(".tmp")) {
        tempPath = targetPath;
        fs.symlinkSync("/outside/exclude.tmp", targetPath);
      }

      return originalWriteFileSync(filePath, data, options);
    });

    try {
      expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow();
      expect(tempPath).toBeDefined();
      expect(vol.readFileSync("/outside/exclude.tmp", "utf8")).toBe("outside-state\n");
      expect(vol.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
      expect(vol.existsSync(excludePath)).toBe(false);
    } finally {
      writeFile.mockRestore();
    }
  });

  it("removes a partially written temporary exclude file after inherited existing-path errors", async () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n");
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    let tempPath: string | undefined;
    const writeFile = vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      const targetPath = String(filePath);
      if (targetPath.includes(".poe-code-") && targetPath.endsWith(".tmp")) {
        tempPath = targetPath;
        originalWriteFileSync(filePath, "# partial\n", options);
        throw new Error("exclude temp exists");
      }

      return originalWriteFileSync(filePath, data, options);
    });

    try {
      await withObjectPrototypeProperties({ code: "EEXIST" }, async () => {
        expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow(
          "exclude temp exists"
        );
      });
      expect(tempPath).toBeDefined();
      expect(vol.existsSync(tempPath as string)).toBe(false);
      expect(vol.readFileSync(excludePath, "utf8")).toBe("# user ignore\n");
    } finally {
      writeFile.mockRestore();
    }
  });

  it("preserves prior exclude content when atomic replacement fails", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n");
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow(
      "rename failed"
    );
    expect(vol.readFileSync(excludePath, "utf8")).toBe("# user ignore\n");

    rename.mockRestore();
  });

  it("removes a partially written temporary exclude file when creation fails", () => {
    vol.mkdirSync(path.dirname(excludePath), { recursive: true });
    vol.writeFileSync(excludePath, "# user ignore\n");
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    let tempPath: string | undefined;
    const writeFile = vi.spyOn(fs, "writeFileSync").mockImplementation((filePath, data, options) => {
      const targetPath = String(filePath);
      if (targetPath.includes(".poe-code-") && targetPath.endsWith(".tmp")) {
        tempPath = targetPath;
        originalWriteFileSync(filePath, "# partial\n", options);
        throw new Error("exclude disk full");
      }

      return originalWriteFileSync(filePath, data, options);
    });

    try {
      expect(() => appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"])).toThrow(
        "exclude disk full"
      );
      expect(tempPath).toBeDefined();
      expect(vol.existsSync(tempPath as string)).toBe(false);
      expect(vol.readFileSync(excludePath, "utf8")).toBe("# user ignore\n");
    } finally {
      writeFile.mockRestore();
    }
  });

  it("silently no-ops outside a git repo", () => {
    restoreRunner();
    restoreRunner = setGitDirRunnerForTest(() => undefined);

    appendExcludeBlock(cwd, "run-1", [".poe-code/skills/run-1"]);
    removeExcludeBlock(cwd, "run-1");

    expect(vol.existsSync(gitDir)).toBe(false);
  });
});
