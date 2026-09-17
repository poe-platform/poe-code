import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {fs, vol} from "memfs";
vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
import {createRootedSourceResolver} from "./source-files.js";

beforeEach(() => {
  vol.reset();
  vol.fromJSON({"/grant/dep.js": "export const value=1"});
});
afterEach(() => {vi.restoreAllMocks();});

it.each(["realpath", "stat"] as const)("does not start another filesystem operation after revocation during %s", async operation => {
  const resolver = await createRootedSourceResolver("/grant");
  const controller = new AbortController();
  const reason = new Error("source grant revoked");
  const original = fs.promises[operation].bind(fs.promises);
  vi.spyOn(fs.promises, operation).mockImplementation(async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    controller.abort(reason);
    return result;
  });
  const open = vi.spyOn(fs.promises, "open");
  const stat = operation === "realpath" ? vi.spyOn(fs.promises, "stat") : undefined;
  await expect(resolver("./dep.js", "/grant/entry.js", {signal: controller.signal})).rejects.toBe(reason);
  expect(open).not.toHaveBeenCalled();
  if (stat !== undefined) expect(stat).not.toHaveBeenCalled();
});

it.each(["open", "handleStat", "finalRealpath"] as const)("closes the acquired handle without continuing after revocation during %s", async operation => {
  const resolver = await createRootedSourceResolver("/grant");
  const controller = new AbortController();
  const reason = new Error("source grant revoked");
  const handle = await fs.promises.open("/grant/dep.js", "r");
  const close = vi.spyOn(handle, "close");
  const read = vi.spyOn(handle, "readFile");
  const handleStat = handle.stat.bind(handle);
  const stat = vi.spyOn(handle, "stat").mockImplementation(async () => {
    const result = await handleStat();
    if (operation === "handleStat") controller.abort(reason);
    return result;
  });
  vi.spyOn(fs.promises, "open").mockImplementation(async () => {
    if (operation === "open") controller.abort(reason);
    return handle;
  });
  const realpath = fs.promises.realpath.bind(fs.promises);
  let canonicalizations = 0;
  vi.spyOn(fs.promises, "realpath").mockImplementation(async (...args) => {
    const result = await realpath(...args);
    canonicalizations++;
    if (operation === "finalRealpath" && canonicalizations === 2) controller.abort(reason);
    return result;
  });
  try {
    await expect(resolver("./dep.js", "/grant/entry.js", {signal: controller.signal})).rejects.toBe(reason);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    if (operation === "open") expect(stat).not.toHaveBeenCalled();
    if (operation !== "finalRealpath") expect(canonicalizations).toBe(1);
  } finally {
    if (close.mock.calls.length === 0) await handle.close();
  }
});

it.each(["realpath", "stat", "open"] as const)("preserves revocation when pending %s fails with a missing-file error", async operation => {
  const resolver = await createRootedSourceResolver("/grant");
  const controller = new AbortController();
  const reason = new Error("grant revoked while filesystem work was pending");
  vi.spyOn(fs.promises, operation).mockImplementation(async () => {
    controller.abort(reason);
    throw Object.assign(new Error("missing"), {code: "ENOENT"});
  });
  await expect(resolver("./dep.js", "/grant/entry.js", {signal: controller.signal})).rejects.toBe(reason);
});

it("preserves revocation when the final canonical path also changes", async () => {
  const resolver = await createRootedSourceResolver("/grant");
  const controller = new AbortController();
  const reason = new Error("source grant revoked");
  const handle = await fs.promises.open("/grant/dep.js", "r");
  const close = vi.spyOn(handle, "close");
  const read = vi.spyOn(handle, "readFile");
  vi.spyOn(fs.promises, "open").mockResolvedValue(handle);
  vi.spyOn(fs.promises, "realpath").mockResolvedValueOnce("/grant/dep.js").mockImplementation(async () => {
    controller.abort(reason);
    return "/outside/dep.js";
  });
  try {
    await expect(resolver("./dep.js", "/grant/entry.js", {signal: controller.signal})).rejects.toBe(reason);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    if (close.mock.calls.length === 0) await handle.close();
  }
});
