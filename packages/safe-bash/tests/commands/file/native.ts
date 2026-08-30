import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fixtures } from "./fixtures.js";

export async function captureNative() {
  const root = await mkdtemp(fileURLToPath(new URL(".native-", import.meta.url)));
  const executable = "/usr/bin/file";
  const database = "/usr/share/file/magic.mgc";
  const env = { HOME: root, LC_ALL: "C", LANG: "C", PATH: "/usr/bin:/bin" };
  function invoke(args: readonly string[]) {
    const result = spawnSync(executable, [...args], { cwd: root, env, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
    if (result.error) throw result.error;
    if (result.status !== 0 || result.stderr) throw new Error(`Native file failed: ${result.status} ${result.stderr}`);
    return result.stdout;
  }
  try {
    const version = invoke(["--version"]).trim();
    const executableSha256 = createHash("sha256").update(await readFile(executable)).digest("hex");
    const databaseSha256 = createHash("sha256").update(await readFile(database)).digest("hex");
    const records = [];
    for (const specimen of fixtures) {
      await writeFile(`${root}/specimen`, specimen.bytes);
      records.push({ name: specimen.name, sha256: createHash("sha256").update(specimen.bytes).digest("hex"),
        mime: invoke(["-m", database, "-b", "--mime", "--", "specimen"]).trim(),
        human: invoke(["-m", database, "-b", "--", "specimen"]).trim() });
    }
    return { platform: process.platform, arch: process.arch, node: process.version, version, executableSha256, databaseSha256,
      locale: "C", environment: "isolated HOME, explicit magic database, no POSIXLY_CORRECT", records };
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await captureNative(), null, 2));
