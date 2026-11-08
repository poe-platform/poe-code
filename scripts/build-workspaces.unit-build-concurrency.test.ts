import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: () => "GIT_DIR\n"
}));
import { testWorkspaces } from "./build-workspaces.mjs";

for (const concurrency of [1, 4]) it(`keeps dependency builds within unit concurrency ${concurrency}`, async () => {
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/repo/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "node unit.mjs" } }),
    "/repo/turbo.json": JSON.stringify({ tasks: {
      build: { dependsOn: ["^build"] },
      "alpha#test:unit": { dependsOn: ["build"] },
      "beta#test:unit": { dependsOn: ["build"] }
    } }),
    ...Object.fromEntries(["alpha", "beta"].map(name => [`/repo/packages/${name}/package.json`, JSON.stringify({
      name, scripts: { build: "node build.mjs", "test:unit": "node unit.mjs" }
    })]))
  }));
  const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: process.execPath, kill: vi.fn() });
  let activeBuilds = 0, maximumBuilds = 0, builds = 0;
  const spawn = vi.fn((_command, args: string[]) => {
    const child = new EventEmitter();
    const build = args[4] === "build";
    if (build) { builds++; activeBuilds++; maximumBuilds = Math.max(maximumBuilds, activeBuilds); }
    else expect(activeBuilds).toBe(0);
    setImmediate(() => { if (build) activeBuilds--; child.emit("close", 0, null); });
    return child;
  });
  const result = await testWorkspaces("/repo", { fileSystem, host, spawn, concurrency, environment: { npm_execpath: "/owned/npm-cli.js" } });
  expect(maximumBuilds).toBe(Math.min(concurrency, 2));
  expect(builds).toBe(2);
  expect(result).toMatchObject({ builds: 2, tests: 3, concurrency });
});
