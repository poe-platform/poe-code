import { FsError, MemoryFileSystem, MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem, collectBytes, toByteSource } from "../../src/core.js";
import type { FileSystem, FileStat } from "../../src/core.js";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function rejects(operation: Promise<unknown>, codes: readonly string[]): Promise<void> {
  try { await operation; }
  catch (error) {
    check(error instanceof FsError && codes.includes(error.code), `unexpected error: ${String(error)}`);
    return;
  }
  throw new Error(`expected ${codes.join("/")}`);
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = async (filesystem: FileSystem, path: string): Promise<string> => new TextDecoder().decode(await filesystem.readFile(path));

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function tree(filesystem: FileSystem, path = "/"): Promise<unknown[]> {
  const result: unknown[] = [];
  for (const entry of await filesystem.readdir(path)) {
    const child = `${path === "/" ? "" : path}/${entry.name}`;
    const stat = await filesystem.lstat(child);
    result.push([child, stat.type, stat.mode, stat.nlink,
      stat.type === "directory" ? await tree(filesystem, child)
        : stat.type === "symlink" ? await filesystem.readlink!(child) : [...await filesystem.readFile(child)]]);
  }
  return result;
}

function opaque(filesystem: MemoryFileSystem): FileSystem {
  return new Proxy(filesystem, {
    get(target, key) {
      if (key === "compareEntry") return undefined;
      if (key === "stat" || key === "lstat") return async (path: string) => {
        const stat = await target[key](path);
        const result: FileStat = { type: stat.type, mode: stat.mode, size: stat.size, atimeMs: stat.atimeMs, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
        return result;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

export const wrapperScenarios: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "nested mounts preserve readonly aliases and synthetic directories",
    async run() {
      const storage = new MemoryFileSystem();
      await storage.writeFile("/file", bytes("data"));
      const nested = new MountFileSystem({ root: storage, mounts: { "/readonly": new ReadOnlyFileSystem(storage) } });
      const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/outer/deep": nested } });
      check(await text(mounted, "/outer/deep/file") === "data", "nested read");
      check(await mounted.compareEntry("/outer/deep/file", mounted, "/outer/deep/readonly/file") === "same", "nested alias");
      check(await mounted.compareEntry("/outer", storage, "/") === "unknown", "synthetic authority");
      await rejects(mounted.writeFile("/outer/deep/readonly/file", bytes("bad")), ["EROFS"]);
      await rejects(mounted.rm("/outer", { recursive: true }), ["EBUSY"]);
      check(await text(storage, "/file") === "data", "readonly contents");
    }
  },
  ...[
    ["../b", "/a/new/../escape/created"],
    ["new/../../b", "/a/escape/created"],
    ["../b", "//a/new/../escape/created/"],
    ["new/../../b", "//a/escape/created/"]
  ].map(([target, input]) => ({
    name: `mount confinement preflights ${input}`,
    async run() {
      const root = new MemoryFileSystem();
      const first = new MemoryFileSystem();
      const second = new MemoryFileSystem();
      await first.symlink(target!, "/escape");
      await second.writeFile("/untouched", bytes("sentinel"));
      const mounted = new MountFileSystem({ root, mounts: { "/a": first, "/b": second } });
      const before = JSON.stringify(await Promise.all([root, first, second].map(store => tree(store))));
      await rejects(mounted.mkdir(input!, { recursive: true }), ["EACCES"]);
      check(JSON.stringify(await Promise.all([root, first, second].map(store => tree(store)))) === before, "escape mutated a backend");
    }
  })),
  {
    name: "nested mount boundary refuses symlink traversal before prefix creation",
    async run() {
      const first = new MemoryFileSystem();
      const nested = new MemoryFileSystem();
      await first.symlink("nested", "/escape");
      const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/a": first, "/a/nested": nested } });
      await rejects(mounted.mkdir("/a/new/../escape/created", { recursive: true }), ["EACCES"]);
      await rejects(first.stat("/new"), ["ENOENT"]);
      check((await nested.readdir("/")).length === 0, "nested mutation");
    }
  },
  {
    name: "mount absolute symlinks stay scoped to their backing mount",
    async run() {
      const root = new MemoryFileSystem();
      const mountedStore = new MemoryFileSystem();
      await root.writeFile("/file", bytes("root"));
      await mountedStore.writeFile("/file", bytes("mounted"));
      await mountedStore.symlink("/file", "/link");
      const mounted = new MountFileSystem({ root, mounts: { "/mount": mountedStore } });
      check(await text(mounted, "/mount/link") === "mounted", "wrong root selected");
      check(await mounted.realpath("/mount/link") === "/mount/file", "wrong canonical path");
    }
  },
  {
    name: "mount refuses same-entry copies before writes and unknown overwrite authority",
    async run() {
      const storage = new MemoryFileSystem();
      await storage.writeFile("/file", bytes("sentinel"));
      await storage.link("/file", "/alias");
      const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/left": storage, "/right": new ReadOnlyFileSystem(storage) } });
      await rejects(mounted.copyFile("/right/alias", "/left/file"), ["EINVAL"]);
      check(await text(storage, "/file") === "sentinel", "alias truncation");
      const first = new MemoryFileSystem();
      const second = new MemoryFileSystem();
      await first.writeFile("/file", bytes("first"));
      await second.writeFile("/file", bytes("second"));
      const unknown = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": opaque(first), "/second": opaque(second) } });
      await rejects(unknown.copyFile("/first/file", "/second/file"), ["ENOTSUP"]);
      check(await text(second, "/file") === "second", "unknown target overwrite");
      await unknown.copyFile("/first/file", "/second/new");
      check(await text(second, "/new") === "first", "exclusive missing-target copy");
    }
  },
  {
    name: "mount streams disjoint copies but rejects cross-mount rename",
    async run() {
      const first = new MemoryFileSystem();
      const second = new MemoryFileSystem();
      await first.writeFile("/file", new Uint8Array([0, 128, 255]));
      const mounted = new MountFileSystem({ root: first, mounts: { "/target": second } });
      await mounted.copyFile("/file", "/target/file");
      check(JSON.stringify([...await second.readFile("/file")]) === "[0,128,255]", "binary copy");
      await rejects(mounted.rename("/file", "/target/renamed"), ["EXDEV"]);
      check((await first.stat("/file")).size === 3, "source disappeared");
    }
  },
  {
    name: "overlay whiteouts and recreated directories never expose lower descendants",
    async run() {
      const lower = new MemoryFileSystem();
      await lower.mkdir("/tree/sub", { recursive: true });
      await lower.writeFile("/tree/sub/hidden", bytes("lower"));
      await lower.writeFile("/tree-other", bytes("sibling"));
      const before = JSON.stringify(await tree(lower));
      const overlay = new OverlayFileSystem({ lower: new ReadOnlyFileSystem(lower), upper: new MemoryFileSystem() });
      await overlay.rm("/tree", { recursive: true });
      await overlay.mkdir("/tree/sub", { recursive: true });
      await rejects(overlay.readFile("/tree/sub/hidden"), ["ENOENT"]);
      check((await overlay.readdir("/tree/sub")).length === 0, "lower descendants resurfaced");
      check(await text(overlay, "/tree-other") === "sibling", "prefix sibling hidden");
      await overlay.writeFile("/tree/sub/hidden", bytes("new"));
      check(await text(overlay, "/tree/sub/hidden") === "new", "replacement missing");
      check(JSON.stringify(await tree(lower)) === before, "lower mutated");
    }
  },
  {
    name: "overlay copy-up preserves metadata and changes authoritative backing identity",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      await lower.mkdir("/parent/sub", { recursive: true, mode: 0o750 });
      await lower.writeFile("/parent/sub/file", bytes("lower"), { mode: 0o640 });
      await lower.utimes("/parent/sub/file", 123, 456);
      const overlay = new OverlayFileSystem({ lower: new ReadOnlyFileSystem(lower), upper });
      const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/view": overlay } });
      check(await mounted.compareEntry("/view/parent/sub/file", lower, "/parent/sub/file") === "same", "lower identity");
      check((await upper.readdir("/")).length === 0, "comparison copied up");
      await overlay.chmod("/parent/sub/file", 0o600);
      check((await upper.stat("/parent")).mode % 4096 === 0o750, "parent mode");
      check((await upper.stat("/parent/sub/file")).mtimeMs === 456, "mtime");
      check(await mounted.compareEntry("/view/parent/sub/file", lower, "/parent/sub/file") === "distinct", "copy-up identity");
      check(await mounted.compareEntry("/view/parent/sub/file", upper, "/parent/sub/file") === "same", "upper identity");
      check((await lower.stat("/parent/sub/file")).mode % 4096 === 0o640, "lower mode changed");
    }
  },
  {
    name: "overlay refuses ambiguous hardlink copy-up and readonly upper writes",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      await lower.writeFile("/file", bytes("lower"));
      await lower.link("/file", "/alias");
      const overlay = new OverlayFileSystem({ lower, upper });
      await rejects(overlay.writeFile("/file", bytes("bad")), ["ENOTSUP"]);
      check((await upper.readdir("/")).length === 0, "hardlink copy-up effects");
      const readonly = new OverlayFileSystem({ lower, upper: new ReadOnlyFileSystem(upper) });
      await rejects(readonly.writeFile("/new", bytes("bad")), ["EROFS"]);
      check(await text(lower, "/alias") === "lower", "hardlink contents changed");
    }
  },
  ...[false, true].map(wrap => ({
    name: `overlay rejects ambiguous lower mount links (readonly=${wrap})`,
    async run() {
      const root = new MemoryFileSystem();
      const mountedStore = new MemoryFileSystem();
      await root.writeFile("/file", bytes("root"));
      await mountedStore.writeFile("/file", bytes("mounted"));
      await mountedStore.symlink("/file", "/link");
      const mounted = new MountFileSystem({ root, mounts: { "/mount": mountedStore } });
      const upper = new MemoryFileSystem();
      const overlay = new OverlayFileSystem({ lower: wrap ? new ReadOnlyFileSystem(mounted) : mounted, upper });
      await rejects(overlay.readFile("/mount/link"), ["ENOTSUP", "ENOENT", "EACCES"]);
      await rejects(overlay.writeFile("/mount/link", bytes("bad")), ["ENOTSUP", "ENOENT", "EACCES"]);
      check(await text(overlay, "/file") === "root", "wrong namespace leaked");
      check(await text(mountedStore, "/file") === "mounted", "mounted lower mutated");
      check((await upper.readdir("/")).length === 0, "ambiguous copy-up effects");
    }
  })),
  {
    name: "overlay target whiteouts remain effective through symlinks",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      await lower.writeFile("/target", bytes("lower"));
      await upper.symlink("/target", "/alias");
      const overlay = new OverlayFileSystem({ lower, upper });
      await overlay.rm("/target");
      await rejects(overlay.readFile("/alias"), ["ENOENT"]);
      await rejects(overlay.writeFile("/alias", bytes("unprovable")), ["ENOENT"]);
      await overlay.writeFile("/target", bytes("created directly"));
      await overlay.writeFile("/alias", bytes("new"));
      check(await text(overlay, "/target") === "new", "link replacement");
      check(await text(lower, "/target") === "lower", "lower whiteout mutation");
    }
  },
  {
    name: "overlay never exposes or permits mutation of retained staging garbage",
    async run() {
      const upper = new MemoryFileSystem();
      const remove = upper.rm.bind(upper);
      let failCleanup = true;
      upper.rm = async (path, options) => {
        if (failCleanup && path.startsWith("/.virtual-bash-overlay-")) throw new FsError("EIO");
        await remove(path, options);
      };
      const overlay = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper });
      await overlay.writeFile("/file", bytes("data"));
      const garbage = (await upper.readdir("/")).find(entry => entry.name.startsWith(".virtual-bash-overlay-"));
      check(garbage !== undefined, "garbage fixture");
      check((await overlay.readdir("/")).every(entry => !entry.name.startsWith(".virtual-bash-overlay-")), "staging exposed");
      await rejects(overlay.writeFile(`/${garbage!.name}/entry/descendant`, bytes("bad")), ["EBUSY", "ENOENT", "ENOTSUP"]);
      failCleanup = false;
      await overlay.cleanup();
      check((await upper.readdir("/")).every(entry => !entry.name.startsWith(".virtual-bash-overlay-")), "garbage not cleaned");
      check(await text(overlay, "/file") === "data", "cleanup damaged published data");
    }
  },
  {
    name: "failed overlay publication preserves upper, lower, and whiteouts",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      await lower.writeFile("/file", bytes("lower"));
      await lower.writeFile("/removed", bytes("hidden"));
      await upper.writeFile("/file", bytes("upper"));
      const overlay = new OverlayFileSystem({ lower, upper });
      await overlay.rm("/removed");
      const rename = upper.rename.bind(upper);
      upper.rename = async (source, destination, options) => {
        if (destination === "/file") throw new FsError("ENOSPC");
        await rename(source, destination, options);
      };
      await rejects(overlay.writeStream("/file", toByteSource(bytes("bad"))), ["ENOSPC"]);
      check(await text(overlay, "/file") === "upper", "failed publication changed upper");
      check(await text(lower, "/file") === "lower", "failed publication changed lower");
      await rejects(overlay.stat("/removed"), ["ENOENT"]);
      check((await upper.readdir("/")).every(entry => !entry.name.startsWith(".virtual-bash-overlay-")), "failed staging remains");
    }
  },
  {
    name: "overlay streaming limits preserve existing data and byte ranges",
    async run() {
      const upper = new MemoryFileSystem();
      const overlay = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper, maxBufferBytes: 4 });
      await overlay.writeStream("/file", toByteSource(new Uint8Array([0, 128, 255, 2])));
      await rejects(overlay.writeStream("/file", toByteSource(new Uint8Array(5))), ["EFBIG"]);
      const result = await collectBytes(overlay.readStream("/file", { start: 1, endExclusive: 3, chunkSize: 1 }), { maxBytes: 2 });
      check(JSON.stringify([...result]) === "[128,255]", "stream ranges");
      check((await upper.readdir("/")).length === 1, "stream limit staging leak");
    }
  },
  {
    name: "cancelled overlay streaming preserves exact reason and existing contents",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      await lower.writeFile("/file", bytes("old"));
      const overlay = new OverlayFileSystem({ lower, upper });
      const controller = new AbortController();
      const reason = { cancellation: true };
      let returned = false;
      const source = (async function* () {
        try { yield bytes("first"); controller.abort(reason); yield bytes("second"); }
        finally { returned = true; }
      })();
      try { await overlay.writeStream("/file", source, { signal: controller.signal }); throw new Error("expected cancellation"); }
      catch (error) { check(error === reason, "cancellation identity"); }
      await Promise.resolve();
      check(returned, "producer not returned");
      check(await text(overlay, "/file") === "old", "cancelled publication");
      check((await upper.readdir("/")).length === 0, "cancelled staging leak");
    }
  },
  {
    name: "cancelled queued writes do not strand subsequent overlay operations",
    async run() {
      const upper = new MemoryFileSystem();
      const write = upper.writeFile.bind(upper);
      const entered = barrier();
      const resume = barrier();
      let first = true;
      upper.writeFile = async (path, data, options) => {
        if (first) { first = false; entered.release(); await resume.promise; }
        await write(path, data, options);
      };
      const overlay = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper });
      const pending = overlay.writeFile("/first", bytes("first"));
      await entered.promise;
      const controller = new AbortController();
      const reason = { cancelled: true };
      let next: Promise<void> | undefined;
      try {
        const cancelled = overlay.writeFile("/cancelled", bytes("bad"), { signal: controller.signal });
        controller.abort(reason);
        try { await cancelled; throw new Error("expected cancellation"); }
        catch (error) { check(error === reason, "queued cancellation identity"); }
        next = overlay.writeFile("/next", bytes("next"));
        const independent = new OverlayFileSystem({ lower: new MemoryFileSystem(), upper: new MemoryFileSystem() });
        await independent.writeFile("/independent", bytes("ok"));
      } finally { resume.release(); }
      await pending;
      await next;
      check(await text(overlay, "/next") === "next", "queue stranded");
      await rejects(overlay.stat("/cancelled"), ["ENOENT"]);
    }
  },
  {
    name: "parallel wrapper comparisons retain aliases and do not copy up",
    async run() {
      const lower = new MemoryFileSystem();
      const upper = new MemoryFileSystem();
      const peer = new MemoryFileSystem();
      await lower.writeFile("/file", bytes("lower"));
      await peer.writeFile("/file", bytes("peer"));
      const overlay = new OverlayFileSystem({ lower, upper });
      const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/overlay": overlay, "/readonly": new ReadOnlyFileSystem(lower), "/peer": peer } });
      const options = Object.freeze({});
      const results = await Promise.all(Array.from({ length: 12 }, async (_, index) => mounted.compareEntry("/overlay/file", mounted, index % 2 === 0 ? "/readonly/file" : "/peer/file", options)));
      check(results.every((result, index) => result === (index % 2 === 0 ? "same" : "distinct")), "cross-operation authority");
      check((await upper.readdir("/")).length === 0, "comparison mutated backing");
      check(Reflect.ownKeys(options).length === 0, "options mutated");
    }
  }
];
