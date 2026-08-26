import assert from "node:assert/strict";
import test from "node:test";
import { assertBytes, cwd, exactUpdate, instrument, invoke, memory, quoted, section, snapshot } from "./helpers.js";

const families = [
  "café-Ångström", "日本語-漢字", "🙂-🚀", "e\u0301-ñ", "tab\tinside",
  'quote"inside', "two spaces  here", "$(echo NO);&|<>`NO`", "[glob]*?{brace}", "--dash #hash 'apostrophe'",
];

for (const [familyIndex, family] of families.entries()) {
  for (let index = 0; index < 16; index++) {
    const name = `family-${familyIndex}-${index}-${family}.txt`;
    for (const encoding of ["git-octal", "literal"] as const) {
      test(`valid filename ${encoding} ${JSON.stringify(name)}`, { timeout: 3000 }, async () => {
        const header = encoding === "git-octal" ? quoted(`prefix/${name}`)
          : name.includes("\t") ? quoted(`prefix/${name}`, false) : `prefix/${name}`;
        await exactUpdate(name, section(`${header}\t2026-08-26 00:00:00 +0000`), ["-p1"]);
      });
    }
  }
}

for (const name of [" leading", "trailing ", " both ", "tab\tend\t", "\ufeffBOM", "é", "e\u0301"]) {
  test(`quoted boundary and normalization-sensitive name ${JSON.stringify(name)}`, async () => {
    await exactUpdate(name, section(quoted(`prefix/${name}`)), ["-p1"]);
  });
}

test("Unicode normalization lookalikes and BOM names remain distinct in MemoryFS", async () => {
  const names = ["é", "e\u0301", "\ufeffé"];
  const backing = await memory(Object.fromEntries(names.map(name => [name, "old\n"])));
  const before = await snapshot(backing);
  const observed = instrument(backing);
  const result = await invoke(observed.fs, "patch", { input: section(quoted("e\u0301")) });
  assert.equal(result.exitCode, 0, result.stderr);
  for (const name of names) await assertBytes(backing, name, name === "e\u0301" ? "new\n" : "old\n");
  assert.deepEqual(observed.mutations().map(operation => operation.path), [`${cwd}/e\u0301`]);
  await backing.writeFile(`${cwd}/e\u0301`, Buffer.from("old\n"));
  assert.deepEqual(await snapshot(backing), before);
});
