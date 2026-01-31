import { describe, it, expect, vi } from "vitest";
import { runMutations } from "./run-mutations.js";
import { configMutation } from "../mutations/config-mutation.js";
import { fileMutation } from "../mutations/file-mutation.js";
import { templateMutation } from "../mutations/template-mutation.js";
import { createMockFs } from "../testing/mock-fs.js";

describe("runMutations", () => {
  const homeDir = "/home/test";

  describe("configMutation.merge", () => {
    it("creates new JSON file", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [configMutation.merge({ target: "~/.config/settings.json", value: { key: "value" } })],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config/settings.json`]).toMatchInlineSnapshot(`
        "{
          "key": "value"
        }
        "
      `);
    });

    it("merges into existing JSON file", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"existing": true}'
      }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { new: "value" } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ existing: true, new: "value" });
    });

    it("deep merges nested objects", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"nested": {"a": 1}}'
      }, homeDir);

      await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { nested: { b: 2 } } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ nested: { a: 1, b: 2 } });
    });

    it("creates new TOML file", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [configMutation.merge({ target: "~/.config/settings.toml", value: { key: "value" } })],
        { fs, homeDir }
      );

      expect(fs.files[`${homeDir}/.config/settings.toml`]).toContain('key = "value"');
    });
  });

  describe("configMutation.prune", () => {
    it("removes keys matching shape", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"keep": true, "remove": true}'
      }, homeDir);

      await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ keep: true });
    });

    it("deletes file when result is empty", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"remove": true}'
      }, homeDir);

      await runMutations(
        [configMutation.prune({ target: "~/.config.json", shape: { remove: {} } })],
        { fs, homeDir }
      );

      expect(fs.exists("~/.config.json")).toBe(false);
    });

    it("respects onlyIf guard", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"owner": "other", "key": "value"}'
      }, homeDir);

      await runMutations(
        [
          configMutation.prune({
            target: "~/.config.json",
            shape: { key: {} },
            onlyIf: (doc) => doc.owner === "me"
          })
        ],
        { fs, homeDir }
      );

      // Should not have changed because owner !== "me"
      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ owner: "other", key: "value" });
    });

    it("prunes when onlyIf returns true", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"owner": "me", "key": "value"}'
      }, homeDir);

      await runMutations(
        [
          configMutation.prune({
            target: "~/.config.json",
            shape: { key: {} },
            onlyIf: (doc) => doc.owner === "me"
          })
        ],
        { fs, homeDir }
      );

      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ owner: "me" });
    });
  });

  describe("fileMutation.ensureDirectory", () => {
    it("creates directory if not exists", async () => {
      const fs = createMockFs({}, homeDir);

      const result = await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config/app" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(true);
      expect(fs.directories.has(`${homeDir}/.config/app`)).toBe(true);
    });

    it("reports no change if directory exists", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      const result = await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(false);
    });
  });

  describe("fileMutation.remove", () => {
    it("removes existing file", async () => {
      const fs = createMockFs({
        "~/.config.json": "{}"
      }, homeDir);

      const result = await runMutations(
        [fileMutation.remove({ target: "~/.config.json" })],
        { fs, homeDir }
      );

      expect(result.changed).toBe(true);
      expect(fs.exists("~/.config.json")).toBe(false);
    });

    it("respects whenEmpty option", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"content": true}'
      }, homeDir);

      await runMutations(
        [fileMutation.remove({ target: "~/.config.json", whenEmpty: true })],
        { fs, homeDir }
      );

      // File should still exist because it's not empty
      expect(fs.exists("~/.config.json")).toBe(true);
    });
  });

  describe("templateMutation.write", () => {
    it("writes rendered template", async () => {
      const fs = createMockFs({}, homeDir);
      await fs.mkdir(`${homeDir}/.config`, { recursive: true });

      await runMutations(
        [
          templateMutation.write({
            target: "~/.config/app.sh",
            templateId: "app.sh",
            context: { name: "myapp" }
          })
        ],
        {
          fs,
          homeDir,
          templates: async () => "#!/bin/bash\necho {{name}}"
        }
      );

      expect(fs.files[`${homeDir}/.config/app.sh`]).toBe("#!/bin/bash\necho myapp");
    });

    it("throws when templates loader not provided", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations(
          [templateMutation.write({ target: "~/.config/app.sh", templateId: "app.sh" })],
          { fs, homeDir }
        )
      ).rejects.toThrow("Template mutations require a templates loader");
    });
  });

  describe("observers", () => {
    it("calls onStart for each mutation", async () => {
      const fs = createMockFs({}, homeDir);
      const onStart = vi.fn();

      await runMutations(
        [
          fileMutation.ensureDirectory({ path: "~/.config" }),
          fileMutation.ensureDirectory({ path: "~/.local" })
        ],
        { fs, homeDir, observers: { onStart } }
      );

      expect(onStart).toHaveBeenCalledTimes(2);
    });

    it("calls onComplete with outcome", async () => {
      const fs = createMockFs({}, homeDir);
      const onComplete = vi.fn();

      await runMutations(
        [fileMutation.ensureDirectory({ path: "~/.config" })],
        { fs, homeDir, observers: { onComplete } }
      );

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "ensureDirectory" }),
        expect.objectContaining({ changed: true, effect: "mkdir" })
      );
    });

    it("calls onError when mutation fails", async () => {
      const fs = createMockFs({}, homeDir);
      const onError = vi.fn();

      await expect(
        runMutations(
          [configMutation.merge({ target: "/absolute/path.json", value: {} })],
          { fs, homeDir, observers: { onError } }
        )
      ).rejects.toThrow("home-relative");

      expect(onError).toHaveBeenCalled();
    });
  });

  describe("dryRun mode", () => {
    it("does not write files in dryRun mode", async () => {
      const fs = createMockFs({
        "~/.config.json": '{"old": true}'
      }, homeDir);

      const result = await runMutations(
        [configMutation.merge({ target: "~/.config.json", value: { new: true } })],
        { fs, homeDir, dryRun: true }
      );

      expect(result.changed).toBe(true);
      // But file should not have been modified
      const content = JSON.parse(fs.files[`${homeDir}/.config.json`]);
      expect(content).toEqual({ old: true });
    });
  });

  describe("path validation", () => {
    it("throws for non-home-relative paths", async () => {
      const fs = createMockFs({}, homeDir);

      await expect(
        runMutations(
          [configMutation.merge({ target: "/etc/config.json", value: {} })],
          { fs, homeDir }
        )
      ).rejects.toThrow("home-relative");
    });
  });
});
