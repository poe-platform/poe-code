import assert from "node:assert/strict";
import test from "node:test";
import { binary, fixture } from "./helpers.js";

const quotedNames = [
  ["Owned\\tBeta", "Owned\tBeta"],
  ["Owned\\nGamma", "Owned\nGamma"],
  ["Owned\\\\Delta", "Owned\\Delta"],
  ["Owned\\141", "Owneda"],
  ["Owned\\q", "Owned\\q"],
  ["Owned\\", "Owned\\"],
  ["Owned\\303\\251", "Ownedé"],
  ["Owned\\a\\b\\f\\r\\v", "Owned\x07\b\f\r\v"],
  ["Owned\\12", "Owned\\12"],
];

for (const input of ["--files-from input.names", "-T -"]) {
  test(`ordinary quoted file lists round-trip binary payloads through ${input}`, async () => {
    const { fs, shell } = await fixture();
    try {
      for (const [, name] of quotedNames) await fs.writeFile(`/work/${name}`, binary);
      const list = Buffer.from(quotedNames.map(([quoted]) => quoted).join("\n") + "\n");
      await fs.writeFile("/work/input.names", list);
      const created = await shell.exec(`tar --create --file owned.tar ${input}`, { stdin: list });
      assert.equal(created.exitCode, 0, created.stderr);
      const extracted = await shell.exec("tar --get --file owned.tar --directory /out");
      assert.equal(extracted.exitCode, 0, extracted.stderr);
      for (const [, name] of quotedNames) assert.deepEqual(await fs.readFile(`/out/${name}`), binary);
    } finally { await shell.dispose(); }
  });
}

test("file-list quoting mode resets preserve literal null and verbatim names", async () => {
  const { fs, shell } = await fixture();
  try {
    for (const name of ["Owned\\tBeta", "Owned\tBeta"]) await fs.writeFile(`/work/${name}`, binary);
    await fs.writeFile("/work/literal", Buffer.from("Owned\\tBeta\n"));
    await fs.writeFile("/work/null", Buffer.from("Owned\\tBeta\0"));
    for (const flags of ["--verbatim-files-from -T literal --no-verbatim-files-from -T literal", "--null -T null --no-null --no-verbatim-files-from -T literal"]) {
      const created = await shell.exec(`tar -cf owned.tar ${flags}`);
      assert.equal(created.exitCode, 0, created.stderr);
      assert.equal((await shell.exec("tar -xf owned.tar -C /out")).exitCode, 0);
      for (const name of ["Owned\\tBeta", "Owned\tBeta"]) assert.deepEqual(await fs.readFile(`/out/${name}`), binary);
    }
  } finally { await shell.dispose(); }
});

test("decoded file-list names retain NUL and Unicode admission checks", async () => {
  const { fs, shell } = await fixture();
  try {
    for (const name of ["Owned\\000", "Owned\\377"]) {
      const result = await shell.exec("tar -cf owned.tar -T -", { stdin: name + "\n" });
      assert.equal(result.exitCode, 2);
      await assert.rejects(fs.stat("/work/owned.tar"), { code: "ENOENT" });
    }
  } finally { await shell.dispose(); }
});
