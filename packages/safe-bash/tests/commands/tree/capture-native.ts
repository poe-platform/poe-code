import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir, platform, arch, release } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exactCases, semanticCases, divergentCases } from "./native-cases.js";
import { fixtureDirectories, fixtureFiles, fixtureLinks } from "./helpers.js";

export async function capture(binary: string) {
  const executable = resolve(binary);
  const sha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
  const root = await mkdtemp(join(tmpdir(), "safe-bash-tree-native-"));
  const env = { LC_ALL: "C", TZ: "UTC", HOME: root };
  try {
    for (const directory of fixtureDirectories) await mkdir(join(root, directory));
    for (const file of fixtureFiles) await writeFile(join(root, file), "");
    for (const [name, target] of fixtureLinks) await symlink(target, join(root, name));
    const invoke = (args: readonly string[]) => {
      const result = spawnSync(executable, ["--charset=ASCII", ...args], { cwd: root, env, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
      if (result.error || result.signal || result.status === null) throw result.error ?? new Error(`native failed: ${result.signal}`);
      return { args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    return { provenance: { version: invoke(["--version"]).stdout.trim(), binarySha256: sha256,
      platform: `${platform()} ${arch()} ${release()}`, locale: "LC_ALL=C", charset: "ASCII (unless explicit UTF-8)",
      source: "https://gitlab.com/OldManProgrammer/unix-tree/-/archive/2.2.1/unix-tree-2.2.1.tar.bz2",
      archiveSha256: "e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5",
      build: "make CC=cc CFLAGS='-O2 -std=c11 -Wall -Wextra' LDFLAGS= tree; Apple clang 21.0.0; no source modifications",
      captured: new Date().toISOString() }, exact: exactCases.map(invoke), semantic: semanticCases.map(invoke), divergent: divergentCases.map(invoke) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const binary = process.argv[2];
  if (!binary) throw new Error("Usage: capture-native.ts /absolute/path/to/pinned/tree");
  process.stdout.write(JSON.stringify(await capture(binary), null, 2) + "\n");
}
