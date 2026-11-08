import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import upstream from "./fixtures/zip-upstream-boundaries.json" with { type: "json" };
import { collectBytes } from "../../src/contracts/index.js";
import { settings } from "../../src/commands/archive/internal.js";
import { decodeZipEntry, readZipArchive } from "../../src/commands/archive/zip-format.js";
import { execute, fixture } from "./zip-standard-flags.helpers.js";

const limits = settings({});
const signal = new AbortController().signal;

for (const vector of upstream.cases) {
  test(`ZIP independent ${vector.source}: ${vector.name}`, async () => {
    const bytes = Buffer.from(vector.base64, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), vector.sha256);
    const controller = new AbortController();
    const reason = new Error(vector.name);
    controller.abort(reason);
    await assert.rejects(readZipArchive(bytes, limits, controller.signal), error => error === reason);
    if (vector.expect === "reject") {
      await assert.rejects(readZipArchive(bytes, limits, signal));
      const fs = await fixture(bytes);
      const result = await execute("unzip", fs, ["-o", "sample.zip", "-d", "output"]);
      assert.equal(result.exitCode, 2);
      await assert.rejects(fs.lstat("/work/output"), { code: "ENOENT" });
    } else {
      const archive = await readZipArchive(bytes, limits, signal);
      assert.equal(archive.entries.length, 1);
      const expected = Buffer.from(vector.payloadBase64!, "base64");
      assert.deepEqual(Buffer.from(await collectBytes(decodeZipEntry(archive.entries[0]!, limits, signal), { maxBytes: limits.maxEntryBytes })), expected);
      assert.equal((await readZipArchive(bytes, { ...limits, maxArchiveBytes: bytes.length }, signal)).entries.length, 1);
      await assert.rejects(readZipArchive(bytes, { ...limits, maxArchiveBytes: bytes.length - 1 }, signal), /archive byte limit/);
      // Go TestUnderSize changes the reader's advertised size, not the fixture.
      await assert.rejects(collectBytes(decodeZipEntry({ ...archive.entries[0]!, size: 1 }, limits, signal), { maxBytes: limits.maxEntryBytes }));
      for (const cut of [0, 1, 21, bytes.length - 1]) await assert.rejects(readZipArchive(bytes.subarray(0, cut), limits, signal));
    }
  });
}

function random(seed: number) {
  let state = seed;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}

interface Case { flags: string[]; body: Buffer; widths: number[] }

async function roundTrip(input: Case) {
  const fs = await fixture();
  const slab = Buffer.alloc(Math.max(...input.widths));
  let closed = false;
  const stdin = (async function* () {
    try {
      let part = 0;
      for (let offset = 0; offset < input.body.length;) {
        const length = Math.min(input.widths[part++ % input.widths.length]!, input.body.length - offset);
        slab.set(input.body.subarray(offset, offset + length));
        yield slab.subarray(0, length);
        slab.fill(255);
        offset += length;
      }
    } finally { closed = true; slab.fill(255); }
  })();
  const result = await execute("zip", fs, ["-q", ...input.flags, "out.zip", "-"], {}, { stdin });
  if (input.flags.includes("-ll") && input.flags.includes("bzip2")) {
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /from-crlf .* native read profile unsupported/);
    await assert.rejects(fs.lstat("/work/out.zip"), { code: "ENOENT" });
    return;
  }
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(closed, true);
  const extracted = await execute("unzip", fs, ["-p", "out.zip", "-"]);
  assert.equal(extracted.exitCode, 0, extracted.stderr);
  // Small ASCII fixtures deliberately avoid native conversion-window heuristics.
  const text = input.body.toString("ascii");
  const expected = input.flags.includes("-ll") ? text.split("\r\n").join("\n") : text;
  assert.deepEqual(extracted.stdout, Buffer.from(expected));
  const bytes = Buffer.from(await fs.readFile("/work/out.zip"));
  const archive = await readZipArchive(bytes, limits, signal);
  assert.equal(archive.entries.length, 1);
  // Mutate record structure independently of format-writing helpers.
  const central = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
  const end = bytes.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  assert.ok(central > 0 && end > central);
  for (const offset of [0, central, end]) {
    const damaged = Buffer.from(bytes);
    damaged[offset] = 0;
    await assert.rejects(readZipArchive(damaged, limits, signal));
  }
  const wrongOffset = Buffer.from(bytes);
  wrongOffset.writeUInt32LE(bytes.length + 1, central + 42);
  await assert.rejects(readZipArchive(wrongOffset, limits, signal));
  for (const field of ["name", "metadata-length", "directory-offset", "comment-length", "flags"] as const) {
    const damaged = Buffer.from(bytes);
    if (field === "name") damaged[30] = damaged[30]! ^ 1;
    if (field === "metadata-length") damaged.writeUInt16LE(65535, central + 28);
    if (field === "directory-offset") damaged.writeUInt32LE(1, end + 16);
    if (field === "comment-length") damaged.writeUInt16LE(1, end + 20);
    if (field === "flags") { damaged.writeUInt16LE(damaged.readUInt16LE(6) | 16, 6); damaged.writeUInt16LE(damaged.readUInt16LE(central + 8) | 16, central + 8); }
    await assert.rejects(readZipArchive(damaged, limits, signal), field);
  }
  const corrupt = { ...archive.entries[0]!, data: Uint8Array.from(archive.entries[0]!.data) };
  corrupt.data[0] = corrupt.data[0]! ^ 1;
  await assert.rejects(collectBytes(decodeZipEntry(corrupt, limits, signal), { maxBytes: limits.maxEntryBytes }));
  // Raw comments and an embedded EOCD signature must not change member bytes.
  const comment = Buffer.from([0, 255, 80, 75, 5, 6]);
  const commented = Buffer.concat([bytes, comment]);
  commented.writeUInt16LE(comment.length, end + 20);
  const restored = await readZipArchive(commented, limits, signal);
  assert.deepEqual(Buffer.from(restored.comment), comment);
  assert.deepEqual(Buffer.from(await collectBytes(decodeZipEntry(restored.entries[0]!, limits, signal), { maxBytes: limits.maxEntryBytes })), extracted.stdout);
}

