import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { execute, fixture } from "./zip-standard-flags.helpers.js";
import { toByteSource } from "../../src/contracts/index.js";
import { readZipArchive } from "../../src/commands/archive/zip-format.js";
import { settings } from "../../src/commands/archive/internal.js";
import { zipFromCrlf } from "../../src/commands/archive/zip/line-endings.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { Shell, archiveCommands } from "../../src/index.js";

interface NativeConversion {
  level: number;
  size: number;
  sha256: string;
  crc: number;
  method: number;
}
interface BoundaryConversion extends NativeConversion {
  boundary: number;
  delta: number;
  marker: string;
}
interface PatternConversion extends NativeConversion {
  kind: "random" | "mixed" | "dense" | "lazy" | "sentinel" | "ctrlz";
  count: number;
}
const fromCrlfCaptures = JSON.parse(readFileSync(new URL("./fixtures/zip-from-crlf-infozip.json", import.meta.url), "utf8")) as {
  boundaries: BoundaryConversion[];
  patterns: PatternConversion[];
};

// Deterministic oracle inputs, independent of conversion and compressor logic.
function nativePattern(kind: PatternConversion["kind"], count: number): Buffer {
  const bytes = Buffer.alloc(count);
  let state = 42;
  const mixed = Buffer.from("a\r\nb\rc\n\x1a");
  const dense = Buffer.from("A\r\n\r\r\n\x1a");
  const lazy = [Buffer.from("abcdefghabcdefghXabcdefghY"), Buffer.from("abcdefghabcdefghYabcdefghX\r\n")];
  for (let offset = 0; offset < count;) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    if (kind === "random" || kind === "mixed" && state % 17 !== 0) {
      bytes[offset++] = 32 + (state >>> 16) % 95;
    } else if (kind === "mixed" || kind === "dense" || kind === "lazy") {
      const part = kind === "mixed" ? mixed : kind === "dense" ? dense : lazy[state % 3 ? 0 : 1]!;
      const length = Math.min(part.length, count - offset);
      bytes.set(part.subarray(0, length), offset);
      offset += length;
    } else if (offset % 32768 < 32766) bytes[offset++] = 65;
    else {
      bytes[offset++] = kind === "sentinel" ? 13 : 26;
      if (offset < count) bytes[offset++] = kind === "sentinel" ? 88 : 26;
    }
  }
  return Buffer.concat([bytes, Buffer.from("\rX\r\n\x1a")]);
}

