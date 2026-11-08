import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn(() => "GIT_DIR\nGIT_INDEX_FILE\n"));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFileSync: query }));
import { testWorkspaces } from "./build-workspaces.mjs";

it("uses the host Git path when omitted, reuses its static variable list and clears each child environment", async () => {
  const fileSystem = createFsFromVolume(Volume.fromJSON({
    "/repo/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "node unit.mjs" } }),
    "/repo/turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] } } }),
    "/repo/packages": null
  }));
  const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: process.execPath, kill: vi.fn() });
  const spawn = vi.fn(() => { const child = new EventEmitter(); queueMicrotask(() => child.emit("close", 0, null)); return child; });
  const environment = Object.freeze({ npm_execpath: "/owned/npm-cli.js", GIT_DIR: "/parent/.git", GIT_INDEX_FILE: "/parent/index", GIT_CONFIG_GLOBAL: "/private/config" });
  for (let index = 0; index < 2; index++) await testWorkspaces("/repo", { fileSystem, host, spawn, environment });
  expect(query).toHaveBeenCalledOnce();
  expect(query.mock.calls[0][2].env).toEqual({ PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
  for (const call of spawn.mock.calls) {
    expect(call[2].env.GIT_DIR).toBeUndefined();
    expect(call[2].env.GIT_INDEX_FILE).toBeUndefined();
    expect(call[2].env.GIT_CONFIG_GLOBAL).toBe("/private/config");
  }
  expect(environment.GIT_DIR).toBe("/parent/.git");
});
