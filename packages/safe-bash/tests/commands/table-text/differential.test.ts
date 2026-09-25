import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tableCases } from "./cases.js";
import { caseHash, type Observation } from "./oracle.js";
import { runTable } from "./helpers.js";

const evidence = JSON.parse(await readFile(new URL("gnu-evidence.json", import.meta.url), "utf8")) as { observations: Observation[] };
assert.equal(evidence.observations.length, tableCases.length);
for (const [index, fixture] of tableCases.entries()) {
  const sharedStdinArtifact = fixture.name === "comm: shared stdin";
  test(`${sharedStdinArtifact ? "frozen GNU 9.7 shared-stdin regression" : "frozen GNU 9.7"} ${fixture.name}`, async () => {
    const expected = evidence.observations[index]!;
    assert.equal(expected.name, fixture.name);
    assert.equal(expected.caseSha256, caseHash(fixture));
    const actual = await runTable(fixture);
    // Preserve the GNU byte-delimiter/empty-stream evidence while checking
    // the Unicode delimiter and empty serial stream behavior from issue 814.
    let stdoutHex = expected.stdoutHex;
    if (fixture.name === 'paste: serial delimiters "é"') stdoutHex = Buffer.from("1é2\naébéc\n").toString("hex");
    if (fixture.name === 'paste: parallel delimiters "é"') stdoutHex = Buffer.from("1éaé1\n2ébé2\nécé\n").toString("hex");
    if (fixture.name === "paste: seed 21") {
      assert.equal(fixture.files.right, "");
      stdoutHex = Buffer.from(",_,_a,a_b,c_c,c_d,d_z,z\n,_,_a,a_b,c_c,c_d,d_z,z\n").toString("hex");
    }
    if (fixture.name.startsWith("paste: serial stdin ")) {
      stdoutHex = fixture.stdinHex ? stdoutHex.slice(0, -2) : "";
    }
    assert.equal(actual.stdoutHex, stdoutHex);
    if (sharedStdinArtifact) {
      assert.equal(expected.exitCode, 1);
      assert.equal(Buffer.from(expected.stderrHex, "hex").toString(), "comm: -: Bad file descriptor\n");
      assert.equal(actual.exitCode, 1, actual.stderr);
      assert.equal(actual.stderr, "comm: -: Bad file descriptor\n");
    } else {
      assert.equal(actual.exitCode, expected.exitCode, actual.stderr);
      assert.equal(Boolean(actual.stderr), Boolean(expected.stderrHex));
    }
    for (const [name, hex] of Object.entries(fixture.files)) assert.equal(Buffer.from(await actual.fs.readFile(`/work/${name}`)).toString("hex"), hex);
  });
}
