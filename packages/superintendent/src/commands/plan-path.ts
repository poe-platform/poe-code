import { superintendentOperations, type SuperintendentCommandRuntime } from "../filesystem.js";
import { host } from "#superintendent-command-platform";
import { posixPath as path } from "@poe-code/safe-fs";
import { fsPromises } from "#superintendent-command-platform";
import { S, defineCommand } from "toolcraft/runtime";
import {
  planConfigScope,
  readMergedDocumentReadonly,
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveScope
} from "@poe-code/poe-code-config/workflow";

const defaultFs = {
  readFile: (p: string, encoding: "utf8") => fsPromises.readFile(p, encoding),
  writeFile: (p: string, content: string) => fsPromises.writeFile(p, content),
  mkdir: (p: string, options?: { recursive: boolean }) => fsPromises.mkdir(p, options).then(() => undefined) as Promise<void>,
  rename: (oldPath: string, newPath: string) => fsPromises.rename(oldPath, newPath),
  unlink: (p: string) => fsPromises.unlink(p),
  stat: (p: string) => fsPromises.stat(p).then((s) => ({ mode: s.mode })),
  lstat: (p: string) => fsPromises.lstat(p).then((s) => ({ isSymbolicLink: () => s.isSymbolicLink() })),
  readdir: (p: string) => fsPromises.readdir(p)
};

export function createPlanPathCommand(runtime?: SuperintendentCommandRuntime) {
  return defineCommand({
  name: "plan-path",
  description: "Print the directory where superintendent plan files should be placed.",
  params: S.Object({}),
  scope: ["cli", "sdk"],
  handler: async () => {
    const fs = runtime ? superintendentOperations(runtime.fs) : defaultFs;
    const cwd = runtime?.cwd ?? host.cwd();
    const homeDir = runtime?.homeDir ?? host.env.HOME ?? host.env.USERPROFILE ?? cwd;
    const env = runtime?.env ?? host.env;

    const configPath = resolveConfigPath(homeDir);
    const projectConfigPath = resolveProjectConfigPath(cwd);
    const document = await readMergedDocumentReadonly(fs, configPath, projectConfigPath);
    const planDirectory = resolveScope(planConfigScope.schema, document.plan, env).plan_directory;

    return { planDirectory: resolveAbsoluteDirectory(planDirectory, cwd, homeDir) };
  },
  render: {
    rich: (result) => {
      host.stdout.write(`${result.planDirectory}\n`);
    },
    markdown: (result) => result.planDirectory,
    json: (result) => result
  }
});
}

export const planPathCommand = createPlanPathCommand();

function resolveAbsoluteDirectory(dir: string, cwd: string, homeDir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(homeDir, dir.slice(2));
  }

  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}