// Only runs after a failure. Deletion reduces options/body while preserving the
// failing assertion site. It is bounded and never turns a failure into a pass.
async function minimize(input: Case): Promise<Case> {
  let current = input;
  const signature = (error: unknown) => JSON.stringify([String(error).split("\n")[0], error instanceof Error ? error.stack?.split("\n").find(line => line.includes("at roundTrip (")) : undefined]);
  let failure = "";
  try { await roundTrip(input); } catch (error) { failure = signature(error); }
  const fails = async (candidate: Case) => { try { await roundTrip(candidate); return false; } catch (error) { return signature(error) === failure; } };
  // Keep the method option/value pair atomic and fixed during minimization.
  for (let index = 2; index < current.flags.length;) {
    const candidate = { ...current, flags: current.flags.filter((_, at) => at !== index) };
    if (await fails(candidate)) current = candidate; else index++;
  }
  for (let width = Math.floor(current.body.length / 2); width >= 1; width = Math.floor(width / 2)) {
    for (let offset = 0; offset + width <= current.body.length;) {
      const candidate = { ...current, body: Buffer.concat([current.body.subarray(0, offset), current.body.subarray(offset + width)]) };
      if (candidate.body.length && await fails(candidate)) current = candidate; else offset += width;
    }
  }
  if (await fails({ ...current, widths: [1] })) current = { ...current, widths: [1] };
  return current;
}

for (const seed of [0x5a17, 0xc0ffee]) {
  test(`ZIP bounded generated option × mutation × partition seed=${seed}`, async () => {
    const next = random(seed);
    for (const method of ["store", "deflate", "bzip2", "lzma"]) for (const wide of ["-fz", "-fz-"]) for (const descriptor of [[], ["-fd"]]) for (const conversion of [[], ["-ll"]]) {
      const body = Buffer.from("ASCII\r\nline\n".repeat(1 + next() % 12) + "end");
      for (const widths of [[1], [512], [1, 2 + next() % 13, 37]]) {
        const input = { flags: ["-Z", method, wide, ...descriptor, ...conversion], body, widths };
        try { await roundTrip(input); } catch (error) {
          const counterexample = await minimize(input);
          assert.fail(`seed=${seed} minimized=${JSON.stringify({ flags: counterexample.flags, bodyHex: counterexample.body.toString("hex"), widths: counterexample.widths })}; ${String(error)}`);
        }
      }
    }
  });
}

for (const method of ["store", "deflate", "bzip2", "lzma"]) for (const wide of ["-fz", "-fz-"]) for (const descriptor of [[], ["-fd"]]) for (const conversion of [[], ["-ll"]]) {
  // Refused profiles never acquire input; their no-publication controls are above.
  if (method === "bzip2" && conversion.length) continue;
  test(`ZIP generated cancellation ${method} ${wide} ${descriptor} ${conversion} closes input without publication`, async () => {
    const fs = await fixture();
    const controller = new AbortController();
    const reason = new Error("generated source cancellation");
    let closed = false;
    const stdin = (async function* () {
      try { yield Buffer.from("first"); controller.abort(reason); yield Buffer.from("last"); }
      finally { closed = true; }
    })();
    await assert.rejects(execute("zip", fs, ["-q", "-Z", method, wide, ...descriptor, ...conversion, "out.zip", "-"], {}, { stdin, signal: controller.signal }), error => error === reason);
    assert.equal(closed, true);
    await assert.rejects(fs.lstat("/work/out.zip"), { code: "ENOENT" });
  });
}
