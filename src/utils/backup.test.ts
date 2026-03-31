import { describe, it, expect, beforeEach } from "bun:test";
import path from "node:path";
import type { FileSystem } from "./file-system.js";
import { createBackup, restoreLatestBackup } from "./backup.js";
import { createMockFs } from "@poe-code/config-mutations/testing";

describe("backup utilities", () => {
  let fs: FileSystem;
  const root = "/home/user";
  const filePath = path.join(root, ".bashrc");

  beforeEach(async () => {
    fs = createMockFs({ [filePath]: "export FOO=bar" }, root);
  });

  it("creates timestamped backup when file exists", async () => {
    const backupPath = await createBackup(fs, filePath, () => "20240101T010101");

    expect(backupPath).toBe(`${filePath}.backup.20240101T010101`);
    const backupContent = await fs.readFile(backupPath!, "utf8");
    expect(backupContent).toBe("export FOO=bar");
  });

  it("skips backup when file is missing", async () => {
    await fs.unlink(filePath);

    const backupPath = await createBackup(fs, filePath, () => "20240101T010101");
    expect(backupPath).toBeNull();
  });

  it("restores most recent backup", async () => {
    await createBackup(fs, filePath, () => "20240101T010101");
    await fs.writeFile(filePath, "changed", { encoding: "utf8" });
    await createBackup(fs, filePath, () => "20240201T020202");
    await fs.writeFile(filePath, "changed again", { encoding: "utf8" });

    const restored = await restoreLatestBackup(fs, filePath);
    expect(restored).toBe(true);
    const content = await fs.readFile(filePath, "utf8");
    expect(content).toBe("changed");
  });

  it("returns false when no backups exist", async () => {
    await fs.unlink(filePath);
    const restored = await restoreLatestBackup(fs, filePath);
    expect(restored).toBe(false);
  });
});
