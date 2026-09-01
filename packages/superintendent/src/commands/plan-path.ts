import path from "node:path";
import { readFile, writeFile, mkdir, rename, unlink, stat, lstat, readdir } from "node:fs/promises";
import { S, defineCommand } from "toolcraft";
import {
  planConfigScope,
  readMergedDocumentReadonly,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope
} from "@poe-code/poe-code-config/core";

const fs = {
  readFile: (p: string, encoding: "utf8") => readFile(p, encoding),
  writeFile: (p: string, content: string) => writeFile(p, content),
  mkdir: (p: string, options?: { recursive: boolean }) => mkdir(p, options).then(() => undefined) as Promise<void>,
  rename: (oldPath: string, newPath: string) => rename(oldPath, newPath),
  unlink: (p: string) => unlink(p),
  stat: (p: string) => stat(p).then((s) => ({ mode: s.mode })),
  lstat: (p: string) => lstat(p).then((s) => ({ isSymbolicLink: () => s.isSymbolicLink() })),
  readdir: (p: string) => readdir(p)
};

export const planPathCommand = defineCommand({
  name: "plan-path",
  description: "Print the directory where superintendent plan files should be placed.",
  params: S.Object({}),
  scope: ["cli", "sdk"],
  handler: async () => {
    const cwd = process.cwd();
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? cwd;

    const configPath = resolveConfigPath(homeDir);
    const projectConfigPath = resolveProjectConfigPath(cwd);
    const document = await readMergedDocumentReadonly(fs, configPath, projectConfigPath);
    const planDirectory = resolveScope(planConfigScope.schema, document.plan, process.env).plan_directory;

    return { planDirectory: resolveAbsoluteDirectory(planDirectory, cwd, homeDir) };
  },
  render: {
    rich: (result) => {
      process.stdout.write(`${result.planDirectory}\n`);
    },
    markdown: (result) => result.planDirectory,
    json: (result) => result
  }
});

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }

  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}
