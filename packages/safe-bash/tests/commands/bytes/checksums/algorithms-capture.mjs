import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const executable = (process.env.COREUTILS_ORACLE_ROOT ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src") + "/cksum";
const directory = await mkdtemp(join(tmpdir(), "safe-checksum-oracle-"));
const bytes = Buffer.from([0, 128, 255, 13, 10, 65]);
const files = { input: bytes.toString("base64"), "line\nname": bytes.toString("base64"), "back\\name": bytes.toString("base64") };
try {
  for (const [name, data] of Object.entries(files)) await writeFile(join(directory, name), Buffer.from(data, "base64"));
  const rows = [];
  for (const algorithm of ["crc", "md5", "sha1", "sha224", "sha256", "sha384", "sha512"]) {
    for (const args of [["-a", algorithm], [`--algorithm=${algorithm}`, "input"], ["-a", algorithm, "line\nname", "back\\name"], ["-z", "-a", algorithm, "line\nname"]]) {
      const result = spawnSync(executable, args, { cwd: directory, env: { LC_ALL: "C" }, input: bytes, timeout: 5000 });
      if (result.error) throw result.error;
      rows.push({ args, stdin: bytes.toString("base64"), files, stdout: result.stdout.toString("base64"), stderr: result.stderr.toString("base64"), exitCode: result.status });
    }
  }
  await writeFile(new URL("algorithms-native.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), executable, sha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    version: execFileSync(executable, ["--version"], { encoding: "utf8" }).split("\n")[0], rows }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ total: rows.length, nativeFailures: rows.filter(row => row.exitCode !== 0).length }));
} finally { await rm(directory, { recursive: true, force: true }); }
