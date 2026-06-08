import { describe, expect, it } from "vitest";
import type { TaskListFs } from "../types.js";
import { createFs } from "./test-helpers.js";
import { writeAtomically } from "./utils.js";

describe("backend utilities", () => {
  it("does not remove a colliding atomic write temp symlink", async () => {
    const { rawFs, volume } = createFs({
      "/outside.tmp": "outside-state\n"
    });
    let tempPath: string | undefined;
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (pathText.startsWith("/repo/tasks.yaml.") && pathText.endsWith(".tmp")) {
          tempPath = pathText;
          volume.symlinkSync("/outside.tmp", pathText);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        return rawFs.writeFile(filePath, data, options);
      }
    } as TaskListFs;

    await expect(writeAtomically(fs, "/repo/tasks.yaml", "new state\n")).rejects.toThrow();

    expect(tempPath).toBeDefined();
    expect(volume.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(tempPath as string).isSymbolicLink()).toBe(true);
    await expect(rawFs.readFile("/repo/tasks.yaml", "utf8")).rejects.toThrow();
  });
});
