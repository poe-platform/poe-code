import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { type Fixture } from "../../stream-inspection/helpers.js";

const source = new URL("../../stream-inspection/", import.meta.url);
const expectedHash = "90b9c9257095110594ae58a4bb1531d9670bd6aed297b8dbf0dc01914c5de09f";

async function isolatedOracle(run: (oracle: typeof import("../../stream-inspection/oracle.js"), gnu: typeof import("../../stream-inspection/gnu-strings-oracle.js"), folder: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "strings-argv0-binding-"));
  try {
    writeFileSync(join(folder, "package.json"), '{"type":"module"}\n');
    for (const name of ["oracle.ts", "gnu-strings-oracle.ts"]) copyFileSync(new URL(name, source), join(folder, name));
    for (const name of ["cases.ts", "gnu-strings-cases.ts", "helpers.ts"]) symlinkSync(new URL(name, source), join(folder, name));
    const oracle = await import(pathToFileURL(join(folder, "oracle.ts")).href) as typeof import("../../stream-inspection/oracle.js");
    const gnu = await import(pathToFileURL(join(folder, "gnu-strings-oracle.ts")).href) as typeof import("../../stream-inspection/gnu-strings-oracle.js");
    run(oracle, gnu, folder);
    assert.deepEqual(readdirSync(folder).filter(name => name.startsWith("author-native-")), []);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const nodeFixture: Fixture = {
  id: "argv0-node-identity",
  command: "strings",
  args: ["-e", 'process.stdout.write(JSON.stringify({ argv0: process.argv0, executable: process.execPath, args: process.argv.slice(1) }))', "--", "literal operand"],
  stdinHex: "",
};

test("capture omitted argv0 retains the executable default", async () => {
  await isolatedOracle(({ capture }) => {
    const implicit = capture(nodeFixture, process.execPath);
    assert.deepEqual(implicit, capture(nodeFixture, process.execPath, process.execPath));
    assert.equal(implicit.status, 0);
    assert.equal(implicit.signal, null);
    assert.equal(implicit.stderrHex, "");
    assert.deepEqual(JSON.parse(Buffer.from(implicit.stdoutHex, "hex").toString()), {
      argv0: process.execPath, executable: process.execPath, args: ["literal operand"],
    });
  });
});

test("capture logical argv0 does not select the executable or rewrite operands", async () => {
  await isolatedOracle(({ capture, identity }, _gnu, folder) => {
    const logical = join(folder, "nonexistent-logical-program");
    const details = identity(process.execPath);
    const actual = capture(nodeFixture, process.execPath, logical);
    assert.equal(actual.status, 0);
    assert.equal(actual.signal, null);
    assert.equal(actual.stderrHex, "");
    assert.deepEqual(JSON.parse(Buffer.from(actual.stdoutHex, "hex").toString()), {
      argv0: logical, executable: process.execPath, args: ["literal operand"],
    });
    assert.equal(details.executable, process.execPath);
    assert.equal(details.resolved, realpathSync(process.execPath));
    assert.equal(details.sha256, createHash("sha256").update(readFileSync(process.execPath)).digest("hex"));
  });
});

test("relocated authenticated GNU strings preserves every original observation", { skip: process.env.STREAM_NATIVE_LIVE !== "1" ? "set STREAM_NATIVE_LIVE=1 with the pinned GNU strings executable" : false }, async () => {
  await isolatedOracle(({ capture, identity }, { captureGnuStrings, defaultStrings }, folder) => {
    const evidence = JSON.parse(readFileSync(new URL("evidence/gnu-strings.json", source), "utf8")) as ReturnType<typeof captureGnuStrings>;
    assert.equal(defaultStrings, evidence.identity.executable);
    const selected = process.env.STREAM_GNU_STRINGS ?? defaultStrings;
    assert.equal(identity(selected).sha256, expectedHash);
    const relocated = join(folder, "relocated-strings");
    copyFileSync(selected, relocated);
    chmodSync(relocated, 0o700);
    const previous = process.env.STREAM_GNU_STRINGS;
    try {
      process.env.STREAM_GNU_STRINGS = relocated;
      const result = captureGnuStrings();
      assert.equal(result.identity.executable, relocated);
      assert.equal(result.identity.resolved, realpathSync(relocated));
      assert.equal(result.identity.sha256, expectedHash);
      assert.deepEqual(result.observations, evidence.observations);
      const original = evidence.observations.find(observation => observation.id === "gnu-lone-dash-stdin")!;
      const diagnostic = Buffer.from(original.stderrHex, "hex");
      assert.equal(diagnostic.length, 1564);
      assert.equal(createHash("sha256").update(diagnostic).digest("hex"), "408835816cfd774536a0bffae5ade7814e96e2e8e4091618b47bb5edfd796705");
      const specimen: Fixture = { id: original.id, command: "strings", args: ["-"], stdinHex: "414243440045464748" };
      const implicit = capture(specimen, relocated);
      assert.deepEqual(implicit, capture(specimen, relocated, relocated));
      assert.notEqual(implicit.stderrHex, original.stderrHex);
      assert.deepEqual(capture(specimen, relocated, defaultStrings), original);
      assert.equal(identity(relocated).sha256, expectedHash);
      assert.equal(identity(selected).sha256, expectedHash);
    } finally {
      if (previous === undefined) delete process.env.STREAM_GNU_STRINGS;
      else process.env.STREAM_GNU_STRINGS = previous;
    }
  });
});
