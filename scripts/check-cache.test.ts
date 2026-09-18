import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createCheckCache, createTaskFingerprints } from "./check-cache.mjs";

function fixture(root = "/repo") {
  const files = {
    "package-lock.json": "lock", "vitest.config.ts": "config", "tests/setup.ts": "setup",
    "packages/alpha/package.json": '{"name":"alpha"}', "packages/alpha/src/index.ts": "alpha",
    "packages/beta/package.json": '{"name":"beta"}', "packages/beta/src/index.ts": "beta",
    "packages/other/src/index.ts": "other"
  };
  const fileSystem = createFsFromVolume(Volume.fromJSON(Object.fromEntries(
    Object.entries(files).map(([name, content]) => [root + "/" + name, content]))));
  const plan = { root, workspaces: [{ name: "alpha", path: "packages/alpha" }, { name: "beta", path: "packages/beta" }, { name: "other", path: "packages/other" }], edges: [{ from: "alpha", to: "beta" }] };
  return { root, files: Object.keys(files), fileSystem, plan };
}

describe("content-addressed check cache", () => {
  it("reuses keys across checkout paths and invalidates source consumers without invalidating unrelated packages", () => {
    const first = fixture(), second = fixture("/other-checkout");
    const keys = state => createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test" });
    const before = keys(first);
    expect(keys(second).get("alpha")).toBe(before.get("alpha"));
    first.fileSystem.writeFileSync("/repo/packages/beta/src/index.ts", "changed");
    const after = keys(first);
    expect(after.get("alpha")).not.toBe(before.get("alpha"));
    expect(after.get("beta")).not.toBe(before.get("beta"));
    expect(after.get("other")).toBe(before.get("other"));
  });

  it("normalizes npm checkout bin paths while retaining external PATH identity", () => {
    const first = fixture(), second = fixture("/other-checkout");
    const key = (state, external = "/usr/bin") => createTaskFingerprints(state.plan, {
      files: state.files, fileSystem: state.fileSystem, runtime: "node-test",
      environment: { PATH: state.root + "/packages/alpha/node_modules/.bin:" + state.root + "/node_modules/.bin:" + external }
    }).get("alpha");
    expect(key(second)).toBe(key(first));
    expect(key(second, "/different/bin")).not.toBe(key(first));
  });

  it("includes untracked files, deletions, shared setup, runtime and relevant environment", () => {
    const state = fixture();
    const key = (options = {}) => createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test", ...options }).get("alpha");
    const before = key();
    expect(key({ runtime: "different-node" })).not.toBe(before);
    expect(key({ environment: { TZ: "UTC" } })).not.toBe(before);
    expect(key({ environment: { PWD: "/elsewhere", npm_package_name: "different" } })).toBe(before);
    expect(key({ environment: { GITHUB_RUN_ID: "new-run", GITHUB_SHA: "new-head", RUNNER_TRACKING_ID: "new-process", CODEX_THREAD_ID: "new-session" } })).toBe(before);
    state.fileSystem.writeFileSync("/repo/tests/setup.ts", "new setup");
    expect(key()).not.toBe(before);
    state.fileSystem.writeFileSync("/repo/tests/setup.ts", "setup");
    state.fileSystem.unlinkSync("/repo/packages/beta/src/index.ts");
    expect(key()).not.toBe(before);
    state.fileSystem.writeFileSync("/repo/packages/beta/src/index.ts", "beta");
    state.fileSystem.writeFileSync("/repo/packages/alpha/src/new.ts", "new");
    expect(key({ files: [...state.files, "packages/alpha/src/new.ts"] })).not.toBe(before);
  });

  it("includes source imports missing from manifests, including relative imports and dependency cycles", () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/packages/alpha/src/index.ts", 'export { value } from "other";');
    state.fileSystem.writeFileSync("/repo/packages/other/src/index.ts", 'export { value } from "../../alpha/src/index.js";');
    const keys = () => createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test" });
    const before = keys();
    expect(before.get("alpha")).not.toBe(before.get("other"));
    state.fileSystem.writeFileSync("/repo/packages/other/src/index.ts", 'export { value } from "../../alpha/src/index.js"; export const changed = true;');
    expect(keys().get("alpha")).not.toBe(before.get("alpha"));
    expect(keys().get("beta")).toBe(before.get("beta"));
  });

  it("does not read unrelated package payloads when fingerprinting selected workspaces", () => {
    const state = fixture();
    const read = state.fileSystem.readFileSync.bind(state.fileSystem);
    const observed: string[] = [];
    state.fileSystem.readFileSync = ((filename, ...args) => {
      observed.push(String(filename));
      return read(filename, ...args);
    }) as typeof state.fileSystem.readFileSync;
    const keys = createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test", selected: ["alpha"] });
    expect(keys.has("alpha")).toBe(true);
    expect(keys.has("other")).toBe(false);
    expect(observed.some(filename => filename.includes("/packages/other/"))).toBe(false);
  });

  it("hashes a shared imported JSON asset without reading the owning package's unrelated source", () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/vitest.config.ts", 'import config from "./packages/other/quarantine.json";');
    state.fileSystem.writeFileSync("/repo/packages/other/quarantine.json", "[]");
    const files = [...state.files, "packages/other/quarantine.json"];
    const read = state.fileSystem.readFileSync.bind(state.fileSystem);
    const observed: string[] = [];
    const fileSystem = { ...state.fileSystem, readFileSync(filename, ...args) { observed.push(String(filename)); return read(filename, ...args); } };
    const key = () => createTaskFingerprints(state.plan, { files, fileSystem, environment: {}, runtime: "node-test", selected: ["alpha"] }).get("alpha");
    const before = key();
    expect(observed).not.toContain("/repo/packages/other/src/index.ts");
    state.fileSystem.writeFileSync("/repo/packages/other/quarantine.json", '["excluded.test.ts"]');
    expect(key()).not.toBe(before);
  });

  it("uses the same package key when other packages are selected in the same batch", () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/packages/other/data.json", "[]");
    state.fileSystem.writeFileSync("/repo/packages/other/src/index.ts", 'import data from "../data.json";');
    const options = { files: [...state.files, "packages/other/data.json"], fileSystem: state.fileSystem, environment: {}, runtime: "node-test" };
    const alone = createTaskFingerprints(state.plan, { ...options, selected: ["alpha"] });
    const batch = createTaskFingerprints(state.plan, { ...options, selected: ["other", "alpha"] });
    expect(batch.get("alpha")).toBe(alone.get("alpha"));
  });

  it("invalidates changes to the contents of symbolic link inputs", () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/shared.ts", "before");
    state.fileSystem.unlinkSync("/repo/packages/beta/src/index.ts");
    state.fileSystem.symlinkSync("../../../shared.ts", "/repo/packages/beta/src/index.ts");
    const key = () => createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test" }).get("alpha");
    const before = key();
    state.fileSystem.writeFileSync("/repo/shared.ts", "after");
    expect(key()).not.toBe(before);
  });

  it("keeps build fingerprints independent of unit test source and setup", () => {
    const state = fixture();
    const key = () => createTaskFingerprints(state.plan, { files: state.files, fileSystem: state.fileSystem, environment: {}, runtime: "node-test", event: "build" }).get("alpha");
    const before = key();
    state.fileSystem.writeFileSync("/repo/tests/setup.ts", "changed");
    expect(key()).toBe(before);
    state.fileSystem.writeFileSync("/repo/tsconfig.json", "changed compiler configuration");
    expect(createTaskFingerprints(state.plan, { files: [...state.files, "tsconfig.json"], fileSystem: state.fileSystem, environment: {}, runtime: "node-test", event: "build" }).get("alpha")).not.toBe(before);
  });

  it("includes root source imported by a workspace build without changing batch identity", () => {
    const state = fixture();
    state.fileSystem.writeFileSync("/repo/helper.ts", "export const value = 1;");
    state.fileSystem.writeFileSync("/repo/packages/alpha/src/index.ts", 'import { value } from "../../../helper.js";');
    const options = { files: [...state.files, "helper.ts"], fileSystem: state.fileSystem, environment: {}, runtime: "node-test", event: "build" };
    const key = () => createTaskFingerprints(state.plan, { ...options, selected: ["alpha"] }).get("alpha");
    const before = key();
    expect(createTaskFingerprints(state.plan, { ...options, selected: ["other", "alpha"] }).get("alpha")).toBe(before);
    state.fileSystem.writeFileSync("/repo/helper.ts", "export const value = 2;");
    expect(key()).not.toBe(before);
  });

  it("runs tasks fresh when a dependency contains a directory link", () => {
    const state = fixture();
    state.fileSystem.mkdirSync("/external", { recursive: true });
    state.fileSystem.symlinkSync("/external", "/repo/packages/beta/fixtures");
    const keys = createTaskFingerprints(state.plan, { files: [...state.files, "packages/beta/fixtures"], fileSystem: state.fileSystem, environment: {}, runtime: "node-test" });
    expect(keys.has("alpha")).toBe(false);
    expect(keys.has("beta")).toBe(false);
    expect(keys.has("other")).toBe(true);
  });

  it("does not remove outputs before rejecting a symbolic-link ancestor", () => {
    const state = fixture();
    state.fileSystem.mkdirSync("/copy", { recursive: true });
    state.fileSystem.mkdirSync("/foreign", { recursive: true });
    state.fileSystem.writeFileSync("/foreign/keep.js", "keep");
    state.fileSystem.symlinkSync("/foreign", "/copy/dist");
    const cache = createCheckCache({ directory: "/cache", fileSystem: state.fileSystem });
    expect(() => cache.restore("/copy", ["dist/**"], [{ path: "dist/index.js", bytes: "", mode: 0o644 }])).toThrow();
    expect(state.fileSystem.readFileSync("/foreign/keep.js", "utf8")).toBe("keep");
  });

  it("records successful task results atomically and treats corrupt records as misses", () => {
    const state = fixture();
    const cache = createCheckCache({ directory: "/cache", fileSystem: state.fileSystem });
    expect(cache.read("a".repeat(64))).toBeNull();
    cache.write("a".repeat(64), { success: true, durationMs: 21 });
    expect(cache.read("a".repeat(64))).toEqual({ success: true, durationMs: 21 });
    state.fileSystem.writeFileSync("/cache/" + "a".repeat(64) + ".json.gz", "broken");
    expect(cache.read("a".repeat(64))).toBeNull();
    expect(() => cache.write("../escape", {})).toThrow();
  });

  it("restores build outputs and permissions into another checkout and removes stale outputs", () => {
    const state = fixture();
    state.fileSystem.mkdirSync("/repo/packages/alpha/dist", { recursive: true });
    state.fileSystem.writeFileSync("/repo/packages/alpha/dist/index.js", "built", { mode: 0o755 });
    const cache = createCheckCache({ directory: "/cache", fileSystem: state.fileSystem });
    const outputs = cache.capture("/repo/packages/alpha", ["dist/**"]);
    state.fileSystem.mkdirSync("/copy/dist", { recursive: true });
    state.fileSystem.writeFileSync("/copy/dist/stale.js", "stale");
    cache.restore("/copy", ["dist/**"], outputs);
    expect(state.fileSystem.readFileSync("/copy/dist/index.js", "utf8")).toBe("built");
    expect(state.fileSystem.statSync("/copy/dist/index.js").mode & 0o777).toBe(0o755);
    expect(state.fileSystem.existsSync("/copy/dist/stale.js")).toBe(false);
    expect(() => cache.restore("/copy", ["dist/**"], [{ path: "../escape", bytes: "", mode: 0o644 }])).toThrow();
  });
});
