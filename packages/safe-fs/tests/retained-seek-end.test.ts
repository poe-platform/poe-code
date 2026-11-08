import { expect, it, vi } from "vitest";
import type { FileReadHandle, FileResizeHandle, FsOptions } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";

function fixture(kind: "read" | "resize", seek?: (options?: FsOptions) => Promise<bigint>) {
  const controller = new AbortController();
  const charge = vi.fn();
  const filesystem = new MemoryFileSystem();
  Object.defineProperty(filesystem, "capabilities", { value: {
    ...filesystem.capabilities, retainedRead: true, retainedResize: true,
  } });
  let closed = false;
  const original = {
    async stat() { throw new Error("unexpected stat"); },
    async read() { return new Uint8Array(); },
    async truncate() {},
    close: vi.fn(async () => { closed = true; }),
    ...(seek ? { seekEnd: seek } : {}),
  };
  filesystem.openReadFile = async () => original;
  filesystem.openResizeFile = async () => original;
  const scoped = scopeFileSystem(filesystem, charge, controller.signal);
  const open = async (): Promise<FileReadHandle | FileResizeHandle> => kind === "read"
    ? scoped.openReadFile!("/file") : scoped.openResizeFile!("/file");
  return { controller, charge, original, open, isClosed: () => closed };
}

for (const kind of ["read", "resize"] as const) {
  it(`${kind} scope preserves exact retained end offsets and receiver`, async () => {
    const offset = (1n << 63n) - 1n;
    const contexts: unknown[] = [];
    const setup = fixture(kind, async function (this: unknown, options) {
      contexts.push(this);
      expect(options?.signal).toBe(setup.controller.signal);
      return offset;
    });
    const handle = await setup.open();
    try {
      expect(typeof handle.seekEnd).toBe("function");
      expect(await handle.seekEnd!()).toBe(offset);
      expect(contexts).toEqual([setup.original]);
      expect(setup.charge).toHaveBeenCalledTimes(2);
    } finally { await handle.close(); }
    expect(setup.original.close).toHaveBeenCalledTimes(1);
  });

  it(`${kind} scope does not synthesize unsupported end seeking`, async () => {
    const setup = fixture(kind);
    const handle = await setup.open();
    try { expect(handle.seekEnd).toBeUndefined(); }
    finally { await handle.close(); }
  });

  for (const reason of [false, null, 0, ""]) {
    it(`${kind} scope refuses end seeking after cancellation ${JSON.stringify(reason)}`, async () => {
      const seek = vi.fn(async () => 0n);
      const setup = fixture(kind, seek);
      const handle = await setup.open();
      try {
        expect(typeof handle.seekEnd).toBe("function");
        setup.controller.abort(reason);
        await expect(handle.seekEnd!()).rejects.toBe(reason);
        expect(seek).not.toHaveBeenCalled();
        expect(setup.charge).toHaveBeenCalledTimes(1);
      } finally { await handle.close(); }
    });
  }

  it(`${kind} scope combines operation cancellation with its lifetime signal`, async () => {
    const operation = new AbortController();
    let observed: AbortSignal | undefined;
    const setup = fixture(kind, async options => {
      observed = options?.signal;
      operation.abort(false);
      observed?.throwIfAborted();
      return 0n;
    });
    const handle = await setup.open();
    try {
      expect(typeof handle.seekEnd).toBe("function");
      await expect(handle.seekEnd!({ signal: operation.signal })).rejects.toBe(false);
      expect(observed?.aborted).toBe(true);
      expect(setup.controller.signal.aborted).toBe(false);
    } finally { await handle.close(); }
  });

  it(`${kind} scope checks cancellation after charging end-seek admission`, async () => {
    const seek = vi.fn(async () => 0n);
    const setup = fixture(kind, seek);
    const handle = await setup.open();
    try {
      setup.charge.mockImplementation(() => { setup.controller.abort(false); });
      await expect(handle.seekEnd!()).rejects.toBe(false);
      expect(seek).not.toHaveBeenCalled();
    } finally { await handle.close(); }
  });

  it(`${kind} scope preserves cancellation after an admitted seek resolves`, async () => {
    const setup = fixture(kind, async () => {
      setup.controller.abort(0);
      return 0n;
    });
    const handle = await setup.open();
    try { await expect(handle.seekEnd!()).rejects.toBe(0); }
    finally { await handle.close(); }
  });

  it(`${kind} scope never dispatches a canceled seek after reading caller options`, async () => {
    for (let cancelAt = 1; cancelAt <= 8; cancelAt++) {
      let reads = 0;
      let canceledDispatch = false;
      const setup = fixture(kind, async () => {
        canceledDispatch = setup.controller.signal.aborted;
        return 0n;
      });
      const handle = await setup.open();
      const options = { get signal() {
        if (++reads === cancelAt) setup.controller.abort(false);
        return setup.controller.signal;
      } };
      try {
        const outcome = await handle.seekEnd!(options).then(value => ({ value }), error => ({ error }));
        expect(canceledDispatch, `signal lookup ${cancelAt}`).toBe(false);
        expect(outcome).toEqual(setup.controller.signal.aborted ? { error: false } : { value: 0n });
      } finally { await handle.close(); }
    }
  });

  it(`${kind} scope checks cancellation after an end-seek getter`, async () => {
    const seek = vi.fn(async () => 0n);
    const setup = fixture(kind);
    Object.defineProperty(setup.original, "seekEnd", { get() {
      setup.controller.abort(null);
      return seek;
    } });
    const handle = await setup.open();
    try {
      expect(typeof handle.seekEnd).toBe("function");
      await expect(handle.seekEnd!()).rejects.toBe(null);
      expect(seek).not.toHaveBeenCalled();
    } finally { await handle.close(); }
  });

  it(`${kind} scope refuses end-seek admission once close begins`, async () => {
    const seek = vi.fn(async () => 0n);
    const setup = fixture(kind, seek);
    const handle = await setup.open();
    expect(typeof handle.seekEnd).toBe("function");
    const closing = handle.close();
    await expect(handle.seekEnd!()).rejects.toMatchObject({ code: "EBADF" });
    await closing;
    expect(setup.isClosed()).toBe(true);
    expect(seek).not.toHaveBeenCalled();
  });

  it(`${kind} scope preserves end-seek failures without converting offsets`, async () => {
    const failure = new FsError("EIO");
    const setup = fixture(kind, async () => { throw failure; });
    const handle = await setup.open();
    try {
      expect(typeof handle.seekEnd).toBe("function");
      await expect(handle.seekEnd!()).rejects.toBe(failure);
    } finally { await handle.close(); }
  });
}