for (const capture of [...fromCrlfCaptures.boundaries, ...fromCrlfCaptures.patterns]) {
  const label = "boundary" in capture ? `${capture.boundary}/${capture.delta}/${capture.marker}` : `${capture.kind}/${capture.count}`;
  test(`zip -ll native later-read oracle -${capture.level} ${label}`, async () => {
    const input = "boundary" in capture
      ? Buffer.concat([Buffer.alloc(capture.boundary + capture.delta, 65), Buffer.from(capture.marker, "hex"), Buffer.alloc(40000, 66), Buffer.from("\r\n\x1a")])
      : nativePattern(capture.kind, capture.count);
    const output = await zipFromCrlf(input, capture.level === 0, new AbortController().signal, capture.level);
    assert.equal(output.length, capture.size);
    assert.equal(createHash("sha256").update(output).digest("hex"), capture.sha256);
    if (capture.level !== 0 && capture.level !== 6 && !("kind" in capture && capture.kind === "dense" && capture.count === 140000)) return;
    const fs = await fixture();
    await fs.writeFile("/work/text", input);
    const result = await execute("zip", fs, ["-qll", `-${capture.level}`, "out.zip", "text"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const bytes = await fs.readFile("/work/out.zip");
    const entry = (await readZipArchive(bytes, settings({}), new AbortController().signal)).entries[0]!;
    assert.equal(entry.size, capture.size);
    assert.equal(entry.crc32, capture.crc);
    assert.equal(entry.method, capture.method);
    const extracted = await execute("unzip", fs, ["-p", "out.zip", "text"]);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(extracted.stdout, Buffer.from(output));
  });
}

test("zip help exposes from-CRLF conversion", async () => {
  const result = await execute("zip", await fixture(), ["-h"]);
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("-ll"));
});

for (const method of [0, 6]) {
  for (const chunkSize of [511, 512, 16382, 16383, 16384, 32767, 32768, 32769, 65534, 65535, 65536, 65537]) {
    test(`zip -ll -${method} native windows across owned stdin chunks ${chunkSize}`, async () => {
      const capture = fromCrlfCaptures.boundaries.find(item => item.level === method && item.boundary === 65535 && item.delta === -1 && item.marker === "0d580d0a1a")!;
      const input = Buffer.concat([Buffer.alloc(65534, 65), Buffer.from("\rX\r\n\x1a"), Buffer.alloc(40000, 66), Buffer.from("\r\n\x1a")]);
      const original = Buffer.from(input);
      const reused = Buffer.alloc(chunkSize);
      let closed = false;
      const stdin = (async function* () {
        try {
          for (let offset = 0; offset < input.length; offset += chunkSize) {
            const part = input.subarray(offset, offset + chunkSize);
            reused.set(part);
            yield reused.subarray(0, part.length);
          }
        } finally { reused.fill(0); closed = true; }
      })();
      const fs = await fixture();
      const result = await execute("zip", fs, ["-qll", `-${method}`, "out.zip", "-"], {}, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(closed, true);
      assert.deepEqual(input, original);
      const extracted = await execute("unzip", fs, ["-p", "out.zip", "-"]);
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      assert.equal(extracted.stdout.length, capture.size);
      assert.equal(createHash("sha256").update(extracted.stdout).digest("hex"), capture.sha256);
    });
  }
  for (const flags of [[], ["-fd"], ["-fz"], ["-fd", "-fz"]]) {
    test(`zip -ll -${method} transformed CRC and sizes in records ${flags}`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/text", Buffer.from("a\r\nb\rc\n\x1a"));
      assert.equal((await execute("zip", fs, ["-qll", `-${method}`, ...flags, "out.zip", "text"])).exitCode, 0);
      const bytes = await fs.readFile("/work/out.zip");
      const entry = (await readZipArchive(bytes, settings({}), new AbortController().signal)).entries[0]!;
      assert.equal(entry.size, 6);
      assert.equal(entry.crc32, 0x0f28185c);
      assert.equal(Boolean(entry.flags! & 8), flags.includes("-fd"));
      assert.equal((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout.toString(), "a\nb\rc\n");
    });
  }
  test(`zip -ll -${method} budgets admit original bytes before shrinking`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/text", Buffer.from("a\r\n\x1a"));
    for (const limits of [{ maxEntryBytes: 3 }, { maxTotalBytes: 3 }]) {
      const result = await execute("zip", fs, ["-qll", `-${method}`, "out.zip", "text"], { limits });
      assert.equal(result.exitCode, 2);
      assert.equal((await fs.readdir("/work")).some(entry => entry.name === "out.zip"), false);
    }
    assert.equal((await execute("zip", fs, ["-qll", `-${method}`, "out.zip", "text"], { limits: { maxEntryBytes: 4, maxTotalBytes: 4 } })).exitCode, 0);
    assert.equal((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout.toString(), "a\n");
  });
}

for (const level of [1, 6, 9]) {
  test(`zip from-CRLF cancels during later DEFLATE work -${level}`, async () => {
    const controller = new AbortController();
    const reason = { cancelled: level };
    let turns = 0;
    registerYieldCheckpoint(controller.signal, () => { if (++turns === 5) controller.abort(reason); });
    await assert.rejects(zipFromCrlf(nativePattern("mixed", 140000), false, controller.signal, level), error => error === reason);
    assert.equal(turns, 5);
  });
}

test("zip -ll actual Shell cancellation closes source and preserves archive and namespace", async () => {
  const fs = await fixture();
  const before = await fs.readFile("/work/sample.zip");
  const names = (await fs.readdir("/work")).map(entry => entry.name).sort();
  const controller = new AbortController();
  let closed = false;
  const shell = new Shell({ fs, cwd: "/work" }).use(archiveCommands());
  const input = nativePattern("mixed", 140000);
  const stdin = (async function* () {
    try { yield input; }
    finally {
      closed = true;
      void setImmediate().then(() => controller.abort(false));
    }
  })();
  try {
    await assert.rejects(shell.exec("zip -qll sample.zip -", { stdin, signal: controller.signal }), error => error === false);
    assert.equal(closed, true);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
    assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), names);
    assert.equal((await shell.exec(":")).exitCode, 0);
  } finally { controller.abort(false); await shell.dispose(); }
});

