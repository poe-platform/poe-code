import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { expect, it, vi } from "vitest";
import { buildWorkspaces, createWorkspaceTestPlan } from "./build-workspaces.mjs";

function fixture(extra: Record<string, Record<string, unknown>> = {}) {
  const root = "/dependency-event-build";
  const manifests = {
    "package.json": { name: "root", private: true, workspaces: ["packages/*"], scripts: { "test:unit": "root-test" } },
    "turbo.json": { tasks: { build: { dependsOn: ["^build"] }, "alpha#test:unit": { dependsOn: ["build"] } } },
    "packages/alpha/package.json": { name: "alpha", version: "1.0.0", scripts: { build: "alpha-build", "test:unit": "alpha-test" }, dependencies: { beta: "*" }, poeCode: { build: { dependencies: { beta: "build:portable" } } } },
    "packages/beta/package.json": { name: "beta", version: "1.0.0", scripts: { build: "beta-full", "prebuild:portable": "before-portable", "build:portable": "beta-portable", "postbuild:portable": "after-portable", "build:alternate": "beta-alternate" }, dependencies: { gamma: "*" } },
    "packages/gamma/package.json": { name: "gamma", version: "1.0.0", scripts: { build: "gamma-build" } },
    ...extra
  };
  const fileSystem = createFsFromVolume(Volume.fromJSON(Object.fromEntries(Object.entries(manifests).map(([name, value]) => [root + "/" + name, JSON.stringify(value)]))));
  const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: process.execPath, kill: vi.fn() });
  const spawn = vi.fn(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  });
  return { root, fileSystem, host, spawn, environment: { npm_execpath: "/owned/npm-cli.js" } };
}

function calls(spawn: ReturnType<typeof vi.fn>) {
  return spawn.mock.calls.map(([, args]) => [args[args.indexOf("run") + 1], args.find((argument: string) => argument.startsWith("--workspace="))]);
}

it("selects a declared dependency event and retains its complete dependency closure", async () => {
  const owned = fixture();
  await buildWorkspaces(owned.root, { ...owned, workspace: "alpha" });
  expect(calls(owned.spawn)).toEqual([["build", "--workspace=packages/gamma"], ["build:portable", "--workspace=packages/beta"], ["build", "--workspace=packages/alpha"]]);
  expect(owned.spawn.mock.calls[1]?.[1]).toEqual(["/owned/npm-cli.js", "--prefix", owned.root, "run", "build:portable", "--workspace=packages/beta", "--include-workspace-root=false", "--if-present=false"]);
});

it("preserves default full builds when every workspace is a root", async () => {
  const owned = fixture();
  await buildWorkspaces(owned.root, owned);
  expect(calls(owned.spawn)).toEqual([["build", "--workspace=packages/gamma"], ["build", "--workspace=packages/beta"], ["build", "--workspace=packages/alpha"]]);
});

it("preserves an explicitly selected dependency full build", async () => {
  const owned = fixture();
  await buildWorkspaces(owned.root, { ...owned, workspace: "beta" });
  expect(calls(owned.spawn)).toEqual([["build", "--workspace=packages/gamma"], ["build", "--workspace=packages/beta"]]);
});

for (const names of [["alpha", "delta"], ["delta", "alpha"]]) {
  it(`lets full dependency authority dominate portable requests in ${names.join(" then ")} order`, async () => {
    const owned = fixture({
      "packages/alpha/package.json": { name: "alpha", version: "1.0.0", scripts: { build: "alpha" }, dependencies: Object.fromEntries(names.map(name => [name === "alpha" ? "epsilon" : name, "*"])) },
      "packages/epsilon/package.json": { name: "epsilon", version: "1.0.0", scripts: { build: "epsilon" }, dependencies: { beta: "*" }, poeCode: { build: { dependencies: { beta: "build:portable" } } } },
      "packages/delta/package.json": { name: "delta", version: "1.0.0", scripts: { build: "delta" }, dependencies: { beta: "*" } }
    });
    await buildWorkspaces(owned.root, { ...owned, workspace: "alpha" });
    expect(calls(owned.spawn).filter(([, selection]) => selection === "--workspace=packages/beta")).toEqual([["build", "--workspace=packages/beta"]]);
  });
}

it("deduplicates matching requests through a diamond", async () => {
  const owned = fixture({
    "packages/alpha/package.json": { name: "alpha", version: "1.0.0", scripts: { build: "alpha" }, dependencies: { beta: "*", delta: "*" }, poeCode: { build: { dependencies: { beta: "build:portable" } } } },
    "packages/delta/package.json": { name: "delta", version: "1.0.0", scripts: { build: "delta" }, dependencies: { beta: "*" }, poeCode: { build: { dependencies: { beta: "build:portable" } } } }
  });
  await buildWorkspaces(owned.root, { ...owned, workspace: "alpha" });
  expect(calls(owned.spawn).filter(([, selection]) => selection === "--workspace=packages/beta")).toEqual([["build:portable", "--workspace=packages/beta"]]);
});

it("rejects conflicting custom events before any dependency starts", async () => {
  const owned = fixture({
    "packages/alpha/package.json": { name: "alpha", version: "1.0.0", scripts: { build: "alpha" }, dependencies: { beta: "*", delta: "*" }, poeCode: { build: { dependencies: { beta: "build:portable" } } } },
    "packages/delta/package.json": { name: "delta", version: "1.0.0", scripts: { build: "delta" }, dependencies: { beta: "*" }, poeCode: { build: { dependencies: { beta: "build:alternate" } } } }
  });
  await expect(buildWorkspaces(owned.root, { ...owned, workspace: "alpha" })).rejects.toThrow("Conflicting dependency build events: beta: build:alternate, build:portable");
  expect(owned.spawn).not.toHaveBeenCalled();
});

for (const [label, manifest] of [
  ["missing selected event", { name: "beta", version: "1.0.0", scripts: { build: "beta" } }],
  ["missing normal build", { name: "beta", version: "1.0.0", scripts: { "build:portable": "beta" } }]
] as const) it(`rejects ${label} before spawn`, async () => {
  const owned = fixture({ "packages/beta/package.json": manifest });
  await expect(buildWorkspaces(owned.root, { ...owned, workspace: "alpha" })).rejects.toThrow();
  expect(owned.spawn).not.toHaveBeenCalled();
});

for (const dependencies of [{ missing: "build:portable" }, { beta: "test:unit" }, { beta: "build:portable bad" }, { beta: 7 }]) it(`rejects an invalid dependency-event declaration ${JSON.stringify(dependencies)}`, async () => {
  const owned = fixture({ "packages/alpha/package.json": { name: "alpha", version: "1.0.0", scripts: { build: "alpha" }, dependencies: { beta: "*" }, poeCode: { build: { dependencies } } } });
  await expect(buildWorkspaces(owned.root, { ...owned, workspace: "alpha" })).rejects.toThrow();
  expect(owned.spawn).not.toHaveBeenCalled();
});

it("changes required build events without changing declared unit task membership", () => {
  const owned = fixture();
  const plan = createWorkspaceTestPlan(owned.root, { fileSystem: owned.fileSystem });
  expect(plan.testStages.map(({ name, event }) => [name, event])).toEqual([["root", "test:unit"], ["alpha", "test:unit"]]);
  expect(plan.buildStages.map(({ name, event }) => [name, event ?? "build"])).toEqual([["gamma", "build"], ["beta", "build:portable"], ["alpha", "build"]]);
});
