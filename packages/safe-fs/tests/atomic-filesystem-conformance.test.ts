import { describe, expect, it, vi } from "vitest";
import type { FileStat, FileSystem } from "../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import {
  createAtomicFileSystemConformance,
  type AtomicFileSystemConformanceFixture,
} from "../src/testing/atomic-filesystem.js";

function adapter(memory: MemoryFileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(memory, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function fixture(): Promise<AtomicFileSystemConformanceFixture> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/conformance");
  return { fs, root: "/conformance", dispose() {} };
}

describe("portable atomic filesystem conformance", () => {
  const cases = createAtomicFileSystemConformance({ createFixture: fixture });
  for (const conformance of cases) it(conformance.name, () => conformance.run());

  it("is lazy, uniquely named, and creates and disposes a fresh fixture per run", async () => {
    const disposed = vi.fn();
    const created: FileSystem[] = [];
    const createFixture = vi.fn(async () => {
      const current = await fixture();
      created.push(current.fs);
      return { ...current, dispose: disposed };
    });
    const suite = createAtomicFileSystemConformance({ createFixture });
    expect(createFixture).not.toHaveBeenCalled();
    expect(new Set(suite.map(entry => entry.name)).size).toBe(suite.length);
    for (const entry of suite) await entry.run();
    await suite[0]!.run();
    expect(new Set(created).size).toBe(suite.length + 1);
    expect(disposed).toHaveBeenCalledTimes(suite.length + 1);
  });

  it("uses a supplied peer for concurrent mutations", async () => {
    let peerWrites = 0;
    const suite = createAtomicFileSystemConformance({ createFixture: async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      return { ...current, peer: adapter(memory, {
        writeFileConditional: async (...args) => {
          peerWrites++;
          return memory.writeFileConditional(...args);
        },
      }) };
    } });
    for (const name of ["conditional create has one winner", "conditional update has one winner"]) {
      await suite.find(entry => entry.name === name)!.run();
    }
    expect(peerWrites).toBeGreaterThanOrEqual(2);
  });

  it("accepts an isolated filesystem root", async () => {
    const suite = createAtomicFileSystemConformance({ createFixture: () => ({
      fs: new MemoryFileSystem(), root: "/", dispose() {},
    }) });
    for (const entry of suite) await entry.run();
  });

  it("does not require directory revisions", async () => {
    const withoutDirectoryRevision = (stat: FileStat): FileStat => {
      const snapshot = { ...stat };
      if (stat.type === "directory") delete snapshot.revision;
      return snapshot;
    };
    const suite = createAtomicFileSystemConformance({ createFixture: async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      return { ...current, fs: adapter(memory, {
        lstat: async (...args) => withoutDirectoryRevision(await memory.lstat(...args)),
        prepareDirectory: async (...args) => withoutDirectoryRevision(await memory.prepareDirectory(...args)),
        createStagedFile: async (...args) => {
          const receipt = await memory.createStagedFile(...args);
          return {
            ...receipt,
            parent: { ...receipt.parent, stat: withoutDirectoryRevision(receipt.parent.stat) },
            directory: { ...receipt.directory, stat: withoutDirectoryRevision(receipt.directory.stat) },
          };
        },
      }) };
    } });
    for (const entry of suite) await entry.run();
  });

  for (const peerWins of [false, true]) it(`accepts independent observation scopes with ${peerWins ? "peer" : "primary"} race winners`, async () => {
    let peerReceipts = 0;
    const dispose = vi.fn();
    const suite = createAtomicFileSystemConformance({ includeSymlinks: true, createFixture: async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      const backendScope = (await memory.lstat(current.root)).identityScope!;
      const peerScope = {};
      const observe = (stat: FileStat): FileStat => ({ ...stat, identityScope: peerScope });
      const restore = (stat: FileStat): FileStat => {
        expect(stat.identityScope).toBe(peerScope);
        return { ...stat, identityScope: backendScope };
      };
      const peer = adapter(memory, {
        lstat: async (...args) => observe(await memory.lstat(...args)),
        writeFileConditional: async (path, data, options) => {
          const receipt = await memory.writeFileConditional(path, data, {
            ...options, parent: restore(options.parent), expected: options.expected === null ? null : restore(options.expected),
          });
          peerReceipts++;
          return observe(receipt);
        },
        prepareDirectory: async (path, options) => {
          const receipt = await memory.prepareDirectory(path, {
            ...options, parent: restore(options.parent), expected: options.expected === null ? null : restore(options.expected),
          });
          peerReceipts++;
          return observe(receipt);
        },
      });
      const fs = peerWins ? adapter(memory, {
        writeFileConditional: async (...args) => {
          await Promise.resolve();
          return memory.writeFileConditional(...args);
        },
        prepareDirectory: async (...args) => {
          await Promise.resolve();
          return memory.prepareDirectory(...args);
        },
      }) : memory;
      return { ...current, fs, peer, dispose };
    } });
    for (const entry of suite) await entry.run();
    expect(peerReceipts).toBe(peerWins ? 3 : 0);
    expect(dispose).toHaveBeenCalledTimes(suite.length);
  });

  for (const stat of [{ ino: -1 }, { dev: -1 }, { identityScope: undefined }]) {
    it(`rejects invalid root identity ${Object.keys(stat)[0]}`, async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      const suite = createAtomicFileSystemConformance({ createFixture: () => ({ ...current, fs: adapter(memory, {
        lstat: async (...args) => {
          const snapshot = { ...await memory.lstat(...args) };
          if ("identityScope" in stat) delete snapshot.identityScope;
          else Object.assign(snapshot, stat);
          return snapshot;
        },
      }) }) });
      await expect(suite[0]!.run()).rejects.toThrow("identity");
      expect(await memory.readdir(current.root)).toEqual([]);
    });
  }

  for (const capability of ["atomicFileStaging", "atomicFileMutation", "atomicDirectoryMetadata"] as const) {
    for (const queried of [false, true]) it(`rejects missing ${capability} in ${queried ? "path" : "declared"} capabilities and disposes`, async () => {
      const dispose = vi.fn();
      const suite = createAtomicFileSystemConformance({ createFixture: async () => {
        const current = await fixture();
        const memory = current.fs as MemoryFileSystem;
        const capabilities = { ...memory.capabilities, [capability]: false };
        return { ...current, dispose, fs: adapter(memory, queried ? {
          capabilitiesFor: async () => capabilities,
        } : { capabilities }) };
      } });
      await expect(suite[0]!.run()).rejects.toThrow(capability);
      expect(dispose).toHaveBeenCalledOnce();
    });
  }

  for (const method of ["writeFileConditional", "removeFileConditional", "createStagedFile", "publishStagedFile", "removeStagedFile", "prepareDirectory"] as const) {
    it(`rejects an advertised profile without ${method}`, async () => {
      const suite = createAtomicFileSystemConformance({ createFixture: async () => {
        const current = await fixture();
        return { ...current, fs: adapter(current.fs as MemoryFileSystem, { [method]: undefined }) };
      } });
      await expect(suite[0]!.run()).rejects.toThrow(method);
    });
  }

  for (const root of ["relative", "/conformance/../elsewhere", "/conformance/"]) {
    it(`refuses an unsafe fixture root ${root} before mutation`, async () => {
      const dispose = vi.fn();
      const current = await fixture();
      const suite = createAtomicFileSystemConformance({ createFixture: () => ({ ...current, root, dispose }) });
      await expect(suite[0]!.run()).rejects.toThrow("root");
      expect(await current.fs.readdir(current.root)).toEqual([]);
      expect(dispose).toHaveBeenCalledOnce();
    });
  }

  it("refuses nonempty and symlink fixture roots", async () => {
    for (const symlink of [false, true]) {
      const current = await fixture();
      if (symlink) await current.fs.symlink!(current.root, "/alias");
      else await current.fs.writeFile(`${current.root}/unowned`, Uint8Array.of(9));
      const suite = createAtomicFileSystemConformance({ createFixture: () => ({ ...current, root: symlink ? "/alias" : current.root }) });
      await expect(suite[0]!.run()).rejects.toThrow("root");
      if (!symlink) expect(await current.fs.readFile(`${current.root}/unowned`)).toEqual(Uint8Array.of(9));
    }
  });

  it("awaits disposal and propagates disposal failures", async () => {
    const suite = createAtomicFileSystemConformance({ createFixture: async () => ({
      ...await fixture(), dispose: async () => { throw new Error("dispose failed"); },
    }) });
    await expect(suite[0]!.run()).rejects.toThrow("dispose failed");
  });

  const defects: { name: string; overrides(memory: MemoryFileSystem): Partial<FileSystem> }[] = [
    { name: "conditional create has one winner", overrides: memory => ({
      writeFileConditional: async (path, data) => {
        await memory.writeFile(path, data);
        return memory.lstat(path);
      },
    }) },
    { name: "conditional update has one winner", overrides: memory => ({
      writeFileConditional: async (path, data) => {
        await memory.writeFile(path, data);
        return memory.lstat(path);
      },
    }) },
    { name: "same-length writes invalidate file revisions", overrides: memory => ({
      writeFileConditional: async (path, data, options) => memory.writeFileConditional(path, data, {
        ...options, expected: options.expected === null ? null : await memory.lstat(path),
      }),
    }) },
    { name: "same-length writes invalidate file revisions", overrides: memory => ({
      writeFile: async (path, data, options) => {
        await memory.writeFile(path, data, options);
        await memory.utimes(path, 1000, 1000);
      },
      writeFileConditional: async (path, data, options) => memory.writeFileConditional(path, data, {
        ...options, expected: options.expected === null ? null : {
          ...options.expected, revision: (await memory.lstat(path)).revision!,
        },
      }),
    }) },
    { name: "missing expected files are not recreated", overrides: memory => ({
      writeFileConditional: async (path, data, options) => memory.writeFileConditional(path, data, {
        ...options, expected: null,
      }),
    }) },
    { name: "staging receipts preserve original identity and revision", overrides: memory => ({
      createStagedFile: async (...args) => {
        const receipt = await memory.createStagedFile(...args);
        const stat = { ...receipt.file.stat };
        delete stat.revision;
        return { ...receipt, file: { ...receipt.file, stat } };
      },
    }) },
    { name: "staging is exclusive and private", overrides: memory => ({
      createStagedFile: async (...args) => {
        const receipt = await memory.createStagedFile(...args);
        await memory.chmod(receipt.directory.path, 0o755);
        return receipt;
      },
    }) },
    { name: "stage-file replacement survives rejection", overrides: memory => ({
      removeStagedFile: async receipt => { await memory.rm(receipt.directory.path, { recursive: true }); },
    }) },
    { name: "stage-directory replacement survives rejection", overrides: memory => ({
      removeStagedFile: async receipt => { await memory.rm(receipt.directory.path, { recursive: true }); },
    }) },
    { name: "unexpected staging children survive cleanup refusal", overrides: memory => ({
      removeStagedFile: async receipt => { await memory.rm(receipt.directory.path, { recursive: true }); },
    }) },
    { name: "destination replacement survives publication rejection", overrides: memory => ({
      publishStagedFile: async (receipt, destination) => { await memory.rename(receipt.file.path, destination); },
    }) },
    { name: "destination-parent replacement refuses publication", overrides: memory => ({
      publishStagedFile: async (receipt, destination, options) => memory.publishStagedFile(receipt, destination, {
        ...options, parent: await memory.lstat(destination.slice(0, destination.lastIndexOf("/"))),
      }),
    }) },
    { name: "file snapshot metadata is checked", overrides: memory => ({
      writeFileConditional: async (path, data, options) => memory.writeFileConditional(path, data, {
        ...options, expected: options.expected === null ? null : await memory.lstat(path),
      }),
    }) },
    { name: "directory creation has one winner", overrides: memory => ({
      prepareDirectory: async (path, options) => {
        await memory.mkdir(path, { recursive: true });
        return memory.prepareDirectory(path, { ...options, expected: await memory.lstat(path) });
      },
    }) },
    { name: "unexpected children survive post-publication cleanup refusal", overrides: memory => ({
      removeStagedFile: async receipt => { await memory.rm(receipt.directory.path, { recursive: true }); },
    }) },
    { name: "stale directories refuse metadata changes", overrides: memory => ({
      prepareDirectory: async (path, options) => memory.prepareDirectory(path, {
        ...options, expected: options.expected === null ? null : await memory.lstat(path),
      }),
    }) },
    { name: "pre-aborted operations leave entries unchanged", overrides: memory => ({
      writeFileConditional: async (path, data, options) => {
        const { signal: ignoredSignal, ...unchecked } = options;
        return memory.writeFileConditional(path, data, unchecked);
      },
    }) },
  ];

  for (const defect of defects) it(`detects a broken adapter: ${defect.name}`, async () => {
    const dispose = vi.fn();
    const suite = createAtomicFileSystemConformance({ createFixture: async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      return { ...current, dispose, fs: adapter(memory, defect.overrides(memory)) };
    } });
    const selected = suite.find(entry => entry.name === defect.name);
    expect(selected).toBeDefined();
    await expect(selected!.run()).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("detects destructive cleanup even when it returns the expected rejection", async () => {
    const suite = createAtomicFileSystemConformance({ createFixture: async () => {
      const current = await fixture();
      const memory = current.fs as MemoryFileSystem;
      return { ...current, fs: adapter(memory, {
        removeStagedFile: async receipt => {
          await memory.rm(receipt.directory.path, { recursive: true });
          throw Object.assign(new Error("stale"), { code: "EAGAIN" });
        },
      }) };
    } });
    await expect(suite.find(entry => entry.name === "stage-file replacement survives rejection")!.run()).rejects.toThrow("ENOENT");
  });

  it("omits symlinks by default and rejects unavailable explicitly selected profiles", async () => {
    expect(cases.some(entry => entry.name.includes("symlink"))).toBe(false);
    for (const missing of ["capability", "symlink", "readlink"] as const) {
      const suite = createAtomicFileSystemConformance({ includeSymlinks: true, createFixture: async () => {
        const current = await fixture();
        const memory = current.fs as MemoryFileSystem;
        return { ...current, fs: adapter(memory, missing === "capability"
          ? { capabilities: { ...memory.capabilities, symlinks: false } }
          : { [missing]: undefined }) };
      } });
      await expect(suite.find(entry => entry.name.includes("symlink"))!.run()).rejects.toThrow(missing === "capability" ? "symlinks" : missing);
    }
  });

  for (const conformance of createAtomicFileSystemConformance({ createFixture: fixture, includeSymlinks: true }).filter(entry => entry.name.includes("symlink"))) {
    it(conformance.name, () => conformance.run());
  }
});
