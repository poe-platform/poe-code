import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MemoryFileSystem, Shell, archiveCommands } from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";

test("zip to a pipe agrees with Info-ZIP 3.0 and extracts with UnZip 6.0", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "infozip-");
  const native = async (command: "zip" | "unzip", args: string[]) => {
    const proc = spawn("/usr/bin/" + command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const [[status], stdout, stderr] = await Promise.all([once(proc, "close"), buffer(proc.stdout), buffer(proc.stderr)]);
    return { status, stdout, stderr };
  };
  const fs = new MemoryFileSystem();
  const js = new Shell({ fs, cwd: "/" }).use(archiveCommands());
  const rust = new RustWasmBash({ cwd: "/" });
  try {
    assert.match((await native("zip", ["-v"])).stdout.toString(), /Zip 3\.0\b/);
    assert.match((await native("unzip", ["-v"])).stdout.toString(), /UnZip 6\.00\b/);
    const payload = Uint8Array.of(0, 8, 255);
    await writeFile(cwd + "/src", payload);
    await utimes(cwd + "/src", 1700000000, 1700000000);
    for (const view of [fs, rust.fs]) {
      await view.writeFile("/src", payload);
      await view.utimes("/src", 1700000000000, 1700000000000);
    }
    for (const args of [["-", "src"], ["-q0", "-", "src"], ["-b", "absent", "-", "src"], ["-T", "-TT", "false", "-", "src"], ["-", "absent"]]) {
      const reference = await native("zip", args);
      for (const shell of [js, rust]) {
        const result = await shell.exec("zip " + args.join(" "));
        assert.equal(result.exitCode, reference.status, args.join(" "));
        assert.equal(result.stderr, reference.stderr.toString(), args.join(" "));
        const bytes = Buffer.from(result.stdoutBytes);
        if (reference.status !== 0) {
          assert.deepEqual(bytes, reference.stdout);
          continue;
        }
        assert.equal(bytes.readUInt16LE(6) & 8, reference.stdout.readUInt16LE(6) & 8); // data descriptor
        assert.equal(bytes.readUInt16LE(8), reference.stdout.readUInt16LE(8)); // compression method
        await writeFile(cwd + "/check.zip", bytes);
        const extracted = await native("unzip", ["-p", "check.zip", "src"]);
        assert.equal(extracted.status, 0, extracted.stderr.toString());
        assert.deepEqual(extracted.stdout, Buffer.from(payload));
      }
    }
  } finally {
    await js.dispose();
    await rust.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
