import * as native from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const reportNames = ["gnu9.7-darwin", "apple-bsd", "gnu-errors", "native-profile-differences", "edge", "stress", "dangling-native"] as const;
type ReportName = typeof reportNames[number];

async function temporaryRoot(): Promise<string> {
  const root = await native.realpath(fileURLToPath(new URL("../../../", import.meta.url)));
  const temporary = await native.realpath(tmpdir());
  const path = relative(root, temporary);
  if (path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))) {
    throw new Error("Split native temp root must be outside the repository");
  }
  return temporary;
}

export async function createNativeScratch(context: Pick<TestContext, "after" | "diagnostic">): Promise<string> {
  const directory = await native.mkdtemp(join(await temporaryRoot(), "virtual-bash-split-native-"));
  context.after(async () => {
    try { await native.lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    context.diagnostic(`split native scratch retained: ${directory}`);
  });
  return directory;
}

export async function createNativeCapture(name: ReportName) {
  if (!reportNames.includes(name)) throw new Error("Unknown split native report name");
  const directory = await native.mkdtemp(join(await temporaryRoot(), "virtual-bash-split-capture-"));
  const identity = await native.lstat(directory);
  const path = join(directory, `${name}.json`);
  return {
    directory,
    path,
    async write(report: unknown): Promise<string> {
      const current = await native.lstat(directory);
      if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino || await native.realpath(directory) !== directory) {
        throw new Error("Split native capture directory identity changed or is a symlink");
      }
      await native.writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      return path;
    },
  };
}

export async function captureNativeReport(context: Pick<TestContext, "diagnostic">, name: ReportName, report: unknown, failed = false): Promise<string | undefined> {
  const setting = process.env.VIRTUAL_BASH_SPLIT_CAPTURE;
  if (setting === undefined) {
    if (failed) context.diagnostic(`split native failure ${name} (base64): ${Buffer.from(JSON.stringify(report)).toString("base64")}`);
    return undefined;
  }
  if (setting !== "1") throw new Error("VIRTUAL_BASH_SPLIT_CAPTURE accepts only 1, not a destination; output is always new OS temp");
  const capture = await createNativeCapture(name);
  const path = await capture.write(report);
  context.diagnostic(`split native capture: ${path}`);
  return path;
}
