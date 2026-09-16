import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { resolveBrowserShellBuild } from "./bundle-safe-bash.mjs";

it("publishes optional Python command and worker entries in the maintained browser build", async () => {
  const root = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const shell = JSON.parse(await readFile(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
  for (const [key, name] of [["./commands/python", "index"], ["./commands/python/worker", "worker"]]) {
    expect(shell.exports[key!]).toEqual({
      types: `./dist/commands/python/${name}.d.ts`,
      browser: `./dist/commands/python/${name}.browser.js`,
      import: `./dist/commands/python/${name}.js`,
    });
    expect(root.exports[`./safe-bash${key!.slice(1)}`]).toEqual({
      types: `./packages/safe-bash/dist/commands/python/${name}.d.ts`,
      browser: `./packages/safe-bash/dist/commands/python/${name}.browser.js`,
      import: `./packages/safe-bash/dist/commands/python/${name}.js`,
    });
    expect(resolveBrowserShellBuild("/repo").entryPoints[`commands/python/${name}.browser`])
      .toBe(`/repo/packages/safe-bash/src/commands/python/${name}.ts`);
  }
});
