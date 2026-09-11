import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, FsError, Shell } from "../../src/index.js";

interface NativeCase {
  name: string;
  populated: boolean;
  existing: boolean;
  argv: string[];
  expected: {
    status: number;
    stdoutBase64: string;
    stderrBase64: string;
    target: {
      exists: boolean;
      bytesBase64?: string;
      size?: number;
      mode?: number;
      type?: string;
    };
  };
}

const native = JSON.parse(readFileSync(new URL("./truncate-ext4.snapshot.json", import.meta.url), "utf8")) as {
  profile: Record<string, unknown>;
  cases: NativeCase[];
};

test("truncate static oracle is the complete bounded GNU 8.30 Linux64 ext4 profile", () => {
  assert.equal(native.profile.platform, "linux");
  assert.equal(native.profile.architecture, "x64");
  assert.equal(native.profile.filesystemType, 0xef53);
  assert.equal(native.profile.blockSize, 4096);
  assert.equal(native.profile.version, "truncate (GNU coreutils) 8.30");
  assert.equal(native.profile.locale, "C");
  assert.equal(native.profile.umask, 0o022);
  assert.equal(native.profile.maximumCapturedFileBytes, 64);
  assert.equal(native.profile.sourceSha256, "2c56bcf96be1e78deea35b74292c31ad18411dc44edda09a7844297d1770f099");
  const names = [
    "maximum-zero", "maximum-one", "maximum-eight", "subtract-to-one", "subtract-to-zero",
    "subtract-below-zero", "extend-overflow", "round-up-overflow", "minimum-too-large",
    "round-down-too-large", "round-up-too-large", "reference-too-large", "round-down-zero",
    "round-up-zero", "absolute-with-reference", "no-create", "directory-then-target"
  ];
  assert.equal(native.cases.length, names.length * 4);
  for (const name of names) for (const populated of [false, true]) for (const existing of [false, true]) {
    assert.equal(native.cases.filter(entry => entry.name === name && entry.populated === populated && entry.existing === existing).length, 1);
  }
});

async function targetEffect(fs: ReturnType<typeof createMemoryFileSystem>): Promise<NativeCase["expected"]["target"]> {
  let stat;
  try {
    stat = await fs.stat("/work/target");
  } catch (error) {
    if (error instanceof FsError && error.code === "ENOENT") return { exists: false };
    throw error;
  }
  return {
    exists: true,
    bytesBase64: Buffer.from(await fs.readFile("/work/target", { maxBytes: 64 })).toString("base64"),
    size: stat.size,
    mode: stat.mode & 0o777,
    type: stat.type
  };
}

for (const entry of native.cases) {
  test(`truncate Linux64 ext4 ${entry.name} populated=${entry.populated} existing=${entry.existing}`, async () => {
    const fs = createMemoryFileSystem({ maxFileBytes: 64, maxRetainedBytes: 1024, maxMetadataUnits: 16 });
    await fs.mkdir("/work/reference", { recursive: true });
    if (entry.populated) await fs.writeFile("/work/reference/child", new TextEncoder().encode("child"));
    if (entry.existing) await fs.writeFile("/work/target", new TextEncoder().encode("abcdef"), { mode: 0o640 });
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const result = await shell.exec(`truncate ${entry.argv.map(argument => `'${argument.replaceAll("'", "'\\''")}'`).join(" ")}`);
      assert.deepEqual({
        status: result.exitCode,
        stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"),
        stderrBase64: Buffer.from(result.stderrBytes).toString("base64"),
        target: await targetEffect(fs)
      }, entry.expected);
      assert.equal((await fs.stat("/work/reference")).type, "directory");
      assert.deepEqual((await fs.readdir("/work/reference")).map(child => child.name), entry.populated ? ["child"] : []);
      if (entry.populated) assert.deepEqual(await fs.readFile("/work/reference/child"), new TextEncoder().encode("child"));
    } finally {
      await shell.dispose();
    }
  });
}

for (const existing of [false, true]) for (const quota of ["file", "retained"] as const) {
  test(`truncate ext4 Memory quota safety (${quota}, existing=${existing}) preserves effects and recovers`, async () => {
    const fs = createMemoryFileSystem({
      maxFileBytes: quota === "file" ? 8 : 64,
      maxRetainedBytes: quota === "retained" ? 100 : 1024,
      maxMetadataUnits: 8
    });
    await fs.mkdir("/work/reference", { recursive: true });
    if (existing) await fs.writeFile("/work/target", new TextEncoder().encode("abcdef"), { mode: 0o640 });
    const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
    try {
      const result = await shell.exec("truncate -r reference '-s<64' target");
      assert.deepEqual({
        status: result.exitCode,
        stdout: result.stdoutBytes,
        stderr: result.stderrBytes,
        target: await targetEffect(fs)
      }, {
        status: 1,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode(`truncate: failed to truncate 'target' at 64 bytes: ${quota === "file" ? "File too large" : "No space left on device"}\n`),
        target: { exists: true, bytesBase64: existing ? "YWJjZGVm" : "", size: existing ? 6 : 0, mode: existing ? 416 : 420, type: "file" }
      });
      const recovery = await shell.exec("truncate -r reference '-s<1' target");
      assert.deepEqual([recovery.exitCode, recovery.stdoutBytes, recovery.stderrBytes], [0, new Uint8Array(), new Uint8Array()]);
      assert.deepEqual(await targetEffect(fs), {
        exists: true, bytesBase64: existing ? "YQ==" : "AA==", size: 1, mode: existing ? 416 : 420, type: "file"
      });
    } finally {
      await shell.dispose();
    }
  });
}

test("truncate ext4 Shell cleanup releases actual retained handles on success and overflow", async () => {
  const fs = createMemoryFileSystem({ maxFileBytes: 8, maxRetainedBytes: 100, maxMetadataUnits: 8 });
  const shell = new Shell({ fs, cwd: "/work", env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      await fs.mkdir("/work/reference", { recursive: true });
      await fs.writeFile("/work/target", new TextEncoder().encode("abcdef"));
      const success = await shell.exec("truncate -r reference '-s<1' target");
      assert.deepEqual([success.exitCode, success.stdoutBytes, success.stderrBytes], [0, new Uint8Array(), new Uint8Array()]);
      const overflow = await shell.exec("truncate -r reference -s+1 target");
      assert.deepEqual([overflow.exitCode, overflow.stdoutBytes, overflow.stderrBytes], [
        1, new Uint8Array(), new TextEncoder().encode("truncate: overflow extending size of file 'target'\n")
      ]);
      assert.deepEqual(await fs.readFile("/work/target"), Uint8Array.of(97));
      await fs.rm("/work", { recursive: true });
    }
  } finally {
    await shell.dispose();
  }
  await fs.mkdir("/work/reference", { recursive: true });
  await fs.writeFile("/work/target", new Uint8Array(8));
  const reference = await fs.openReadFile("/work/reference", { allowDirectory: true });
  await reference.close();
  const target = await fs.openResizeFile("/work/target", { create: false });
  await target.close();
});
