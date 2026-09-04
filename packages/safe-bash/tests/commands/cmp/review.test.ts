import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { cmpCommands } from "../../../src/commands/cmp/index.js";
import { FsError, type ByteSource } from "../../../src/contracts/index.js";
import { native, run } from "./helpers.js";

const nativePrerequisite = process.env.CMP_ORACLE ? false : "set CMP_ORACLE to the pinned GNU diffutils 3.12 executable";

test("independent help is exact pinned GNU C stdout stderr and status", { skip: nativePrerequisite }, async () => {
  for (const args of [["--help"], ["--he"], ["--help", "--bad"], ["-s", "--help"]]) {
    const expected = await native(args);
    assert.equal(expected.exitCode, 0);
    assert.equal(expected.stderr, "");
    assert.deepEqual(await run(args), expected, JSON.stringify(args));
  }
});

test("independent version expectation preserves the explicit executable identity exception", async () => {
  assert.deepEqual(await run(["--version"]), {
    exitCode: 0, stdout: "cmp (virtual-bash, GNU diffutils 3.12 profile)\n", stderr: "",
  });
});

test("independent GNU numeric grammar and option abbreviations", { skip: nativePrerequisite }, async () => {
  const values = ["0x", "0X", "+K", " K", "-K", "\t-0", "00K", "09", "0b1", "0x1K", "1KD", "1kiB",
    "1R", "1Q", "1B", "1D", "0Y", "0x0Y", "01MiB", "1\n", ":", "1:2:3", "9223372036854775807", "9223372036854775808"];
  for (const flag of ["-i", "-n"]) for (const value of values) {
    const args = [flag, value, "-", "-"];
    assert.deepEqual(await run(args), await native(args), JSON.stringify(args));
  }
  for (const args of [["-:", "-", "-"], ["--=v", "-", "-"], ["--silent=x"], ["--print-c", "-", "-"],
    ["--print-b", "-", "-"], ["--verb", "-", "-"], ["--by", "0", "-", "-"], ["--ignore", "0:0", "-", "-"]]) {
    assert.deepEqual(await run(args), await native(args), JSON.stringify(args));
  }
});

test("independent exact native status and byte output across full and partial blocks", { skip: nativePrerequisite }, async () => {
  for (const length of [65535, 65536, 65537, 131071, 131072, 131073]) {
    for (const position of [0, length - 1]) {
      const left = Buffer.alloc(length, 97), right = Buffer.from(left);
      right[position] = 255;
      const fs = createMemoryFileSystem();
      await fs.mkdir("/dev/fd", { recursive: true });
      await fs.writeFile("/dev/fd/3", left);
      for (const mode of ["-l", "-b", "-s"]) {
        const args = [mode, `-n${length}`, "/dev/fd/3", "-"];
        assert.deepEqual(await run(args, left, right, { fs }), await native(args, left, right), JSON.stringify({ length, position, mode }));
      }
    }
  }
});

test("independent block profile is distinct from producer fragment boundaries", async () => {
  for (const blockBytes of [3, 4, 7]) {
    const length = blockBytes * 2 + 1;
    for (const position of [0, blockBytes - 1, blockBytes, length - 1]) {
      for (const fragmentBytes of [1, 2, 5]) {
        const fs = createMemoryFileSystem();
        const left = Buffer.alloc(length, 97), right = Buffer.from(left);
        right[position] = 98;
        await fs.writeFile("/left", left);
        await fs.writeFile("/right", right);
        fs.readStream = path => (async function* () {
          const bytes = path === "/left" ? left : right;
          const reusable = Buffer.alloc(fragmentBytes);
          try {
            for (let offset = 0; offset < length; offset += fragmentBytes) {
              const count = Math.min(fragmentBytes, length - offset);
              reusable.set(bytes.subarray(offset, offset + count));
              yield reusable.subarray(0, count);
            }
          } finally { reusable.fill(255); }
        })();
        const result = await run(["-l", "left", "right"], left, right, { fs }, { comparisonBlockBytes: blockBytes });
        assert.deepEqual(result, {
          exitCode: position === length - 1 ? 1 : 0,
          stdout: `${String(position + 1).padStart(String(length).length)} 141 142\n`, stderr: "",
        }, JSON.stringify({ blockBytes, position, fragmentBytes }));
      }
    }
  }
});

test("independent default block selection uses first-input canonical metadata, preserving GNU 3.12 selection", async () => {
  for (const [firstBlock, secondBlock, expectedStatus] of [[16384, 65536, 0], [65536, 16384, 1], [16384, 24576, 0]]) {
    const fs = createMemoryFileSystem();
    const left = Buffer.alloc(32769, 97), right = Buffer.from(left);
    right[0] = 98;
    await fs.writeFile("/left", left);
    await fs.writeFile("/right", right);
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => ({ ...await stat(path, options), ioBlockSize: path === "/left" ? firstBlock! : secondBlock! });
    const result = await run(["-ln32769", "left", "right"], left, right, { fs });
    assert.deepEqual(result, { exitCode: expectedStatus, stdout: "    1 141 142\n", stderr: "" }, JSON.stringify({ firstBlock, secondBlock }));
  }
});

