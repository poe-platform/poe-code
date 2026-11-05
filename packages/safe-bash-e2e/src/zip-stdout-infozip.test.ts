import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MemoryFileSystem, Shell, archiveCommands } from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";

test("zip to a pipe agrees with Info-ZIP 3.0 and extracts with UnZip 6.0", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "infozip-");
  const native = async (command: "zip" | "unzip" | "funzip", args: string[], stdin?: Uint8Array | "src") => {
    // Node uses a socket pair for child stdin. Info-ZIP records its file type;
    // use a shell pipe so the reference member has the metadata of a Unix pipe.
    const path = "/usr/bin/" + command;
    const proc = stdin === "src" ? spawn("/bin/sh", ["-c", 'exec "$@" <src', "sh", path, ...args], {cwd, env})
      : stdin ? spawn("/bin/sh", ["-c", 'cat | exec "$@"', "sh", path, ...args], {cwd, env})
      : spawn(path, args, {cwd, env, stdio:["ignore", "pipe", "pipe"]});
    if (stdin && stdin !== "src") proc.stdin!.end(stdin);
    const [[status], stdout, stderr] = await Promise.all([once(proc, "close"), buffer(proc.stdout!), buffer(proc.stderr!)]);
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
    await chmod(cwd + "/src", 0o640);
    await utimes(cwd + "/src", 1700000000, 1700000000);
    for (const view of [fs, rust.fs]) {
      await view.writeFile("/src", payload);
      await view.chmod("/src", 0o640);
      await view.utimes("/src", 1700000000000, 1700000000000);
    }
    for (const args of [["-", "src"], ["-q0", "-", "src"], ["-b", "absent", "-", "src"], ["-T", "-TT", "false", "-", "src"], ["-", "absent"]]) {
      const reference = await native("zip", args);
      for (const [shell, view] of [[js, fs], [rust, rust.fs]] as const) {
        const result = await shell.exec("zip " + args.join(" "));
        assert.equal(result.exitCode, reference.status, args.join(" "));
        assert.equal(result.stderr, reference.stderr.toString(), args.join(" "));
        const bytes = Buffer.from(result.stdoutBytes);
        if (reference.status !== 0) {
          assert.deepEqual(bytes, reference.stdout);
          continue;
        }
        await view.writeFile("/native.zip", reference.stdout);
        const imported = await shell.exec("unzip -p native.zip src");
        assert.equal(imported.exitCode, 0, imported.stderr);
        assert.deepEqual(Buffer.from(imported.stdoutBytes), Buffer.from(payload));
        assert.equal(bytes.readUInt16LE(4), reference.stdout.readUInt16LE(4)); // minimum extractor version
        assert.equal(bytes.readUInt16LE(6) & 8, reference.stdout.readUInt16LE(6) & 8); // data descriptor
        assert.equal(bytes.readUInt16LE(8), reference.stdout.readUInt16LE(8)); // compression method
        await writeFile(cwd + "/check.zip", bytes);
        const extracted = await native("unzip", ["-p", "check.zip", "src"]);
        assert.equal(extracted.status, 0, extracted.stderr.toString());
        assert.deepEqual(extracted.stdout, Buffer.from(payload));
        const streamed = await native("funzip", ["check.zip"]);
        assert.equal(streamed.status, 0, shell.constructor.name + ": " + args.join(" ") + ": " + streamed.stderr);
        assert.deepEqual(streamed.stdout, Buffer.from(payload));
      }
    }
    for (const flags of [["-q0"], ["-q0", "-fz-"]]) {
      const args = [...flags, "-", "-"];
      const reference = await native("zip", args, "src");
      assert.equal(reference.status, 0, reference.stderr.toString());
      for (const shell of [js, rust]) {
        const result = await shell.exec("zip " + args.join(" ") + " <src");
        assert.equal(result.exitCode, 0, result.stderr);
        for (const bytes of [Buffer.from(result.stdoutBytes), reference.stdout]) {
          const central = bytes.indexOf(Buffer.from("PK\x01\x02","binary"));
          assert.equal(bytes.readUInt32LE(central + 38) >>> 16, 0o100640);
          assert.equal(bytes.readUInt32LE(10), reference.stdout.readUInt32LE(10)); // DOS time and date
          if (flags.length === 2) assert.equal(bytes.readUInt32LE(18), payload.length);
          else {
            let extra = 30 + bytes.readUInt16LE(26);
            const end = extra + bytes.readUInt16LE(28);
            while (extra < end && bytes.readUInt16LE(extra) !== 1) extra += 4 + bytes.readUInt16LE(extra+2);
            assert.ok(extra < end);
            assert.equal(bytes.readBigUInt64LE(extra+4), BigInt(payload.length));
            assert.equal(bytes.readBigUInt64LE(extra+12), BigInt(payload.length));
          }
        }
      }
    }
    await writeFile(cwd + "/-", "literal dash");
    for (const [shell, view] of [[js, fs], [rust, rust.fs]] as const) {
      await view.writeFile("/-", Buffer.from("literal dash"));
      for (const args of [["-qm", "named.zip", "-"], ["-q", "-", "-"], ["-q"], ["-q", "-fz-", "-", "-"], ["-qfz", "named.zip", "-"], ["-q", "--force-zip64", "named.zip", "src"], ["-q", "--force-zip64-", "named.zip", "-"]]) {
        const named = args.includes("named.zip");
        const reference = await native("zip", args, payload);
        assert.equal(reference.status, 0, reference.stderr.toString());
        const nativeArchive = named ? await readFile(cwd + "/named.zip") : reference.stdout;
        const result = await shell.exec("zip " + args.join(" "), {stdin:payload});
        assert.equal(result.exitCode, reference.status, result.stderr);
        const bytes = named ? await view.readFile("/named.zip") : result.stdoutBytes;
        const local = Buffer.from(bytes);
        assert.equal(local.readUInt16LE(4), nativeArchive.readUInt16LE(4), args.join(" "));
        assert.equal(local.readUInt16LE(6) & 8, nativeArchive.readUInt16LE(6) & 8, args.join(" "));
        assert.equal(local.readUInt16LE(8), nativeArchive.readUInt16LE(8), args.join(" "));
        await writeFile(cwd + "/check.zip", bytes);
        const extracted = await native("unzip", ["-p", "check.zip"]);
        assert.equal(extracted.status, 0, extracted.stderr.toString());
        assert.deepEqual(extracted.stdout, Buffer.from(payload));
        await view.writeFile("/native.zip", nativeArchive);
        const imported = await shell.exec("unzip -p native.zip");
        assert.equal(imported.exitCode, 0, imported.stderr);
        assert.deepEqual(Buffer.from(imported.stdoutBytes), Buffer.from(payload));
        assert.deepEqual(await view.readFile("/-"), new Uint8Array(Buffer.from("literal dash")));
        if (named) { await rm(cwd + "/named.zip"); await view.unlink("/named.zip"); }
      }
    }
  } finally {
    await js.dispose();
    await rust.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
