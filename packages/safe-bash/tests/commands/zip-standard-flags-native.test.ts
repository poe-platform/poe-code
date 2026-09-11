import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { execute, fixture, readOnlyArchive } from "./zip-standard-flags.helpers.js";

interface Observation {
  exitCode: number;
  stdout: number;
  stderr: number;
}

interface CapturedCase {
  args: string[];
  observation: Observation;
}

interface Snapshot {
  schemaVersion: number;
  profile: { env: Record<string, string>; versions: Record<"zip" | "unzip", { exitCode: number; stdout: string; stderr: string }> };
  blobs: { sha256: string; base64: string }[];
  groups: {
    zip: (CapturedCase & { archive?: { name: string; bytes: number; stream: CapturedCase } })[];
    selection: { archive: number; cases: CapturedCase[]; namespace: { root: string[]; folder: string[] } };
    failures: { missing: CapturedCase[]; empty: CapturedCase & { archive: number }; crc: (CapturedCase & { archive: number; member: string })[] };
  };
}

const snapshot = createRequire(import.meta.url)("./fixtures/zip-standard-flags-infozip.json") as Snapshot;
assert.equal(snapshot.schemaVersion, 1);
const capturedBytes = snapshot.blobs.map(blob => {
  const bytes = Buffer.from(blob.base64, "base64");
  assert.equal(bytes.toString("base64"), blob.base64);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), blob.sha256);
  return bytes;
});

function observation(record: Observation) {
  assert.ok(Number.isInteger(record.exitCode) && record.exitCode >= 0);
  assert.ok(Number.isInteger(record.stdout) && record.stdout >= 0 && record.stdout < capturedBytes.length);
  assert.ok(Number.isInteger(record.stderr) && record.stderr >= 0 && record.stderr < capturedBytes.length);
  return { exitCode: record.exitCode, stdout: capturedBytes[record.stdout]!, stderr: capturedBytes[record.stderr]!.toString() };
}

test("Info-ZIP 3.0 quiet create/update, grouped flags, diagnostics and exit statuses", async context => {
  assert.deepEqual(snapshot.profile.env, { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" });
  for (const [command, version] of [["zip", "Zip 3.0"], ["unzip", "UnZip 6.00"]] as const) {
    const captured = snapshot.profile.versions[command];
    assert.equal(captured.exitCode, 0);
    assert.equal(captured.stderr, "");
    assert.ok(captured.stdout.includes(version));
    context.diagnostic(`Captured oracle: ${captured.stdout.split("\n").find(line => line.includes(version))!}`);
  }
  const fs = await fixture();
  const cases = [
    ["-q", "output.zip", "binary"],
    ["-q", "output.zip", "folder/data"],
    ["-qr", "recursive.zip", "folder"],
    ["-rq", "reverse.zip", "folder"],
    ["after.zip", "binary", "-q"],
    ["-q", "mixed.zip", "missing", "binary"],
    ["-q", "absent.zip", "missing"],
    ["-q", "output.zip"],
    ["-qr", "absent.zip", "missing"],
    ["-q", "duplicate.zip", "binary", "./binary"],
  ];
  assert.equal(snapshot.groups.zip.length, cases.length);
  for (const [index, args] of cases.entries()) {
    const captured = snapshot.groups.zip[index]!;
    assert.deepEqual(captured.args, args);
    const expected = observation(captured.observation);
    assert.deepEqual(await execute("zip", fs, args), expected, JSON.stringify(args));
    if (expected.exitCode === 0) {
      const name = args.find(argument => argument.endsWith(".zip"))!;
      assert.ok(captured.archive);
      assert.equal(captured.archive.name, name);
      assert.deepEqual(captured.archive.stream.args, ["-p", name]);
      const payload = observation(captured.archive.stream.observation);
      assert.deepEqual(await execute("unzip", fs, ["-p", name]), payload, name);
      await fs.writeFile("/work/native.zip", capturedBytes[captured.archive.bytes]!);
      assert.deepEqual(await execute("unzip", fs, ["-p", "native.zip"]), payload, `native writer: ${name}`);
    }
  }
});

test("Info-ZIP 6.00 raw bytes, member selection and -p/-l/-o/-d precedence", async () => {
  const bytes = capturedBytes[snapshot.groups.selection.archive]!;
  const observed = readOnlyArchive(await fixture(bytes));
  const flags = [["-p"], ["-pp"], ["-lp"], ["-pl"], ["-p", "-l"], ["-l", "-p"], ["-op"], ["-po"], ["-p", "-d", "absent/path"], ["-plodabsent/path"]];
  const selections = [[], ["binary"], ["folder/*", "binary"], ["binary", "binary"], ["b?n[aeiou]ry"], ["empty"], ["folder/"], ["link"], ["missing"], ["binary", "missing"]];
  assert.equal(snapshot.groups.selection.cases.length, 100);
  let index = 0;
  for (const options of flags) for (const selection of selections) {
    const args = [...options, "sample.zip", ...selection];
    const captured = snapshot.groups.selection.cases[index++]!;
    assert.deepEqual(captured.args, args);
    assert.deepEqual(await execute("unzip", observed.fs, args), observation(captured.observation), JSON.stringify(args));
  }
  assert.equal(index, 100);
  assert.deepEqual(snapshot.groups.selection.namespace, { root: ["binary", "folder", "sample.zip"], folder: ["data"] });
  assert.ok(observed.calls.every(call => call.path === "/work/sample.zip"));
});

test("Info-ZIP 6.00 missing/empty archives and CRC failure preserve stream bytes and status", async () => {
  const fs = await fixture();
  const missing = snapshot.groups.failures.missing;
  assert.equal(missing.length, 3);
  for (const [index, flags] of [["-p"], ["-pl"], ["-p", "-d", "absent"]].entries()) {
    const args = [...flags, "missing.zip"];
    assert.deepEqual(missing[index]!.args, args);
    assert.deepEqual(await execute("unzip", fs, args), observation(missing[index]!.observation));
  }
  const empty = snapshot.groups.failures.empty;
  assert.deepEqual(empty.args, ["-p", "empty.zip"]);
  await fs.writeFile("/work/empty.zip", capturedBytes[empty.archive]!);
  assert.deepEqual(await execute("unzip", fs, empty.args), observation(empty.observation));
  assert.deepEqual(snapshot.groups.failures.crc.map(captured => captured.member), ["binary", "folder/data"]);
  for (const captured of snapshot.groups.failures.crc) {
    assert.deepEqual(captured.args, ["-p", "bad.zip"]);
    await fs.writeFile("/work/bad.zip", capturedBytes[captured.archive]!);
    const expected = observation(captured.observation);
    const actual = await execute("unzip", readOnlyArchive(fs).fs, ["-p", "bad.zip"]);
    assert.equal(expected.exitCode, 2);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.deepEqual(actual.stdout, expected.stdout);
    assert.match(expected.stderr, /bad CRC/u);
    assert.match(actual.stderr, /CRC32 mismatch/u);
  }
});
