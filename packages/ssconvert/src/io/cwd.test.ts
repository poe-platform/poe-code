import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { resolveVfsCwd, createEngine, createResourceIO, type Codec } from "../index.js";

const signal = new AbortController().signal;
const identityScope = {};
const directory = { type: "directory", identityScope, dev: 0, ino: 0 };

it.each([undefined, "", "relative", "/bad\0name", "/actual"])("does not probe unusable or identical PWD %s", async pwd => {
  const stat = vi.fn(async () => directory);
  expect(await resolveVfsCwd("/actual", pwd, { stat }, signal)).toBe("/actual");
  expect(stat).not.toHaveBeenCalled();
});

it("accepts equal scoped zero device/inode identities and follows a real VFS alias", async () => {
  const stat = vi.fn(async () => directory);
  expect(await resolveVfsCwd("/actual", "/alias", { stat }, signal)).toBe("/alias");
  expect(stat.mock.calls).toEqual([["/actual", { signal }], ["/alias", { signal }]]);
  const volume = Volume.fromJSON({ "/actual/input.csv": "42\n" });
  volume.symlinkSync("/actual", "/alias");
  expect(await resolveVfsCwd("/actual", "/alias", { async stat(path) {
    const value = volume.statSync(path);
    return { type: value.isDirectory() ? "directory" : "file", identityScope: volume, dev: value.dev, ino: value.ino };
  } }, signal)).toBe("/alias");
});

it.each([
  { ...directory, identityScope: {} }, { ...directory, ino: 1 }, { ...directory, dev: 1 },
  { type: "directory", dev: 0, ino: 0 }, { type: "directory", identityScope },
  { ...directory, dev: -1 }, { ...directory, ino: NaN }, { ...directory, type: "file" }
])("does not treat distinct or unknown directory identities as aliases (%#)", async alias => {
  expect(await resolveVfsCwd("/actual", "/alias", { async stat(path) { return path === "/actual" ? directory : alias; } }, signal))
    .toBe("/actual");
});

it("supports authoritative opaque identities but gives complete numeric identities precedence", async () => {
  const opaque = { type: "directory", identityScope, opaqueIdentity: "directory-key" };
  expect(await resolveVfsCwd("/actual", "/alias", { async stat() { return opaque; } }, signal)).toBe("/alias");
  expect(await resolveVfsCwd("/actual", "/alias", { async stat(path) { return { ...opaque, dev: 0, ino: path === "/actual" ? 0 : 1 }; } }, signal))
    .toBe("/actual");
  expect(await resolveVfsCwd("/actual", "/alias", { async stat() { return { ...opaque, opaqueIdentity: "" }; } }, signal)).toBe("/actual");
});

it("snapshots accessor-backed directory identity fields exactly once", async () => {
  class DirectoryIdentity {
    reads = new Set<string>();
    field<T>(key: string, value: T): T {
      if (this.reads.has(key)) throw new Error(`Repeated ${key} read`);
      this.reads.add(key);
      return value;
    }
    get type() { return this.field("type", "directory"); }
    get identityScope() { return this.field("identityScope", identityScope); }
    get dev() { return this.field("dev", 0); }
    get ino() { return this.field("ino", 0); }
    get opaqueIdentity() { return this.field("opaqueIdentity", undefined); }
  }
  expect(await resolveVfsCwd("/actual", "/alias", {
    async stat() { return new DirectoryIdentity(); }
  }, signal)).toBe("/alias");
});

it("retains actual cwd when metadata is unavailable and does not trust reused host metadata", async () => {
  expect(await resolveVfsCwd("/actual", "/alias", {}, signal)).toBe("/actual");
  for (const code of ["ENOENT", "ENOTDIR", "EACCES", "ELOOP", "ENOTSUP"])
    expect(await resolveVfsCwd("/actual", "/alias", { async stat() { throw Object.assign(new Error(code), { code }); } }, signal)).toBe("/actual");
  const reused = { ...directory };
  expect(await resolveVfsCwd("/actual", "/alias", { async stat(path) {
    if (path === "/alias") reused.ino = 1;
    return reused;
  } }, signal)).toBe("/actual");
});

it.each(["before", "first", "second", "failure"])("preserves cancellation %s directory acquisition", async when => {
  const controller = new AbortController(), reason = { stop: when };
  const stat = vi.fn(async (path: string) => {
    if (when === "first" || when === "second" && path === "/alias" || when === "failure") controller.abort(reason);
    if (when === "failure") throw new Error("host detail");
    return directory;
  });
  if (when === "before") controller.abort(reason);
  await expect(resolveVfsCwd("/actual", "/alias", { stat }, controller.signal)).rejects.toBe(reason);
  expect(stat).toHaveBeenCalledTimes(when === "before" ? 0 : when === "second" ? 2 : 1);
});

it("binds SDK reads, writes and diagnostics to the verified alias without altering GETENV", async () => {
  const volume = Volume.fromJSON({ "/actual/input.fixture": "original" });
  volume.symlinkSync("/actual", "/alias");
  const pwd = "/alias", observed: string[] = [], paths: string[] = [];
  const cwd = await resolveVfsCwd("/actual", pwd, { async stat(path) {
    const value = volume.statSync(path);
    return { type: value.isDirectory() ? "directory" : "file", identityScope: volume, dev: value.dev, ino: value.ino };
  } }, signal);
  const codec: Codec = { id: "fixture", description: "Logical cwd fixture", extensions: ["fixture"], probeContent: () => true,
    async read(_bytes, context) {
      observed.push(context.environment.env.PWD!);
      return { sheets: [{ id: "s", name: "Sheet", cells: [] }] };
    }, async write() { return new TextEncoder().encode("converted"); } };
  const engine = createEngine({ codecs: [codec], environment: { env: { PWD: pwd }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 1000, cells: 10, sheets: 2, operations: 10 },
    filesystem: createResourceIO({ cwd, filesystem: {
      async read(path) { paths.push(path); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { paths.push(path); volume.writeFileSync(path, bytes); }
    } }) });
  try {
    await engine.convert({ input: { kind: "resource", uri: "input.fixture" }, destination: { kind: "resource", uri: "output.fixture" } }, { signal });
    expect(paths).toEqual(["/alias/input.fixture", "/alias/output.fixture"]);
    expect(observed).toEqual([pwd]);
    expect(volume.readFileSync("/actual/output.fixture", "utf8")).toBe("converted");
    await expect(engine.convert({ input: { kind: "resource", uri: "missing.fixture" }, destination: { kind: "resource", uri: "output.fixture" } }, { signal }))
      .rejects.toThrow("/alias/missing.fixture");
  } finally { await engine.dispose(); }
});
