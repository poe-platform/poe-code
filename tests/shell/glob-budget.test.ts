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

test("glob results can fill the byte budget exactly", async () => {
  const { shell, fs } = setup({ limits: { maxExpansionBytes: 12 } });
  await fs.writeFile("/aaaaaa", new Uint8Array());
  await fs.writeFile("/bbbbbb", new Uint8Array());
  assert.equal((await shell.exec("args *")).stdout, '["aaaaaa","bbbbbb"]');
});
