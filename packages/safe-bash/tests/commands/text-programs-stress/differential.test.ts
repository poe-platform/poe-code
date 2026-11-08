import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after } from "node:test";
import type { TextCase } from "./cases.js";
import { compare, type Comparison } from "./model.js";
import { VirtualSession } from "./session.js";

const evidence = JSON.parse(readFileSync(new URL("./dialect-evidence.json", import.meta.url), "utf8")) as {
  results: { fixture: TextCase; bsd: Comparison; gnu: Comparison }[];
};

const session = new VirtualSession();
after(async () => { await session.dispose(); assert.deepEqual(session.backgroundErrors, []); });

for (const recorded of evidence.results) {
  const { fixture } = recorded;
  const dialect = ["sed-regex-70", "sed-inplace-quit-per-file"].includes(fixture.name) ? "gnu" : "bsd";
  test(`captured ${dialect} sed output: ${fixture.name}`, async () => {
    const actual = await session.run({ fixture });
    const result = compare(fixture, recorded[dialect].native, actual);
    assert.equal(result.status, "pass", JSON.stringify(result));
  });
}
