import {beforeEach, expect, it, vi} from "vitest";
import {fs, vol} from "memfs";
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
import {createRootedSourceResolver} from "./source-files.js";
import {SourceModuleGraph} from "./source-graph.js";
import {createModuleEnvironment} from "./registry.js";
import {Scope} from "../interp/scope.js";
import {createRealm} from "../realm.js";
import {run} from "../run.js";
import {runCli} from "../cli.js";
import {createSink} from "../../test/sinks.js";

beforeEach(() => {vi.restoreAllMocks(); vol.reset();});

it.each(["acorn", "node:fs", "/grant/dep.js", "file:///grant/dep.js", "https://allowed.test/dep.js",
  "../outside/secret.js", "./../../outside/secret.js"])("denies %s before filesystem access", async specifier => {
  vol.fromJSON({"/grant/dep.js": "export const value=1"});
  const resolver = await createRootedSourceResolver("/grant");
  const realpath = vi.spyOn(fs.promises, "realpath");
  const open = vi.spyOn(fs.promises, "open");
  expect(await resolver(specifier, "/grant/entry.js", {})).toBeUndefined();
  expect(realpath).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it.each(["./dep.js", "./sub/../dep.js", "././dep.js"])("canonicalizes allowed dot segments in %s", async specifier => {
  vol.fromJSON({"/grant/dep.js": "export const value=1"});
  const resolver = await createRootedSourceResolver("/grant");
  expect(await resolver(specifier, "/grant/entry.js", {}))
    .toEqual({id: "/grant/dep.js", source: "export const value=1"});
});

it.each(["%2f", "%2F", "%5c", "%2e%2e"])("treats %s as literal filesystem text without URL decoding", async encoded => {
  vol.fromJSON({[`/grant/${encoded}.js`]: "export const value=1", "/outside/secret.js": "secret"});
  const resolver = await createRootedSourceResolver("/grant");
  expect(await resolver(`./${encoded}.js`, "/grant/entry.js", {}))
    .toEqual({id: `/grant/${encoded}.js`, source: "export const value=1"});
});

it("denies an outside referrer and an already revoked signal before filesystem access", async () => {
  vol.fromJSON({"/grant/dep.js": "export const value=1"});
  const resolver = await createRootedSourceResolver("/grant");
  const open = vi.spyOn(fs.promises, "open");
  const realpath = vi.spyOn(fs.promises, "realpath");
  expect(await resolver("./dep.js", "/outside/entry.js", {})).toBeUndefined();
  const controller = new AbortController();
  const reason = new Error("grant revoked");
  controller.abort(reason);
  await expect(resolver("./dep.js", "/grant/entry.js", {signal: controller.signal})).rejects.toBe(reason);
  expect(open).not.toHaveBeenCalled();
  expect(realpath).not.toHaveBeenCalled();
});

it("preserves opaque host-approved specifiers and redirect canonical identity", async () => {
  const requests: string[] = [];
  const sourceResolver = vi.fn((specifier: string) => {
    requests.push(specifier);
    return {id: "https://granted.test/final.js", source: "export const token={}"};
  });
  const specs = ["pkg", "./a/../b", "/absolute", "file:///entry", "https://granted.test/redirect", "encoded%2fpath"];
  const source = specs.map((specifier, i) => `import * as n${i} from ${JSON.stringify(specifier)};`).join("") +
    "export const same=" + specs.map((_, i) => `n0===n${i}`).join("&&");
  expect(await run(source, {sourceType: "module", sourceResolver}))
    .toMatchObject({ok: true, returnValue: {same: true}});
  expect(requests).toEqual(specs);
});

it("deduplicates concurrent identical requests before host work and caches rejection identity", async () => {
  const failure = new Error("denied by host");
  const resolver = vi.fn(async () => {await Promise.resolve(); throw failure;});
  const graph = new SourceModuleGraph({resolver, scope: new Scope(), modules: createModuleEnvironment(undefined, {})});
  try {
    const results = await Promise.allSettled([graph.import("denied", "entry"), graph.import("denied", "entry")]);
    expect(results).toEqual([{status: "rejected", reason: failure}, {status: "rejected", reason: failure}]);
    await expect(graph.import("denied", "entry")).rejects.toBe(failure);
    expect(resolver).toHaveBeenCalledOnce();
    await graph.settle();
  } finally {graph.close();}
});

it("checks host revocation on new requests while preserving already loaded module identity", async () => {
  let granted = true;
  const resolver = vi.fn((id: string) => granted ? {id, source: "export const value=1"} : undefined);
  const realm = createRealm({sourceResolver: resolver});
  try {
    expect(await realm.evaluate("export const value=(await import('dep')).value", {filename: "entry", sourceType: "module"}))
      .toMatchObject({ok: true, returnValue: {value: 1}});
    granted = false;
    expect(await realm.evaluate("export const value=(await import('dep')).value", {filename: "entry", sourceType: "module"}))
      .toMatchObject({ok: true, returnValue: {value: 1}});
    expect(await realm.evaluate("let denied=false;try {await import('new')} catch {denied=true} export {denied}", {filename: "next", sourceType: "module"}))
      .toMatchObject({ok: true, returnValue: {denied: true}});
    expect(resolver.mock.calls.map(([id]) => id)).toEqual(["dep", "new"]);
  } finally {await realm.close();}
});

it.each(["denied", "cancelled"])("settles cooperative host work on %s graph failure", async kind => {
  const controller = new AbortController();
  const reason = new Error("stop linking");
  let pending = 0;
  let started!: () => void;
  const ready = new Promise<void>(resolve => {started = resolve;});
  const execution = run(kind === "denied" ? "import 'pending';import 'denied'" : "import 'pending'", {
    sourceType: "module", signal: controller.signal,
    sourceResolver: (id, _referrer, {signal}) => {
      if (id === "denied") return undefined;
      pending++;
      started();
      return new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => {pending--; reject(signal!.reason);}, {once: true});
      });
    }
  });
  void execution.catch(() => undefined);
  await ready;
  if (kind === "cancelled") controller.abort(reason);
  if (kind === "cancelled") await expect(execution).rejects.toBe(reason);
  else await expect(execution).rejects.toThrow("Source resolver denied");
  expect(pending).toBe(0);
});

it.each(["./dep.js", "../outside/secret.js", "file:///grant/dep.js", "acorn", "node:fs"])("keeps rooted CLI and SDK authority aligned for %s", async specifier => {
  const source = `import {value} from ${JSON.stringify(specifier)};export {value}`;
  vol.fromJSON({"/grant/entry.mjs": source, "/grant/dep.js": "export const value=7", "/outside/secret.js": "export const value=99"});
  const stdout = createSink();
  const stderr = createSink();
  const code = await runCli(["--source-type", "module", "--source-root", "/grant", "/grant/entry.mjs"], {
    readFile: async () => source, stat: async () => ({isFile: () => true}), stdout, stderr
  });
  const execution = run(source, {sourceType: "module", sourceRoot: "/grant", filename: "/grant/entry.mjs"});
  if (specifier === "./dep.js") {
    expect(await execution).toMatchObject({ok: true, returnValue: {value: 7}});
    expect(code).toBe(0);
    expect(JSON.parse(stdout.output())).toEqual({ok: true, returnValue: {value: 7}});
    expect(stderr.output()).toBe("");
  } else {
    await expect(execution).rejects.toThrow("Source resolver denied");
    expect(code).not.toBe(0);
    expect(stderr.output()).toContain("Source resolver denied");
  }
});
