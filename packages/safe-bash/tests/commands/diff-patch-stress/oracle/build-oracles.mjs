import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const root = await realpath(process.argv[2] ?? "");
assert(isAbsolute(root) && /\/safe-bash-gnu-oracle\.[^/]+$/u.test(root), "Pass an isolated mktemp directory named safe-bash-gnu-oracle.*");
const releases = [
  { name: "patch", version: "2.8", sha256: "f87cee69eec2b4fcbf60a396b030ad6aa3415f192aa5f7ee84cad5e11f7f5ae3", binary: "patch" },
  { name: "diffutils", version: "3.12", sha256: "7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd", binary: "diff" },
];
for (const directory of ["home", "tmp", "logs"]) await mkdir(join(root, directory), { recursive: true });
const environment = { PATH: "/usr/bin:/bin", HOME: join(root, "home"), TMPDIR: join(root, "tmp"), LANG: "C", LC_ALL: "C", TZ: "UTC", CC: "/usr/bin/cc" };
const commands = [];

async function bounded(command, args, cwd, name, timeout = 240_000) {
  const started = Date.now();
  const chunks = [];
  const child = spawn(command, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let timedOut = false;
  let bytes = 0;
  const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) kill();
    else chunks.push(chunk);
  });
  try {
    const status = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    const output = Buffer.concat(chunks);
    await writeFile(join(root, "logs", `${name}.log`), output);
    commands.push({ command, args, cwd, ...status, timedOut, durationMs: Date.now() - started });
    await writeFile(join(root, "build-commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
    assert(!timedOut && bytes <= 16 * 1024 * 1024 && status.code === 0 && !status.signal, `${name} failed: ${JSON.stringify(status)}\n${output.subarray(-4000)}`);
    return output.toString();
  } finally { clearTimeout(timer); }
}

const evidence = [];
for (const release of releases) {
  const basename = `${release.name}-${release.version}`;
  const archive = join(root, `${basename}.tar.xz`);
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), release.sha256, archive);
  const announcement = await readFile(join(root, `${release.name}-announcement.html`), "utf8");
  assert(announcement.includes(release.sha256) || announcement.includes(Buffer.from(release.sha256, "hex").toString("base64")), "Official announcement must contain the pinned digest");
  await bounded("/usr/bin/tar", ["-xf", archive, "-C", root], root, `${basename}-extract`, 30_000);
  const source = join(root, basename);
  await bounded("/bin/sh", ["./configure", "--disable-nls", `--prefix=${join(root, "unused-install-prefix")}`], source, `${basename}-configure`);
  await bounded("/usr/bin/make", ["-j2"], source, `${basename}-make`);
  const binary = join(source, "src", release.binary);
  const versionOutput = await bounded(binary, ["--version"], root, `${basename}-version`, 5000);
  assert(versionOutput.startsWith(release.binary === "patch" ? "GNU patch 2.8\n" : "diff (GNU diffutils) 3.12\n"));
  evidence.push({ ...release, archive, binary, binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"), versionOutput });
  await writeFile(join(root, "build-evidence.json"), `${JSON.stringify({ environment, evidence }, null, 2)}\n`);
  console.log(`${release.binary === "patch" ? "GNU_PATCH" : "GNU_DIFF"}=${binary}`);
}
