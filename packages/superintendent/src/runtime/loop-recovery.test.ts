import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { runLoop, type LoopRunners, type SuperintendentFileSystem } from "./loop.js";

const docPath = "/repo/docs/plans/feature.md";
const original = `---
kind: superintendent
version: 1
builder:
  agent: claude-code
  prompt: Build
inspectors:
  quality:
    agent: claude-code
    prompt: Inspect
superintendent:
  agent: claude-code
  prompt: Review {{inspectors.quality}}
owner:
  agent: claude-code
  prompt: Approve
status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Plan

## Task Board

- [ ] Task 1
`;

function createFixture() {
  const rawFs = createFsFromVolume(Volume.fromJSON({ [docPath]: original })).promises;
  const fs = rawFs as unknown as SuperintendentFileSystem;
  const runners: LoopRunners = {
    builder: vi.fn().mockResolvedValue({ summary: "Built", log: "Built" }),
    inspector: vi.fn().mockResolvedValue({ name: "quality", summary: "Inspected" }),
    superintendent: vi.fn().mockResolvedValue({
      summary: "Reviewed",
      transition: { action: "request_review" }
    }),
    ownerReview: vi.fn().mockResolvedValue({ transition: { action: "approve_completion" } })
  };
  const run = () => runLoop({ docPath, cwd: "/repo", homeDir: "/home/test", fs, runners });
  const recoveryFiles = async () =>
    (await rawFs.readdir(path.dirname(docPath)))
      .map(String)
      .filter((name) => name.startsWith("feature.md.recovery-") && name.endsWith(".bak"));
  return { rawFs, fs, runners, run, recoveryFiles };
}

describe("failed-role document recovery", () => {
  it.each(["builder", "inspector", "superintendent", "ownerReview"] as const)(
    "preserves independent edits during a failed %s and saves the pre-role snapshot",
    async (role) => {
      const { rawFs, runners, run, recoveryFiles } = createFixture();
      let notifyStarted!: () => void;
      let failRole!: (error: Error) => void;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const pendingRole = new Promise<never>((_resolve, reject) => {
        failRole = reject;
      });
      let snapshot = original;
      vi.mocked(runners[role]).mockImplementationOnce(async () => {
        if (role !== "builder") snapshot = String(await rawFs.readFile(docPath, "utf8"));
        notifyStarted();
        return pendingRole;
      });

      const result = run().catch((error: unknown) => error);
      await started;
      const edited = `${await rawFs.readFile(docPath, "utf8")}\nUser requirement: keep offline support.\n`;
      await rawFs.writeFile(docPath, edited);
      const failure = new Error(`${role} failed`);
      failRole(failure);

      const error = await result;
      expect(String(await rawFs.readFile(docPath, "utf8"))).toBe(edited);
      const backups = await recoveryFiles();
      expect(backups).toHaveLength(1);
      const backupPath = path.join(path.dirname(docPath), backups[0]!);
      expect(String(await rawFs.readFile(backupPath, "utf8"))).toBe(snapshot);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(failure.message);
      expect((error as Error).message).toContain(backupPath);
      expect((error as Error).cause).toBe(failure);
    }
  );

  it("preserves malformed live edits without parsing or replacing them", async () => {
    const { rawFs, runners, run, recoveryFiles } = createFixture();
    const edited = "---\nunfinished: [\nUser's unsaved draft\n";
    vi.mocked(runners.builder).mockImplementationOnce(async () => {
      await rawFs.writeFile(docPath, edited);
      throw new Error("builder failed");
    });

    await expect(run()).rejects.toThrow("builder failed");
    expect(String(await rawFs.readFile(docPath, "utf8"))).toBe(edited);
    expect(await recoveryFiles()).toHaveLength(1);
  });

  it("does not resurrect a document removed while the role runs", async () => {
    const { rawFs, runners, run, recoveryFiles } = createFixture();
    vi.mocked(runners.builder).mockImplementationOnce(async () => {
      await rawFs.unlink(docPath);
      throw new Error("builder failed");
    });

    await expect(run()).rejects.toThrow("builder failed");
    await expect(rawFs.readFile(docPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await recoveryFiles()).toHaveLength(1);
  });

  it("retains live edits and both errors if the snapshot cannot be saved", async () => {
    const { rawFs, fs, runners, run } = createFixture();
    let edited = "";
    const failure = new Error("builder failed");
    vi.mocked(runners.builder).mockImplementationOnce(async () => {
      edited = `${await rawFs.readFile(docPath, "utf8")}\nUser requirement\n`;
      await rawFs.writeFile(docPath, edited);
      fs.writeFile = vi.fn().mockRejectedValue(new Error("disk full"));
      throw failure;
    });

    const error = await run().catch((error: unknown) => error);
    expect(String(await rawFs.readFile(docPath, "utf8"))).toBe(edited);
    expect((error as Error).message).toContain("builder failed");
    expect((error as Error).message).toContain("disk full");
    expect((error as Error).cause).toBe(failure);
  });

  it("does not create recovery files for successful roles", async () => {
    const { run, recoveryFiles } = createFixture();
    await expect(run()).resolves.toMatchObject({ state: "completed" });
    expect(await recoveryFiles()).toEqual([]);
  });

  it("keeps separate snapshots across repeated failures", async () => {
    const { rawFs, runners, run, recoveryFiles } = createFixture();
    vi.mocked(runners.builder).mockRejectedValue(new Error("builder failed"));
    await expect(run()).rejects.toThrow("builder failed");
    const firstBackup = (await recoveryFiles())[0]!;
    const edited = `${await rawFs.readFile(docPath, "utf8")}\nUser requirement\n`;
    await rawFs.writeFile(docPath, edited);

    await expect(run()).rejects.toThrow("builder failed");
    const backups = await recoveryFiles();
    expect(backups).toHaveLength(2);
    expect(
      String(await rawFs.readFile(path.join(path.dirname(docPath), firstBackup), "utf8"))
    ).toBe(original);
    const secondBackup = backups.find((name) => name !== firstBackup)!;
    expect(
      String(await rawFs.readFile(path.join(path.dirname(docPath), secondBackup), "utf8"))
    ).toBe(edited);
  });

  it("does not overwrite edits made while the recovery snapshot is being saved", async () => {
    const { rawFs, fs, runners, run } = createFixture();
    const writeFile = fs.writeFile.bind(fs);
    let edited = "";
    fs.writeFile = async (filePath, content, options) => {
      if (filePath.includes(".recovery-")) {
        edited = `${await rawFs.readFile(docPath, "utf8")}\nLate user requirement\n`;
        await writeFile(docPath, edited, { encoding: "utf8" });
      }
      await writeFile(filePath, content, options);
    };
    vi.mocked(runners.builder).mockRejectedValue(new Error("builder failed"));

    await expect(run()).rejects.toThrow("builder failed");
    expect(edited).toContain("Late user requirement");
    expect(String(await rawFs.readFile(docPath, "utf8"))).toBe(edited);
  });
});
