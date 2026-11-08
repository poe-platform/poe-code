import { expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { posix } from "node:path";
vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual, default: actual.win32 };
});
import { runMutations, fileMutation, templateMutation } from "../dist/execution.js";

it("uses supplied namespace paths for native directory and template mutations", async () => {
  const fs = createFsFromVolume(Volume.fromJSON({ "/workspace/sentinel": "original" })).promises;
  await runMutations([
    fileMutation.ensureDirectory({ path: "~/skills" }),
    templateMutation.write({ target: "~/skills/SKILL.md", templateId: "skill" })
  ], { fs, homeDir: "/workspace", paths: posix, templates: async () => "# Virtual skill" });
  expect(await fs.readFile("/workspace/skills/SKILL.md", "utf8")).toBe("# Virtual skill");
  expect(await fs.readFile("/workspace/sentinel", "utf8")).toBe("original");
});
