import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const executable = (process.env.COREUTILS_ORACLE_ROOT ?? "/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src") + "/sort";
const encode = bytes => Buffer.from(bytes).toString("base64");
const specimens = [];
for (const seed of [7, 23, 71, 997]) {
  const records = Array.from({ length: 257 }, (_, index) => `${(index * seed) % 101 - 50}`);
  for (const args of [[], ["-r"], ["-u"], ["-s"], ["-n"], ["-nr"], ["-nu"]]) specimens.push({ name: `seed${seed}/${args.join("") || "plain"}`, args, stdin: encode(records.join("\n") + "\n") });
}
for (const args of [["-f"], ["-fu"], ["-b"], ["-br"], ["-s", "-k2,2n"], ["-u", "-k2,2n"]]) specimens.push({ name: args.join(" "), args, stdin: encode("  b 2\n A 1\n a 1\nZ 10\n z -1\n") });
specimens.push({ name: "nul-binary", args: ["-zu"], stdin: encode(Buffer.from([255, 0, 128, 0, 255, 0, 65, 0])) });
const observations = specimens.map(specimen => {
  const result = spawnSync(executable, specimen.args, { input: Buffer.from(specimen.stdin, "base64"), env: { LC_ALL: "C" }, timeout: 5000 });
  if (result.error) throw result.error;
  return { ...specimen, stdout: encode(result.stdout), stderr: encode(result.stderr), exitCode: result.status };
});
await writeFile(new URL("native.json", import.meta.url), JSON.stringify({ capturedAt: new Date().toISOString(), executable, sha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
  version: execFileSync(executable, ["--version"], { encoding: "utf8" }).split("\n")[0], observations }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ total: observations.length, failedNative: observations.filter(row => row.exitCode !== 0).length }));