test("independent explicit comparison profile overrides canonical metadata without changing it", async () => {
  const fs = createMemoryFileSystem();
  const left = Buffer.alloc(32769, 97), right = Buffer.from(left);
  right[0] = 98;
  await fs.writeFile("/left", left);
  await fs.writeFile("/right", right);
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => ({ ...await stat(path, options), ioBlockSize: 65536 });
  const before = await fs.stat("/left");
  assert.equal(before.ioBlockSize, 65536);
  const result = await run(["-ln32769", "left", "right"], left, right, { fs }, { comparisonBlockBytes: 16384 });
  assert.deepEqual(result, { exitCode: 0, stdout: "    1 141 142\n", stderr: "" });
  assert.equal((await fs.stat("/left")).ioBlockSize, before.ioBlockSize);
});

test("independent malformed canonical block metadata fails before producer acquisition", async () => {
  for (const ioBlockSize of [NaN, 0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", Buffer.from("a"));
    await fs.writeFile("/right", Buffer.from("b"));
    const stat = fs.stat.bind(fs);
    fs.stat = async (path, options) => ({ ...await stat(path, options), ioBlockSize });
    let acquisitions = 0;
    fs.readStream = () => { acquisitions++; throw new Error("malformed metadata acquired source"); };
    assert.deepEqual(await run(["left", "right"], undefined, undefined, { fs }), {
      exitCode: 2, stdout: "", stderr: "cmp: left: invalid preferred I/O block size\n",
    });
    assert.equal(acquisitions, 0);
  }
});

test("independent unknown first-input metadata keeps the explicit 64-KiB fallback policy", async () => {
  const fs = createMemoryFileSystem();
  const left = Buffer.alloc(32769, 97), right = Buffer.from(left);
  right[0] = 98;
  await fs.writeFile("/left", left);
  await fs.writeFile("/right", right);
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => {
    const result = { ...await stat(path, options) };
    if (path === "/left") delete result.ioBlockSize;
    else result.ioBlockSize = 16384;
    return result;
  };
  assert.deepEqual(await run(["-ln32769", "left", "right"], left, right, { fs }), {
    exitCode: 1, stdout: "    1 141 142\n", stderr: "",
  });
});

test("independent backpressure stops reads and cancellation closes both acquired sources", async () => {
  for (const reason of [null, false, 0, "", new FsError("EPIPE")]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", Buffer.alloc(12, 97));
    await fs.writeFile("/right", Buffer.alloc(12, 98));
    let reads = 0, closes = 0, writes = 0;
    fs.readStream = path => (async function* () {
      try {
        for (let offset = 0; offset < 12; offset += 4) {
          reads++;
          yield Buffer.alloc(4, path === "/left" ? 97 : 98);
        }
      } finally { closes++; }
    })();
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const operation = run(["-l", "left", "right"], undefined, undefined, {
      fs, signal: controller.signal, stdout: { async write() { writes++; entered(); await blocked; } },
    }, { comparisonBlockBytes: 4 });
    const rejection = assert.rejects(operation, error => error === reason);
    try {
      await ready;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(reads, 2);
      assert.equal(writes, 1);
      controller.abort(reason);
      release();
      await rejection;
      assert.equal(closes, 2);
    } finally { controller.abort(reason); release(); }
  }
});

test("independent zero count admits paths without acquiring input producers", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a"));
  let acquisitions = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { acquisitions++; throw new Error("zero count acquired source"); } };
  fs.readStream = () => source;
  assert.deepEqual(await run(["-n0", "left", "-"], undefined, undefined, { fs, stdin: source }), { exitCode: 0, stdout: "", stderr: "" });
  assert.equal(acquisitions, 0);
  assert.equal((await run(["-n0", "missing", "-"], undefined, undefined, { fs, stdin: source })).exitCode, 2);
  assert.equal(acquisitions, 0);
});

test("independent short-consumer pipelines match native stdout stderr and PIPESTATUS", { skip: nativePrerequisite }, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.alloc(131072, 97));
  await fs.writeFile("/right", Buffer.alloc(131072, 98));
  const shell = new Shell({ fs, limits: { maxWallClockMs: 2000 } }).use(agentCommands()).use(cmpCommands());
  try {
    for (const lines of [1, 3]) {
      const status = "; printf 'status:%s\\n' \"${PIPESTATUS[*]}\"";
      const expected = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c",
        `"$1" -ln131072 <(head -c 131072 /dev/zero | tr '\\000' a) <(head -c 131072 /dev/zero | tr '\\000' b) | head -n ${lines}${status}`,
        "cmp-review", process.env.CMP_ORACLE!], { env: { LC_ALL: "C", PATH: "/usr/bin:/bin" }, timeout: 2000, maxBuffer: 65536 });
      assert.equal(expected.error, undefined);
      assert.equal(expected.signal, null);
      const actual = await shell.exec(`cmp -ln131072 /left /right | head -n ${lines}${status}`);
      assert.equal(actual.exitCode, expected.status);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout);
      assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr);
      assert.ok(actual.stdout.endsWith("status:141 0\n"));
    }
  } finally { await shell.dispose(); }
});

test("independent cmp VFS script workflow preserves status and output redirection", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("a"));
  await fs.writeFile("/right", Buffer.from("b"));
  await fs.writeFile("/job.sh", Buffer.from("cmp -s /left /right\nprintf 'different:%s\\n' \"$?\"\ncmp -n0 /left /right\nprintf 'zero:%s\\n' \"$?\"\ncmp -b /left /right >/difference\ncat /difference\n"));
  const shell = new Shell({ fs }).use(agentCommands()).use(cmpCommands());
  try {
    const result = await shell.exec("sh /job.sh");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "different:1\nzero:0\n/left /right differ: byte 1, line 1 is 141 a 142 b\n");
  } finally { await shell.dispose(); }
});
