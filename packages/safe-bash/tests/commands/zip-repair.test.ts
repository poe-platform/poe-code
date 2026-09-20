import assert from "node:assert/strict";
import test from "node:test";
import { archiveBytes, execute, fixture } from "./zip-standard-flags.helpers.js";
import { makeZipEntry, readZipArchive, writeZipArchive } from "../../src/commands/archive/zip-format.js";
import { repairZip } from "../../src/commands/archive/zip/repair.js";
import { Shell } from "../../src/shell/shell.js";
import { archiveCommands } from "../../src/commands/archive/index.js";
import { settings } from "../../src/commands/archive/internal.js";

const signal = new AbortController().signal;
test("FF verifies complete central metadata once at the total byte boundary", async () => {
  const bytes = new Uint8Array(await archiveBytes([
    { name: "good", body: Buffer.from("good") },
    { name: "bad", body: Buffer.from("bad!") }
  ]));
  const view = new DataView(bytes.buffer);
  const second = 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true);
  const payload = second + 30 + view.getUint16(second + 26, true) + view.getUint16(second + 28, true);
  bytes[payload] = bytes[payload]! ^ 255;
  const limits = { ...settings({}), maxTotalBytes: 8 };
  const result = await repairZip(bytes, "FF", limits, signal);
  assert.equal(result.partial, true);
  assert.deepEqual(result.archive.entries.map(entry => entry.name), ["good"]);
  await assert.rejects(repairZip(bytes, "F", limits, signal), /payload could not be verified/);
  await assert.rejects(repairZip(bytes, "FF", { ...limits, maxTotalBytes: 3 }, signal));
  const fs = await fixture(bytes);
  await fs.writeFile("/work/repaired.zip", Buffer.from("keep destination"));
  assert.equal((await execute("zip", fs, ["-F", "sample.zip", "-O", "repaired.zip"], { limits })).exitCode, 3);
  assert.equal(Buffer.from(await fs.readFile("/work/repaired.zip")).toString(), "keep destination");
  const command = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"], { limits });
  assert.equal(command.exitCode, 0, command.stderr);
  assert.ok(command.stdout.includes("partial recovery"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"], { limits })).exitCode, 0);
});
function directory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(bytes.length - 22 - Buffer.byteLength("archive comment\n") + 16, true);
}
test("unzip reads an unadjusted SFX without executing its prefix", async () => {
  const fs = await fixture(Buffer.concat([Buffer.from("echo PREFIX_EXECUTED\n"), await archiveBytes()]));
  const result = await execute("unzip", fs, ["-t", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(!result.stdout.includes("PREFIX_EXECUTED"));
});
test("zip -A preserves the SFX prefix and adjusts offsets", async () => {
  const prefix = Buffer.from("MZ inert prefix\n");
  const fs = await fixture(Buffer.concat([prefix, await archiveBytes()]));
  const result = await execute("zip", fs, ["-A", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const bytes = await fs.readFile("/work/sample.zip");
  assert.deepEqual(bytes.subarray(0, prefix.length), new Uint8Array(prefix));
  assert.equal((await readZipArchive(bytes, settings({}), signal, { prefix: true })).entries.length, 5);
});
for (const flag of ["-F", "-FF"]) test(`zip ${flag} repairs a missing EOCD to a separate output`, async () => {
  const original = await archiveBytes();
  const damaged = original.subarray(0, original.length - 22 - Buffer.byteLength("archive comment\n"));
  const fs = await fixture(damaged);
  const result = await execute("zip", fs, [flag, "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), damaged);
  assert.equal((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries.length, 5);
});
test("zip -FF recovers orphan local records without a central directory", async () => {
  const original = await archiveBytes([{ name: "a", body: Buffer.from("body") }]);
  const fs = await fixture(original.subarray(0, directory(original)));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
});
async function local(name: string, body: Uint8Array, descriptors = false, wide = false) {
  const limits = settings({});
  const entry = await makeZipEntry(name, body, { modified: new Date("2024-01-02T03:04:06Z"), mode: 0o100644, directory: false, symlink: false }, limits, signal, 0);
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, signal, descriptors, wide);
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  const central = wide ? Number(view.getBigUint64(end - 76 + 48, true)) : view.getUint32(end + 16, true);
  return bytes.subarray(0, central);
}
for (const flag of ["-F", "-FF", "--fix", "--fixfix"]) {
  test(`${flag} requires a separate output before mutating the source`, async () => {
    const damaged = await local("a", Buffer.from("payload"));
    const fs = await fixture(damaged);
    assert.equal((await execute("zip", fs, [flag, "sample.zip"])).exitCode, 16);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), damaged);
    assert.equal((await execute("zip", fs, [flag, "sample.zip", "-O", "sample.zip"])).exitCode, 16);
    await fs.symlink!("sample.zip", "/work/alias.zip");
    assert.notEqual((await execute("zip", fs, [flag, "sample.zip", "-O", "alias.zip"])).exitCode, 0);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), damaged);
  });
}
for (const descriptors of [false, true]) for (const wide of [false, true]) test(`FF validates local descriptor=${descriptors} ZIP64=${wide}`, async () => {
  const fs = await fixture(await local("a", Buffer.from("payload"), descriptors, wide));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
});
test("FF skips corrupt payloads and duplicates with an explicit partial warning", async () => {
  const good = await local("a", Buffer.from("good"));
  const corrupt = new Uint8Array(await local("bad", Buffer.from("bad")));
  corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 255;
  const fs = await fixture(Buffer.concat([good, corrupt, good]));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.ok(result.stdout.includes("partial recovery"));
  assert.deepEqual((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries.map(entry => entry.name), ["a"]);
});
test("FF does not promote signatures inside a corrupt bounded payload", async () => {
  const nested = await local("embedded", Buffer.from("nested"));
  const outer = new Uint8Array(await local("outer", nested));
  outer[14] = outer[14]! ^ 255;
  const fs = await fixture(Buffer.concat([outer, await local("real", Buffer.from("real"))]));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.deepEqual((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries.map(entry => entry.name), ["real"]);
});
test("FF skips malformed extras in a bounded local record and recovers later members", async () => {
  const nested = await local("embedded", Buffer.from("nested"));
  const damaged = new Uint8Array(await local("damaged", nested));
  const view = new DataView(damaged.buffer);
  const extra = 30 + view.getUint16(26, true);
  assert.ok(view.getUint16(28, true) >= 4);
  view.setUint16(extra + 2, 65535, true);
  const bytes = Buffer.concat([await local("before", Buffer.from("good")), damaged, await local("after", Buffer.from("good"))]);
  await assert.rejects(readZipArchive(bytes, settings({}), signal));
  await assert.rejects(repairZip(bytes, "F", settings({}), signal));
  const recovered = await repairZip(bytes, "FF", settings({}), signal);
  assert.equal(recovered.partial, true);
  assert.deepEqual(recovered.archive.entries.map(entry => entry.name), ["before", "after"]);
  const fs = await fixture(bytes);
  const result = await execute("zip", fs, ["-q", "-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("partial recovery"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), new Uint8Array(bytes));
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
  assert.deepEqual((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries.map(entry => entry.name), ["before", "after"]);
});
for (const profile of ["empty", "descriptor", "zip64", "truncated"] as const) test(`FF malformed extra boundary control: ${profile}`, async () => {
  const body = profile === "empty" ? new Uint8Array() : await local("embedded", Buffer.from("nested"));
  const damaged = new Uint8Array(await local("damaged", body, profile === "descriptor", profile === "zip64"));
  const view = new DataView(damaged.buffer);
  const extra = 30 + view.getUint16(26, true);
  view.setUint16(extra + 2, 65535, true);
  if (profile === "truncated") view.setUint32(18, damaged.length + 4096, true);
  const bytes = Buffer.concat([await local("before", Buffer.from("good")), damaged, await local("after", Buffer.from("good"))]);
  const recovered = await repairZip(bytes, "FF", settings({}), signal);
  assert.equal(recovered.partial, true);
  assert.deepEqual(recovered.archive.entries.map(entry => entry.name), profile === "empty" ? ["before", "after"] : ["before"]);
});
test("FF scan cancellation with malformed extras preserves source and destination", async () => {
  const damaged = new Uint8Array(await local("damaged", new Uint8Array()));
  const view = new DataView(damaged.buffer);
  view.setUint16(32 + view.getUint16(26, true), 65535, true);
  const bytes = Buffer.concat([damaged, Buffer.alloc(32768, 77), await local("after", Buffer.from("good"))]);
  const fs = await fixture(bytes);
  await fs.writeFile("/work/repaired.zip", Buffer.from("keep destination"));
  const controller = new AbortController(), reason = new Error("cancel malformed-extra recovery");
  const pending = execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"], {}, { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 0);
  await assert.rejects(pending, error => error === reason);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), new Uint8Array(bytes));
  assert.equal(Buffer.from(await fs.readFile("/work/repaired.zip")).toString(), "keep destination");
});
test("FF rejects a fake descriptor inside payload before finding the verified descriptor", async () => {
  const fake = new Uint8Array(16);
  const view = new DataView(fake.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(8, 0, true);
  const fs = await fixture(await local("a", Buffer.concat([fake, Buffer.from("body")]), true));
  const bytes = await fs.readFile("/work/sample.zip");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const offset of [14, 18, 22]) header.setUint32(offset, 0, true);
  await fs.writeFile("/work/sample.zip", bytes);
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries[0]!.size, fake.length + 4);
});
test("strict reads reject gaps and trailing data; explicit FF recovers verified locals", async () => {
  const bytes = Buffer.concat([await local("a", Buffer.from("a")), Buffer.from("gap"), await local("b", Buffer.from("b")), Buffer.from("trailing")]);
  await assert.rejects(readZipArchive(bytes, settings({}), signal));
  const result = await repairZip(bytes, "FF", settings({}), signal);
  assert.deepEqual(result.archive.entries.map(entry => entry.name), ["a", "b"]);
});
for (const mode of ["F", "FF"] as const) test(`${mode} cancellation and exact work limits preserve outputs`, async () => {
  const bytes = await local("a", Buffer.from("payload"));
  await assert.rejects(repairZip(bytes, mode, { ...settings({}), maxPatternSteps: 0 }, signal), /work limit/);
  const controller = new AbortController();
  const reason = new Error("stop recovery"); controller.abort(reason);
  await assert.rejects(repairZip(bytes, mode, settings({}), controller.signal), error => error === reason);
  const fs = await fixture(bytes);
  await fs.writeFile("/work/repaired.zip", Buffer.from("keep destination"));
  const result = await execute("zip", fs, [`-${mode}`, "sample.zip", "-O", "repaired.zip"], { limits: { maxPatternSteps: 1 } });
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), bytes);
  assert.equal(Buffer.from(await fs.readFile("/work/repaired.zip")).toString(), "keep destination");
});
test("recovered names retain traversal protections", async () => {
  const bytes = new Uint8Array(await local("safe", Buffer.from("data")));
  bytes.set(Buffer.from("../x"), 30);
  await assert.rejects(repairZip(bytes, "FF", settings({}), signal), /no verified members/);
});
test("Shell and command SDK recovery share output and status", async () => {
  const bytes = await local("a", Buffer.from("payload"));
  const directFs = await fixture(bytes), shellFs = await fixture(bytes);
  const direct = await execute("zip", directFs, ["--fixfix", "sample.zip", "--output-file", "repaired.zip"]);
  const shell = new Shell({ fs: shellFs, cwd: "/work" }).use(archiveCommands());
  const result = await shell.exec("zip --fixfix sample.zip --output-file repaired.zip");
  assert.equal(result.exitCode, direct.exitCode);
  assert.deepEqual(await shellFs.readFile("/work/repaired.zip"), await directFs.readFile("/work/repaired.zip"));
});
for (const wide of [false, true]) test(`SFX adjustment is idempotent for ZIP64=${wide}`, async () => {
  const original = await archiveBytes(undefined, entries => { if (wide) for (const entry of entries) entry.zip64 = true; });
  const fs = await fixture(Buffer.concat([Buffer.from("MZ inert\n"), original]));
  assert.equal((await execute("unzip", fs, ["-t", "sample.zip"])).exitCode, 0);
  const result = await execute("zip", fs, ["--adjust-sfx", "sample.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  const once = await fs.readFile("/work/sample.zip");
  assert.equal((await execute("zip", fs, ["-A", "sample.zip"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), once);
  assert.equal((await execute("unzip", fs, ["-t", "sample.zip"])).exitCode, 0);
});
test("FF retains verified central symlink metadata and extraction protections", async () => {
  const original = await archiveBytes([{ name: "link", body: Buffer.from("../../outside"), symlink: true }]);
  const fs = await fixture(original.subarray(0, original.length - 22 - Buffer.byteLength("archive comment\n")));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await readZipArchive(await fs.readFile("/work/repaired.zip"), settings({}), signal)).entries[0]!.symlink, true);
  assert.notEqual((await execute("unzip", fs, ["repaired.zip"])).exitCode, 0);
  await assert.rejects(fs.stat("/outside"), { code: "ENOENT" });
});
for (const flag of ["-F", "-FF"]) for (const prefix of ["", "MZ prefix\n"]) for (const cut of [1, 22, 40]) test(`${flag} repairs truncated EOCD cut=${cut} prefix=${prefix.length}`, async () => {
  const original = await archiveBytes([{ name: "a", body: Buffer.from("payload") }]);
  const damaged = Buffer.concat([Buffer.from(prefix), original.subarray(0, original.length - cut)]);
  const fs = await fixture(damaged);
  const result = await execute("zip", fs, [flag, "sample.zip", "-O", "repaired.zip"]);
  if (flag === "-F" && cut === 40) {
    assert.equal(result.exitCode, 3, result.stdout.toString() + result.stderr);
    assert.deepEqual(await fs.readFile("/work/sample.zip"), new Uint8Array(damaged));
    return;
  }
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), new Uint8Array(damaged));
});
test("F refuses missing central records; FF labels truncated local salvage partial", async () => {
  const damaged = Buffer.concat([await local("a", Buffer.from("good")), (await local("b", Buffer.from("truncated"))).subarray(0, 34)]);
  const fs = await fixture(damaged);
  assert.equal((await execute("zip", fs, ["-F", "sample.zip", "-O", "repaired.zip"])).exitCode, 3);
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.ok(result.stdout.includes("partial recovery"));
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
});
test("F rejects overlapping central references and FF never adopts overlapping payload members", async () => {
  const original = new Uint8Array(await archiveBytes([{ name: "a", body: Buffer.from("good") }, { name: "a", body: Buffer.from("good") }]));
  const view = new DataView(original.buffer);
  const central = directory(original);
  const second = central + 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  view.setUint32(second + 42, view.getUint32(central + 42, true), true);
  await assert.rejects(readZipArchive(original, settings({}), signal), /overlapping/);
  await assert.rejects(repairZip(original, "F", settings({}), signal), /central directory could not be verified/);
  const result = await repairZip(original, "FF", settings({}), signal);
  assert.equal(result.partial, true);
  assert.equal(result.archive.entries.length, 1);
});
for (const mode of ["F", "FF"] as const) test(`${mode} cancels during cooperative scanning`, async () => {
  const controller = new AbortController();
  const reason = new Error("cancel scan");
  const bytes = Buffer.concat([Buffer.alloc(16384, 77), await local("a", Buffer.from("body"))]);
  const pending = repairZip(bytes, mode, settings({}), controller.signal);
  setTimeout(() => controller.abort(reason), 0);
  await assert.rejects(pending, error => error === reason);
});
test("FF enforces exact entry, total, path and member boundaries", async () => {
  const bytes = await local("a", Buffer.from("body"));
  const exact = { ...settings({}), maxEntryBytes: 4, maxTotalBytes: 4, maxPathBytes: 1, maxMembers: 1 };
  assert.equal((await repairZip(bytes, "FF", exact, signal)).archive.entries.length, 1);
  await assert.rejects(repairZip(bytes, "FF", { ...exact, maxEntryBytes: 3 }, signal), /no verified members/);
  await assert.rejects(repairZip(bytes, "FF", { ...exact, maxTotalBytes: 3 }, signal), /total byte limit/);
  await assert.rejects(repairZip(Buffer.concat([bytes, bytes]), "FF", exact, signal), /candidate limit|total byte limit/);
});
test("A rejects corrupt payloads without changing the SFX", async () => {
  const original = new Uint8Array(await archiveBytes([{ name: "a", body: Buffer.from("body") }]));
  const view = new DataView(original.buffer);
  const payload = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  original[payload] = original[payload]! ^ 255;
  const fs = await fixture(Buffer.concat([Buffer.from("MZ prefix\n"), original]));
  const before = await fs.readFile("/work/sample.zip");
  assert.notEqual((await execute("zip", fs, ["-A", "sample.zip"])).exitCode, 0);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
});
test("FF refuses ambiguous unknown-size descriptors and their embedded members", async () => {
  const fake = new Uint8Array(16); new DataView(fake.buffer).setUint32(0, 0x08074b50, true);
  const body = Buffer.concat([fake, await local("embedded", Buffer.from("nested")), Buffer.from("tail")]);
  const bytes = new Uint8Array(await local("outer", body, true));
  const view = new DataView(bytes.buffer);
  for (const offset of [14, 18, 22]) view.setUint32(offset, 0, true);
  await assert.rejects(repairZip(bytes, "FF", settings({}), signal), /no verified members/);
});
for (const method of ["deflate", "bzip2"] as const) for (const descriptors of [false, true]) test(`FF verifies ${method} payload descriptor=${descriptors}`, async () => {
  const entry = await makeZipEntry("data", Buffer.from("compressed payload\n".repeat(64)), { modified: new Date("2024-01-02T03:04:06Z"), mode: 0o100644, directory: false, symlink: false }, settings({}), signal, 6, true, method);
  const bytes = await writeZipArchive({ entries: [entry], comment: new Uint8Array() }, settings({}), signal, descriptors);
  const central = new DataView(bytes.buffer).getUint32(bytes.length - 6, true);
  const fs = await fixture(bytes.subarray(0, central));
  const result = await execute("zip", fs, ["-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal((await execute("unzip", fs, ["-t", "repaired.zip"])).exitCode, 0);
});
for (const wide of [false, true]) test(`FF validates unsigned descriptors ZIP64=${wide}`, async () => {
  const bytes = await local("a", Buffer.from("payload"), true, wide);
  const descriptor = bytes.length - (wide ? 24 : 16);
  const unsigned = Buffer.concat([bytes.subarray(0, descriptor), bytes.subarray(descriptor + 4)]);
  assert.equal((await repairZip(unsigned, "FF", settings({}), signal)).archive.entries[0]!.size, 7);
});
test("F recovers ZIP64 members after SFX EOCD loss", async () => {
  const bytes = await archiveBytes(undefined, entries => { for (const entry of entries) entry.zip64 = true; });
  const damaged = Buffer.concat([Buffer.from("MZ prefix\n"), bytes.subarray(0, bytes.length - 22 - Buffer.byteLength("archive comment\n"))]);
  const recovered = await repairZip(damaged, "F", settings({}), signal);
  assert.equal(recovered.archive.entries.length, 5);
});
test("empty archives and inert empty SFX are repairable", async () => {
  const bytes = await writeZipArchive({ entries: [], comment: new Uint8Array() }, settings({}), signal);
  for (const mode of ["F", "FF"] as const) {
    assert.equal((await repairZip(bytes, mode, settings({}), signal)).archive.entries.length, 0);
    assert.equal((await repairZip(Buffer.concat([Buffer.from("MZ inert"), bytes]), mode, settings({}), signal)).archive.entries.length, 0);
  }
});
for (const flag of ["-A", "-F", "-FF"]) test(`${flag} cancellation during stage acquisition drains owned cleanup`, async () => {
  const bytes = await archiveBytes([{ name: "a", body: Buffer.from("body") }]);
  const fs = await fixture(Buffer.concat([Buffer.from("MZ inert\n"), bytes]));
  await fs.writeFile("/work/repaired.zip", Buffer.from("preserve destination"));
  const before = await fs.readFile("/work/sample.zip");
  const controller = new AbortController(), reason = new Error("cancel staged repair");
  const guarded = new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === "createStagedFile") return async (...args: unknown[]) => {
      const stage = await Reflect.apply(value, target, args);
      controller.abort(reason);
      return stage;
    };
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await assert.rejects(execute("zip", guarded, [flag, "sample.zip", "-O", "repaired.zip"], {}, { signal: controller.signal }), error => error === reason);
  assert.deepEqual(await fs.readFile("/work/sample.zip"), before);
  assert.equal(Buffer.from(await fs.readFile("/work/repaired.zip")).toString(), "preserve destination");
  assert.ok((await fs.readdir("/work")).every(entry => !entry.name.startsWith(".zip-")));
});
test("SFX reading observes exact archive bounds", async () => {
  const bytes = Buffer.concat([Buffer.from("MZ inert\n"), await archiveBytes()]);
  assert.equal((await readZipArchive(bytes, { ...settings({}), maxArchiveBytes: bytes.length }, signal, { prefix: true })).entries.length, 5);
  await assert.rejects(readZipArchive(bytes, { ...settings({}), maxArchiveBytes: bytes.length - 1 }, signal, { prefix: true }), /archive byte limit/);
});
test("an internal gap remains invalid for ordinary parsing and F; FF salvages locals", async () => {
  const bytes = await archiveBytes([{ name: "a", body: Buffer.from("a") }, { name: "b", body: Buffer.from("b") }]);
  const view = new DataView(bytes.buffer);
  const split = 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true);
  const gap = Buffer.from("GAP");
  const altered = Buffer.concat([bytes.subarray(0, split), gap, bytes.subarray(split)]);
  const output = new DataView(altered.buffer, altered.byteOffset, altered.byteLength);
  const central = directory(bytes) + gap.length;
  const second = central + 46 + output.getUint16(central + 28, true) + output.getUint16(central + 30, true) + output.getUint16(central + 32, true);
  output.setUint32(second + 42, output.getUint32(second + 42, true) + gap.length, true);
  output.setUint32(altered.length - 22 - Buffer.byteLength("archive comment\n") + 16, central, true);
  await assert.rejects(readZipArchive(altered, settings({}), signal, { prefix: true }), /gaps/);
  await assert.rejects(repairZip(altered, "F", settings({}), signal), /central directory could not be verified/);
  assert.deepEqual((await repairZip(altered, "FF", settings({}), signal)).archive.entries.map(entry => entry.name), ["a", "b"]);
});
test("trailing bytes require explicit repair", async () => {
  const bytes = Buffer.concat([await archiveBytes(), Buffer.from("trailing junk")]);
  await assert.rejects(readZipArchive(bytes, settings({}), signal, { prefix: true }), /missing end/);
  for (const mode of ["F", "FF"] as const) assert.equal((await repairZip(bytes, mode, settings({}), signal)).archive.entries.length, 5);
});
test("recovery does not mistake a complete embedded archive for an SFX", async () => {
  const embedded = await archiveBytes([{ name: "embedded", body: Buffer.from("nested") }]);
  const bytes = await local("outer", embedded);
  await assert.rejects(repairZip(bytes, "F", settings({}), signal), /central directory could not be verified/);
  const recovered = await repairZip(bytes, "FF", settings({}), signal);
  assert.deepEqual(recovered.archive.entries.map(entry => entry.name), ["outer"]);
});
test("local-only recovery never promotes an access timestamp to modification time", async () => {
  const bytes = new Uint8Array(await local("a", Buffer.from("body")));
  const view = new DataView(bytes.buffer);
  const extra = 30 + view.getUint16(26, true);
  assert.equal(view.getUint16(extra, true), 0x5455);
  bytes[extra + 4] = 2;
  view.setUint32(extra + 5, 0, true);
  const recovered = await repairZip(bytes, "FF", settings({}), signal);
  assert.equal(recovered.archive.entries[0]!.modified.getFullYear(), 2024);
});
for (const flag of ["-A", "-F", "-FF"]) test(`${flag} honors quiet progress`, async () => {
  const fs = await fixture(Buffer.concat([Buffer.from("MZ inert\n"), await archiveBytes()]));
  const result = await execute("zip", fs, ["-q", flag, "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.equal(result.stdout.length, 0);
});
test("quiet salvage keeps partial-recovery warnings visible", async () => {
  const bad = new Uint8Array(await local("bad", Buffer.from("bad"))); bad[14] = bad[14]! ^ 255;
  const fs = await fixture(Buffer.concat([await local("good", Buffer.from("good")), bad]));
  const result = await execute("zip", fs, ["-q", "-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr);
  assert.ok(result.stdout.includes("partial recovery"));
  assert.ok(!result.stdout.includes("Fix archive"));
});

for (const length of [4, 14, 29]) test(`FF labels a truncated orphan local header of ${length} bytes partial`, async () => {
  const good = await local("good", Buffer.from("good"));
  const damaged = Buffer.concat([good, (await local("lost", Buffer.from("lost"))).subarray(0, length)]);
  const recovered = await repairZip(damaged, "FF", settings({}), signal);
  assert.deepEqual(recovered.archive.entries.map(entry => entry.name), ["good"]);
  assert.equal(recovered.partial, true);
  const fs = await fixture(damaged);
  const result = await execute("zip", fs, ["-q", "-FF", "sample.zip", "-O", "repaired.zip"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("partial recovery"));
  assert.deepEqual(await fs.readFile("/work/sample.zip"), new Uint8Array(damaged));
});
