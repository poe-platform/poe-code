import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, link, symlink, truncate } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const oracle = resolve(directory, "../metadata-stress/.oracle/coreutils-9.7/src/du");
const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
const version = spawnSync(oracle, ["--version"], { encoding: "utf8", timeout: 10000 });
if (version.status !== 0) throw new Error(`GNU oracle unavailable: ${version.error ?? version.stderr}`);
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/native-"));
const fixture = await mkdtemp(join(output, "fixture-"));
const sizes = [0, 1, 1023, 1024, 1025, 10239, 10240, 10241, 1048575, 1048576, 1048577];
const cases = [];
const add = (name, args, env = {}) => cases.push({ name, args, env });
try {
  await mkdir(join(fixture, "tree/sub"), { recursive: true });
  await writeFile(join(fixture, "tree/a"), "abc");
  await writeFile(join(fixture, "tree/sub/b"), "12345");
  await link(join(fixture, "tree/a"), join(fixture, "alias"));
  await symlink("tree", join(fixture, "link"));
  await symlink("absent", join(fixture, "broken"));
  for (const size of sizes) {
    const name = `size-${size}`;
    await writeFile(join(fixture, name), "");
    await truncate(join(fixture, name), size);
    for (const flags of [["-bh"], ["-b", "-B", "si"], ["-b", "-B", "K"], ["-b", "-B", "1KB"]]) {
      add(`${size}:${flags.join(" ")}`, [...flags, name]);
    }
  }
  for (const flags of [[], ["-a"], ["-s"], ["-c"], ["-ac"], ["-d0"], ["-ad1"], ["-s", "-d0"], ["-as"], ["-s", "-d1"], ["-0a"]]) {
    add(`tree:${flags.join(" ")}`, ["-b", ...flags, "tree"]);
  }
  for (const args of [["-b", "link", "broken"], ["-b", "link/"], ["-bc", "tree/a", "alias"], ["-blc", "tree/a", "alias"], ["-b", "tree", "tree"], ["-b", "missing", "tree/a"], ["-b", ""], ["-b", "tree/a", "--unsupported"]]) add(args.join(" "), args);
  for (const value of ["1", "K", "kB", "KiB", "KB", "2K", "M", "1M", "m", "b", "0", "-1", "1.5K", "human-readable", "si", "Q", "1Q"]) add(`block:${value}`, ["-b", "-B", value, "size-1025"]);
  for (const env of [{}, { POSIXLY_CORRECT: "" }, { BLOCKSIZE: "2K" }, { BLOCK_SIZE: "4K", BLOCKSIZE: "2K" }, { DU_BLOCK_SIZE: "8K", BLOCK_SIZE: "4K" }, { DU_BLOCK_SIZE: "bad" }, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "2K" }]) add(`env:${JSON.stringify(env)}`, ["--apparent-size", "size-1025"], env);
  const results = cases.map(item => {
    const result = spawnSync(oracle, item.args, { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    return { ...item, status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
  });
  await writeFile(join(output, "profile.json"), JSON.stringify({ created: new Date().toISOString(), platform: process.platform, node: process.version, oracle, version: version.stdout, binarySha256: await hash(oracle), sourceSha256: await hash(`${oracle}.c`), sizes, results }, null, 2) + "\n");
  console.log(JSON.stringify({ output, cases: results.length, version: version.stdout.split("\n")[0] }));
} finally { await rm(fixture, { recursive: true, force: true }); }
