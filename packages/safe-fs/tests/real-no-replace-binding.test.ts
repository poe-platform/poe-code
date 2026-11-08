import { beforeEach, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { RealFileSystem } from "../src/fs/real/index.js";
import { Shell } from "../../safe-bash/src/shell/shell.js";
import { lineEndingCommands } from "../../safe-bash/src/commands/line-endings/index.js";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, ...(await import("memfs")).fs };
});

beforeEach(() => { vol.reset(); vol.fromJSON({ "/root/source": "original", "/root/destination": "winner" }); });

it("admits an explicitly bound primitive and passes resolved host operands", async () => {
  const renameNoReplace = vi.fn(async () => {});
  const fs = new RealFileSystem({ root: "/root", renameNoReplace });
  expect(fs.capabilities.atomicRenameNoReplace).toBe(true);
  const signal = new AbortController().signal;
  await fs.rename("/source", "/absent", { noReplace: true, signal });
  expect(renameNoReplace).toHaveBeenCalledExactlyOnceWith("/root/source", "/root/absent", { signal });
});

it.each(["EEXIST", "EXDEV", "ENOTSUP"])("propagates %s without falling back or leaking host paths", async code => {
  const renameNoReplace = vi.fn(async () => { throw Object.assign(new Error("/root/private"), { code }); });
  const fs = new RealFileSystem({ root: "/root", renameNoReplace });
  const error = await fs.rename("/source", "/destination", { noReplace: true }).catch(error => error);
  expect(error).toMatchObject({ code, path: "/source", dest: "/destination" });
  expect(error.cause).toBeUndefined();
  expect(error.message).not.toContain("/root");
  expect(await fs.readFile("/source")).toEqual(new TextEncoder().encode("original"));
  expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("winner"));
});

it("retains ordinary rename and refuses unbound no-replace before resolution", async () => {
  const renameNoReplace = vi.fn();
  const fs = new RealFileSystem({ root: "/root", renameNoReplace });
  await fs.rename("/source", "/destination");
  expect(renameNoReplace).not.toHaveBeenCalled();
  expect(await fs.readFile("/destination")).toEqual(new TextEncoder().encode("original"));
  const unbound = new RealFileSystem("/missing-root");
  expect(unbound.capabilities.atomicRenameNoReplace).toBe(false);
  await expect(unbound.rename("/source", "/absent", { noReplace: true })).rejects.toMatchObject({ code: "ENOTSUP" });
});

it("refuses escaped paths and cancellation before calling the binding", async () => {
  vol.symlinkSync("/outside", "/root/escape");
  const renameNoReplace = vi.fn();
  const fs = new RealFileSystem({ root: "/root", renameNoReplace });
  await expect(fs.rename("/source", "/escape/file", { noReplace: true })).rejects.toMatchObject({ code: "EACCES" });
  const signal = AbortSignal.abort(new Error("cancel"));
  await expect(fs.rename("/source", "/absent", { noReplace: true, signal })).rejects.toBe(signal.reason);
  expect(renameNoReplace).not.toHaveBeenCalled();
});

it.each(["dos2unix", "unix2dos"])("%s publishes new output through the binding, preserving its input", async command => {
  vol.writeFileSync("/root/input", "a\r\nlast");
  // In-memory host double only: this does not qualify a native filesystem primitive.
  const renameNoReplace = vi.fn(async (source: string, destination: string) => {
    try { vol.lstatSync(destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      vol.renameSync(source, destination);
      return;
    }
    throw Object.assign(new Error("exists"), { code: "EEXIST" });
  });
  const fs = new RealFileSystem({ root: "/root", renameNoReplace });
  const shell = new Shell({ fs }).use(lineEndingCommands());
  try {
    const result = await shell.exec(`${command} --newfile /input /output`);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(vol.readFileSync("/root/output", "utf8")).toBe(command === "dos2unix" ? "a\nlast" : "a\r\nlast");
    expect(vol.readFileSync("/root/input", "utf8")).toBe("a\r\nlast");
    expect(renameNoReplace).toHaveBeenCalledOnce();
    expect(vol.readdirSync("/root")).not.toContain(".line-ending-1");
  } finally { await shell.dispose(); }
});

it.each(["dos2unix", "unix2dos"])("%s preserves a competing destination and cleans its stage", async command => {
  vol.writeFileSync("/root/input", "a\r\nlast");
  const renameNoReplace = vi.fn(async (_source: string, destination: string) => {
    vol.writeFileSync(destination, "competing output");
    throw Object.assign(new Error("exists"), { code: "EEXIST" });
  });
  const shell = new Shell({ fs: new RealFileSystem({ root: "/root", renameNoReplace }) }).use(lineEndingCommands());
  try {
    expect((await shell.exec(`${command} --newfile /input /output`)).exitCode).not.toBe(0);
    expect(renameNoReplace).toHaveBeenCalledOnce();
    expect(vol.readFileSync("/root/output", "utf8")).toBe("competing output");
    expect(vol.readFileSync("/root/input", "utf8")).toBe("a\r\nlast");
    expect(vol.readdirSync("/root")).not.toContain(".line-ending-1");
  } finally { await shell.dispose(); }
});

it.each(["dos2unix", "unix2dos"])("%s explicitly refuses the unbound profile without creating output", async command => {
  vol.writeFileSync("/root/input", "a\r\nlast");
  const shell = new Shell({ fs: new RealFileSystem("/root") }).use(lineEndingCommands());
  try {
    const result = await shell.exec(`${command} --newfile /input /output`);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("new destination requires atomic no-replace rename capability");
    expect(vol.readFileSync("/root/input", "utf8")).toBe("a\r\nlast");
    expect(vol.readdirSync("/root")).toEqual(["destination", "input", "source"]);
  } finally { await shell.dispose(); }
});