const captures = JSON.parse(readFileSync(new URL("./fixtures/zip-to-crlf-infozip.json", import.meta.url), "utf8")) as { name: string; input: string; output: string }[];
for (const flag of ["-ll", "--from-crlf", "--from-c"]) {
  for (const method of ["-0", "-6"]) {
    test(`zip ${flag} ${method} converts CRLF and trailing Ctrl-Z`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/text", Buffer.from("a\r\nb\rc\n\x1a"));
      const result = await execute("zip", fs, ["-q", flag, method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout.toString(), "a\nb\rc\n");
      const archive = await readZipArchive(await fs.readFile("/work/out.zip"), settings({}), new AbortController().signal);
      assert.equal(archive.entries[0]!.size, 6);
      // Independently captured native CRC for the transformed six-byte payload.
      assert.equal(archive.entries[0]!.crc32, 0x0f28185c);
    });
  }
}
for (const method of ["-0", "-6"]) {
  for (const [input, output] of [["", ""], ["\r", "\r"], ["\r\r", "\r\r"], ["\n", "\n"], ["\x1a", "\x1a"], ["a\r", "a"], ["a\r\r\n", "a\r\n"], ["a\x1a\x1a", "a\x1a"], ["a\0\r\n", "a\0\r\n"]]) {
    test(`zip -ll ${method} native control ${Buffer.from(input!).toString("hex")}`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/text", Buffer.from(input!));
      assert.equal((await execute("zip", fs, ["-qll", method, "out.zip", "text"])).exitCode, 0);
      assert.equal((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout.toString(), output);
    });
  }
  for (const chunkSize of [1, 2, 7, 16382, 16383, 16384, 32768, 65535]) {
    test(`zip -ll ${method} owned stdin chunks ${chunkSize}`, async () => {
      const fs = await fixture();
      const input = Buffer.from("a\r\nb\r\rc\n\x1a");
      const reused = new Uint8Array(chunkSize);
      const stdin = (async function* () {
        for (let offset = 0; offset < input.length; offset += chunkSize) {
          const part = input.subarray(offset, offset + chunkSize);
          reused.set(part);
          yield reused.subarray(0, part.length);
        }
        reused.fill(0);
      })();
      assert.equal((await execute("zip", fs, ["-qll", method, "out.zip", "-"], {}, { stdin })).exitCode, 0);
      assert.equal((await execute("unzip", fs, ["-p", "out.zip", "-"])).stdout.toString(), "a\nb\r\rc\n");
    });
  }
}
for (const offset of [-1, 0, 1]) {
  test(`zip -ll STORE sentinel boundary ${offset}`, async () => {
    const fs = await fixture();
    const prefix = Buffer.alloc(16382 + offset, 65);
    await fs.writeFile("/work/text", Buffer.concat([prefix, Buffer.from("\rX\r\n\x1a")]));
    assert.equal((await execute("zip", fs, ["-qll0", "out.zip", "text"])).exitCode, 0);
    const output = (await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout;
    assert.deepEqual(output, Buffer.concat([prefix, Buffer.from(offset === 0 ? "X\n" : "\rX\n")]));
  });
}
for (const flags of [["-l", "-ll"], ["-ll", "-l"], ["-lll"]]) {
  test(`zip line conversion last flag wins ${flags}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/text", Buffer.from("a\r\nb\n"));
    assert.equal((await execute("zip", fs, ["-q", ...flags, "out.zip", "text"])).exitCode, 0);
    assert.equal((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout.toString(), flags.at(-1) === "-ll" ? "a\nb\n" : "a\r\r\nb\r\n");
  });
}
test("zip from CRLF cancellation and binary byte ownership", async () => {
  const { zipFromCrlf } = await import("../../src/commands/archive/zip/line-endings.js");
  const controller = new AbortController();
  controller.abort(false);
  for (const input of [Buffer.alloc(0), Buffer.from([0, 13, 10]), Buffer.from("a\r\n")]) {
    await assert.rejects(zipFromCrlf(input, false, controller.signal), error => error === false);
  }
  const binary = Buffer.from([0, 255, 13, 10]);
  assert.equal(await zipFromCrlf(binary, false, new AbortController().signal), binary);
});
test("zip -ll warns on binary DEFLATE, keeps STORE quiet", async () => {
  const fs = await fixture();
  for (const method of ["-0", "-6"]) {
    const result = await execute("zip", fs, ["-ll", method, `out${method}.zip`, "binary"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.includes("has binary so -ll ignored"), method === "-6");
    if (method === "-6") assert.equal(result.stdout.toString(), "  adding: binary\n\tzip warning: has binary so -ll ignored\n (stored 0%)\n");
  }
});
test("zip -ll warns on later binary and quiet suppresses conversion warnings", async () => {
  const fs = await fixture();
  const input = Buffer.concat([Buffer.alloc(65535, 65), Buffer.from([0, 255, 13, 10, 26])]);
  await fs.writeFile("/work/text", input);
  for (const quiet of [false, true]) {
    const result = await execute("zip", fs, [quiet ? "-qll6" : "-ll6", "out.zip", "text"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.includes("-ll used on binary file - corrupted?"), !quiet);
    if (quiet) assert.equal(result.stdout.length, 0);
    const extracted = await execute("unzip", fs, ["-p", "out.zip", "text"]);
    assert.equal(extracted.exitCode, 0, extracted.stderr);
    assert.deepEqual(extracted.stdout, Buffer.concat([input.subarray(0, 65537), Buffer.from([10])]));
  }
  const binary = Buffer.from([0, 255, 13, 10, 26]);
  const reused = Buffer.from(binary);
  const stdin = (async function* () { try { yield reused; } finally { reused.fill(0); } })();
  assert.equal((await execute("zip", fs, ["-qll6", "binary.zip", "-"], {}, { stdin })).exitCode, 0);
  assert.deepEqual((await execute("unzip", fs, ["-p", "binary.zip", "-"])).stdout, binary);
});
test("zip -ll converts later DEFLATE reads", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/text", Buffer.alloc(65536, 65));
  const result = await execute("zip", fs, ["-qll6", "out.zip", "text"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout, Buffer.alloc(65536, 65));
});
for (const method of ["-0", "-6"]) {
  const window = method === "-0" ? 16383 : 65535;
  for (const offset of [-1, 0, 1]) {
    test(`zip -ll ${method} binary detection window ${offset}`, async () => {
      const fs = await fixture();
      const input = Buffer.concat([Buffer.alloc(window + offset, 65), Buffer.from([0, 13, 10])]);
      await fs.writeFile("/work/text", input);
      const result = await execute("zip", fs, ["-qll", method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = (await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout;
      assert.deepEqual(output, offset < 0 ? input : Buffer.concat([input.subarray(0, -2), Buffer.from([10])]));
    });
  }
}
test("zip -ll preserves links, neighbors and suffix STORE selection", async () => {
  const fs = await fixture();
  await fs.symlink!("target\r\n", "/work/link");
  await fs.writeFile("/work/large.zip", Buffer.concat([Buffer.alloc(65536, 65), Buffer.from("\r\n")]));
  const before = (await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout;
  assert.equal((await execute("zip", fs, ["-qlly", "sample.zip", "link", "large.zip"])).exitCode, 0);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "link"])).stdout.toString(), "target\r\n");
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout, before);
  assert.equal((await execute("unzip", fs, ["-p", "sample.zip", "large.zip"])).stdout.length, 65537);
});
test("zip from CRLF observes cancellation between native reads", async () => {
  const { zipFromCrlf } = await import("../../src/commands/archive/zip/line-endings.js");
  const controller = new AbortController();
  const reason = new Error("cancel conversion");
  const pending = zipFromCrlf(Buffer.alloc(1_000_000, 65), true, controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});
for (const method of ["-0", "-6"]) {
  for (const capture of captures) {
    test(`zip -l ${method} native ${capture.name} payload`, async () => {
      const fs = await fixture();
      await fs.writeFile("/work/text", Buffer.from(capture.input, "hex"));
      const result = await execute("zip", fs, ["-ql", method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout, Buffer.from(capture.output, "hex"));
    });
  }
  const boundary = method === "-0" ? 8192 : 32768;
  for (const offset of [-1, 0, 1]) {
    test(`zip -l ${method} first binary buffer boundary ${offset}`, async () => {
      const fs = await fixture();
      const bytes = Buffer.concat([Buffer.alloc(boundary + offset, 65), Buffer.from([0, 10])]);
      await fs.writeFile("/work/text", bytes);
      const result = await execute("zip", fs, ["-ql", method, "out.zip", "text"]);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = offset < 0 ? bytes : Buffer.concat([bytes.subarray(0, -1), Buffer.from("\r\n")]);
      assert.deepEqual((await execute("unzip", fs, ["-p", "out.zip", "text"])).stdout, expected);
    });
  }
}
for (const flag of ["--to-crlf", "--to-c"]) {
  test(`zip ${flag} converts stdin payload`, async () => {
    const fs = await fixture();
    const result = await execute("zip", fs, ["-q", flag, "out.zip", "-"], {}, { stdin: toByteSource("a\nb\n") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await execute("unzip", fs, ["-p", "out.zip", "-"])).stdout.toString(), "a\r\nb\r\n");
  });
}
for (const limits of [{ maxEntryBytes: 3 }, { maxTotalBytes: 3 }]) {
  test(`zip -l rejects converted payload growth ${JSON.stringify(limits)}`, async () => {
    const fs = await fixture();
    await fs.writeFile("/work/text", Buffer.from("a\n\n"));
    const result = await execute("zip", fs, ["-ql", "out.zip", "text"], { limits });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /payload byte limit exceeded/);
    assert.equal((await fs.readdir("/work")).some(entry => entry.name === "out.zip"), false);
  });
}

test("zip -l preserves stored symlink targets", async () => {
  const fs = await fixture();
  await fs.symlink!("target\n", "/work/link");
  const result = await execute("zip", fs, ["-qly", "out.zip", "link"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await execute("unzip", fs, ["-p", "out.zip", "link"])).stdout.toString(), "target\n");
});

test("zip -l leaves unselected existing members unchanged", async () => {
  const fs = await fixture();
  await fs.writeFile("/work/text", Buffer.from("a\n"));
  const before = (await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout;
  assert.equal((await execute("zip", fs, ["-ql", "sample.zip", "text"])).exitCode, 0);
  assert.deepEqual((await execute("unzip", fs, ["-p", "sample.zip", "folder/data"])).stdout, before);
});

test("zip LF conversion rejects cancellation even for empty or binary input", async () => {
  const { zipToCrlf } = await import("../../src/commands/archive/zip/line-endings.js");
  const controller = new AbortController();
  controller.abort(false);
  for (const bytes of [Buffer.alloc(0), Buffer.from([0, 10]), Buffer.from("a\n")]) {
    await assert.rejects(zipToCrlf(bytes, false, 100, controller.signal), error => error === false);
  }
});
