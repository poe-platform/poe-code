import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

for (const fixture of [
  { source: ": * >after", paths: ["a".repeat(17)], limit: 16 },
  { source: ": * >after", paths: ["aaaaa", "bbbbb", "ccccc"], limit: 14 },
  { source: ": * >after", paths: ["ééééé"], limit: 9 },
  { source: ": */ >after", paths: ["abcdefgh/file"], limit: 8 },
  { source: ": */* >after", paths: ["aaaa/bbbb", "aaaa/cccc"], limit: 17 },
  { source: ": $patterns >after", paths: ["aaaaaaaa", "bbbbbbbb"], limit: 15, env: { patterns: "a* b*" } },
  { source: ": */nonexistent >after", paths: ["abcdefghijklmnop/file"], limit: 14 },
]) {
  test(`glob expansion enforces byte budget before effects: ${JSON.stringify(fixture)}`, async () => {
    const { shell, fs } = setup({ limits: { maxExpansionBytes: fixture.limit }, ...(fixture.env ? { env: fixture.env } : {}) });
    for (const path of fixture.paths) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      if (path.includes("/")) await fs.mkdir(`/${parent}`, { recursive: true });
      await fs.writeFile(`/${path}`, new Uint8Array());
    }
    await assert.rejects(shell.exec(fixture.source), (error) => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
  });
}

test("glob results preserve sorted arguments with token storage admitted", async () => {
  const { shell, fs } = setup({ limits: { maxExpansionBytes: 4096 } });
  await fs.writeFile("/aaaaaa", new Uint8Array());
  await fs.writeFile("/bbbbbb", new Uint8Array());
  try {
    const result = await shell.exec("args *");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["aaaaaa","bbbbbb","dev"]');
  } finally { await shell.dispose(); }
});

test("tiny glob token budgets refuse before enumeration and redirect effects", async context => {
  const { shell, fs } = setup({ limits: { maxExpansionBytes: 12 } });
  await fs.writeFile("/aaaaaa", new Uint8Array());
  await fs.writeFile("/bbbbbb", new Uint8Array());
  const enumeration = context.mock.method(fs, "readdir");
  try {
    await assert.rejects(shell.exec("args * >after"), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
    assert.equal(enumeration.mock.callCount(), 0);
    await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

for (const extra of [false, true]) {
  test(`glob enumeration ${extra ? "refuses one byte beyond" : "fills exactly"} the admitted byte budget`, async context => {
    const { shell, fs } = setup({ limits: { maxExpansionBytes: 4096 } });
    const names: string[] = [];
    for (let index = 0; index < 64; index++) names.push(String(index).padStart(index === 0 ? 64 - Buffer.byteLength("dev") : 64, "x"));
    if (extra) names.push("z");
    assert.equal(names.reduce((bytes, name) => bytes + Buffer.byteLength(name), Buffer.byteLength("dev")), extra ? 4097 : 4096);
    for (const name of names) await fs.writeFile(`/${name}`, new Uint8Array());
    const enumeration = context.mock.method(fs, "readdir");
    const metadata = context.mock.method(fs, "stat");
    try {
      if (extra) {
        await assert.rejects(shell.exec(": * >after"), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
        assert.equal(metadata.mock.callCount(), 0);
        await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
      } else {
        const result = await shell.exec(": * >after");
        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
        assert.deepEqual(metadata.mock.calls.map(call => call.arguments[0]), names.toSorted().map(name => `/${name}`));
        assert.equal((await fs.stat("/after")).size, 0);
      }
      assert.equal(enumeration.mock.callCount(), 1);
    } finally { await shell.dispose(); }
  });
}
