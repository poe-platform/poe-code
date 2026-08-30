import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";

interface Fixture {
  id: string;
  profile: "exact" | "qualified" | "native-unsupported" | "product-unsupported";
  args: string[];
  input?: string;
  inputHex?: string;
  files?: Record<string, string>;
  stdout: string;
  status: number;
  qualification?: string;
}
interface NativeRecord {
  id: string;
  profile: Fixture["profile"];
  argv: string[];
  stdinHex: string;
  status: number;
  stdoutHex: string;
  stderrHex: string;
}
const fixtureBytes = readFileSync(new URL("./cases.json", import.meta.url));
const fixtures = JSON.parse(fixtureBytes.toString()) as Fixture[];
const captured = JSON.parse(readFileSync(new URL("./native.json", import.meta.url), "utf8")) as { fixtureSha256: string; oracle: { sha256: string }; records: NativeRecord[] };
const qualifications = JSON.parse(readFileSync(new URL("./qualifications.json", import.meta.url), "utf8")) as {
  overrides: { [id: string]: { profile: "qualified"; qualification: string } };
};
const historical = fixtures.map(fixture => ({ ...fixture, ...qualifications.overrides[fixture.id] }));
const paddingProfile = JSON.parse(readFileSync(new URL("./padding-evolution/profile-deltas.json", import.meta.url), "utf8")) as {
  nativeOverrides: { [id: string]: { profile: "qualified"; stdout: string; qualification: string } };
};
const effective = historical.map(fixture => ({ ...fixture, ...paddingProfile.nativeOverrides[fixture.id] }));

test("native cohort fixture hash, distinct classifications and denominator are authenticated", () => {
  assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), captured.fixtureSha256);
  assert.equal(captured.oracle.sha256, "c6d7b469d8e8437c7185bedd356626ca69867c9c6b002cbb0020d995a6e4cc5f");
  assert.equal(captured.records.length, fixtures.length);
  assert.equal(new Set(captured.records.map(record => record.id)).size, fixtures.length);
  assert.equal(fixtures.filter(fixture => fixture.profile === "exact").length, 17);
  assert.equal(fixtures.filter(fixture => fixture.profile === "qualified").length, 7);
  assert.equal(fixtures.filter(fixture => fixture.profile === "native-unsupported").length, 2);
  assert.equal(fixtures.filter(fixture => fixture.profile === "product-unsupported").length, 2);
  assert.equal(historical.filter(fixture => fixture.profile === "exact").length, 15);
  assert.equal(historical.filter(fixture => fixture.profile === "qualified").length, 9);
  assert.equal(effective.filter(fixture => fixture.profile === "exact").length, 14);
  assert.equal(effective.filter(fixture => fixture.profile === "qualified").length, 10);
});

for (const fixture of effective) test(`${fixture.profile === "exact" ? "BSD exact bytes/status" : "product contract ONLY, NOT native parity"}: ${fixture.id}`, async () => {
  const native = captured.records.find(record => record.id === fixture.id)!;
  assert.ok(native);
  assert.equal(native.profile, fixtures.find(original => original.id === fixture.id)!.profile);
  assert.deepEqual(native.argv, fixture.args);
  const input = fixture.inputHex === undefined ? Buffer.from(fixture.input ?? "") : Buffer.from(fixture.inputHex, "hex");
  assert.equal(native.stdinHex, input.toString("hex"));
  const fs = createMemoryFileSystem();
  for (const [name, text] of Object.entries(fixture.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(text));
  const actual = await run(fixture.args, input, {}, { fs });
  assert.equal(actual.exitCode, fixture.status);
  assert.equal(actual.stdout, fixture.stdout);
  if (fixture.profile === "exact") {
    assert.equal(actual.exitCode, native.status);
    assert.equal(actual.stdoutBytes.toString("hex"), native.stdoutHex);
    assert.equal(Buffer.from(actual.stderr).toString("hex"), native.stderrHex);
  } else {
    assert.ok(fixture.qualification);
    if (fixture.profile === "product-unsupported") assert.match(actual.stderr, /unsupported option/);
    else assert.ok(actual.stdoutBytes.toString("hex") !== native.stdoutHex || actual.exitCode !== native.status);
  }
});
