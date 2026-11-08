import * as native from "node:fs/promises";
import { fs, vol } from "memfs";
import { beforeEach, expect, test, vi } from "vitest";
import { RealFileSystem } from "../src/fs/real/index.js";

const host = vi.hoisted(() => ({ identifiers: false, timestamps: false }));
function reported<Stat extends { ino: number | bigint; dev: number | bigint }>(stat: Stat): Stat {
  const bigint = typeof stat.ino === "bigint";
  if (host.identifiers) Object.assign(stat, { ino: bigint ? 0n : 0, dev: bigint ? 0n : 0 });
  if (host.timestamps) {
    Object.assign(stat, { atimeMs: bigint ? 0n : 0, mtimeMs: bigint ? 0n : 0, ctimeMs: bigint ? 0n : 0, birthtimeMs: bigint ? 0n : 0 });
    if (bigint) Object.assign(stat, { atimeNs: 0n, mtimeNs: 0n, ctimeNs: 0n, birthtimeNs: 0n });
  }
  return stat;
}
vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises,
    stat: async (...args: Parameters<typeof fs.promises.stat>) => reported(await fs.promises.stat(...args)),
    lstat: async (...args: Parameters<typeof fs.promises.lstat>) => reported(await fs.promises.lstat(...args)),
    copyFile: vi.fn(fs.promises.copyFile),
  };
});
vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return { ...fs, lstatSync: (...args: Parameters<typeof fs.lstatSync>) => { const stat = fs.lstatSync(...args); return stat === undefined ? stat : reported(stat); } };
});
beforeEach(() => {
  vi.clearAllMocks();
  host.identifiers = false;
  host.timestamps = false;
  vol.reset();
  vol.fromJSON({ "/machine/file": "original", "/machine/other": "existing" });
  fs.chmodSync("/machine/file", 0o640);
});

for (const identifiers of [false, true]) test(`does not advertise placeholder metadata authority: inode=${identifiers ? "zero" : "native"}`, async () => {
  host.identifiers = identifiers;
  host.timestamps = true;
  const filesystem = new RealFileSystem("/machine");
  for (const stat of [await filesystem.stat("/file"), await filesystem.lstat("/file")]) {
    expect(stat.size).toBe(8);
    expect(stat.opaqueVersion).toBeUndefined();
    if (identifiers) expect(stat.identityScope).toBeUndefined();
    else expect(stat.identityScope).toBe(Symbol.for("virtual-bash.fs.native"));
  }
});

test("zero inode never publishes a version, even with nonzero native timestamps", async () => {
  host.identifiers = true;
  const stat = await new RealFileSystem("/machine").stat("/file");
  expect(stat.identityScope).toBeUndefined();
  expect(stat.opaqueVersion).toBeUndefined();
});

test("unknown native identity refuses an existing copy target before mutation without claiming an alias", async () => {
  host.identifiers = true;
  const filesystem = new RealFileSystem("/machine");
  await expect(filesystem.copyFile("/file", "/other")).rejects.toMatchObject({ code: "ENOTSUP" });
  expect(native.copyFile).not.toHaveBeenCalled();
  expect(fs.readFileSync("/machine/other", "utf8")).toBe("existing");
  await expect(filesystem.copyFile("/file", "/other", { exclusive: true })).rejects.toMatchObject({ code: "EEXIST" });
  await filesystem.copyFile("/file", "/new");
  expect(fs.readFileSync("/machine/new", "utf8")).toBe("original");
});

test("placeholder receipts cannot authorize a stale conditional mutation", async () => {
  host.identifiers = true;
  host.timestamps = true;
  const filesystem = new RealFileSystem("/machine");
  const parent = await filesystem.lstat("/");
  const expected = await filesystem.lstat("/file");
  fs.renameSync("/machine/file", "/machine/saved");
  fs.writeFileSync("/machine/file", "replaced", { mode: 0o640 });
  await expect(filesystem.chmod("/file", 0o700, { parent, expected, ancestors: [{ path: "/", stat: parent }] }))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.statSync("/machine/file").mode & 0o777).toBe(0o640);
  expect(fs.statSync("/machine/saved").mode & 0o777).toBe(0o640);
});

test("current native metadata must retain authority after a valid conditional receipt", async () => {
  const filesystem = new RealFileSystem("/machine");
  const parent = await filesystem.lstat("/");
  const expected = await filesystem.lstat("/file");
  host.identifiers = true;
  host.timestamps = true;
  await expect(filesystem.chmod("/file", 0o700, { parent, expected, ancestors: [{ path: "/", stat: parent }] }))
    .rejects.toMatchObject({ code: "ENOTSUP" });
  expect(fs.statSync("/machine/file").mode & 0o777).toBe(0o640);
});
