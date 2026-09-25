import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { MountFileSystem } from "../src/fs/mount/index.js";
import { DeviceFileSystem } from "../src/fs/devices/index.js";
import { scopeFileSystem } from "../src/fs/scoped.js";
import type { FileSystem } from "../src/contracts/filesystem.js";
import { FsError } from "../src/contracts/errors.js";
import { ReadOnlyFileSystem } from "../src/fs/readonly/index.js";
import { withFileSystemQuota } from "../src/fs/quota/index.js";

for (const operation of ["query", "prepare"] as const) {
  test(`Device staging resolution rejects noncanonical virtual operands before unsupported traversal: ${operation}`, async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/output");
    await memory.writeFile("/output/a", Uint8Array.of(1));
    await memory.symlink("/dev/../output", "/alias");
    const fs = new DeviceFileSystem(memory);
    for (const path of ["/dev/../output/a", "/dev/./a", "dev/a", "/./alias/a"]) {
      await assert.rejects(operation === "query" ? fs.capabilitiesFor(path, { stagingResolution: true }) : fs.prepareStagingResolution(path), { code: "EINVAL" });
    }
  });
}

for (const backing of ["missing", "file"] as const) {
  test(`Device resolution capability refuses virtual traversal with a mounted ${backing} backing entry`, async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/output");
    await memory.writeFile("/output/a", Uint8Array.of(1));
    if (backing === "file") await memory.writeFile("/dev", Uint8Array.of(9));
    await memory.symlink("/dev/../output", "/alias");
    const fs = new DeviceFileSystem(new MountFileSystem({ root: memory }));
    for (const path of ["/alias/a", "/dev/a"]) {
      assert.equal((await fs.capabilitiesFor(path, { stagingResolution: true })).synchronousStagingResolution, false);
      await assert.rejects(fs.prepareStagingResolution(path), { code: "ENOTSUP" });
    }
    assert.deepEqual(await memory.readFile("/output/a"), Uint8Array.of(1));
  });
}

test("Mount resolution capabilities preserve the original operand's backend policy", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/dev");
  await memory.mkdir("/output");
  await memory.writeFile("/output/a", Uint8Array.of(1));
  await memory.symlink("/dev/../output", "/alias");
  const fs = new MountFileSystem({ root: new DeviceFileSystem(memory) });
  assert.equal((await fs.capabilitiesFor("/alias/a", { stagingResolution: true })).synchronousStagingResolution, false);
  await assert.rejects(fs.prepareStagingResolution("/alias/a"), { code: "ENOTSUP" });
});

test("Mount resolution capabilities reject noncanonical operands consistently", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work");
  await memory.writeFile("/work/a", Uint8Array.of(1));
  const fs = new MountFileSystem({ root: memory });
  await assert.rejects(fs.capabilitiesFor("/work/./a", { stagingResolution: true }), { code: "EINVAL" });
});

test("Mount staging resolution preserves confinement for an outer symlink into a child mount", async () => {
  const root = new MemoryFileSystem(), child = new MemoryFileSystem();
  await root.mkdir("/dir");
  await root.symlink("dir", "/alias_dir");
  await child.writeFile("/a", Uint8Array.of(1));
  const fs = new MountFileSystem({ root, mounts: { "/dir/inner": child } });
  await assert.rejects(fs.capabilitiesFor("/alias_dir/inner/a", { stagingResolution: true }), { code: "EACCES" });
  await assert.rejects(fs.prepareStagingResolution("/alias_dir/inner/a"), { code: "EACCES" });
});

for (const backing of ["missing", "file", "symlink", "directory"] as const) for (const operation of ["query", "prepare"] as const) {
  test(`Device staging resolution refuses virtual traversal over backing ${backing}: ${operation}`, async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/output");
    await memory.writeFile("/output/a", Uint8Array.of(1));
    if (backing === "file") await memory.writeFile("/dev", Uint8Array.of(9));
    else if (backing === "symlink") await memory.symlink("output", "/dev");
    else if (backing === "directory") await memory.mkdir("/dev");
    await memory.symlink("/dev/../output", "/alias");
    const fs = new DeviceFileSystem(memory);
    for (const path of ["/dev/a", "/alias/a"]) {
      if (operation === "query") assert.equal((await fs.capabilitiesFor(path, { stagingResolution: true })).synchronousStagingResolution, false);
      else await assert.rejects(fs.prepareStagingResolution(path), { code: "ENOTSUP" });
    }
    assert.deepEqual(await memory.readFile("/output/a"), Uint8Array.of(1));
  });
}

for (const kind of ["mount", "device", "scope-mount"] as const) for (const target of ["a", "missing", "final"]) {
  test(`${kind} resolution capability leaves the final symlink unfollowed: ${target}`, async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work");
    await memory.writeFile("/work/a", Uint8Array.of(1));
    await memory.symlink(target, "/work/final");
    const mount = new MountFileSystem({ root: memory });
    const fs = kind === "mount" ? mount : kind === "device" ? new DeviceFileSystem(memory)
      : scopeFileSystem(mount, () => {}, new AbortController().signal);
    assert.equal((await fs.capabilitiesFor!("/work/final", { stagingResolution: true })).synchronousStagingResolution, false);
    await assert.rejects(fs.prepareStagingResolution!("/work/final"), { code: "ENOTSUP" });
  });
}

for (const kind of ["scope", "device"] as const) for (const failure of ["backend", "malformed", "capability"] as const) {
  test(`${kind} preparation preserves cancellation over ${failure} failure`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/a", Uint8Array.of(1));
    const controller = new AbortController();
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "capabilitiesFor" && failure === "capability") return async () => { controller.abort(false); throw new FsError("EIO"); };
      if (property === "prepareStagingResolution") return async (...args: Parameters<typeof memory.prepareStagingResolution>) => {
        const receipt = await memory.prepareStagingResolution(...args);
        controller.abort(false);
        if (failure === "backend") throw new FsError("EIO");
        return { ...receipt, ancestors: [] };
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = kind === "device" ? new DeviceFileSystem(backend) : scopeFileSystem(backend, () => {}, controller.signal);
    await assert.rejects(fs.prepareStagingResolution!("/a", { signal: controller.signal }), error => error === false);
    assert.deepEqual(await memory.readFile("/a"), Uint8Array.of(1));
  });
}

for (const kind of ["scope", "device"] as const) for (const malformed of ["destination-type", "destination-identity", "destination-revision", "step-identity", "step-target", "step-path", "parent-type"] as const) {
  test(`${kind} rejects malformed authoritative resolution snapshots: ${malformed}`, async () => {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work");
    await memory.writeFile("/work/a", Uint8Array.of(1));
    await memory.symlink("work", "/alias");
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "prepareStagingResolution") return async (...args: Parameters<typeof memory.prepareStagingResolution>) => {
        const receipt = await memory.prepareStagingResolution(...args);
        const { identityScope, ...opaque } = receipt.destination!;
        void identityScope;
        if (malformed === "destination-type") return { ...receipt, destination: { ...receipt.destination!, type: "directory" } };
        if (malformed === "destination-identity") return { ...receipt, destination: opaque };
        if (malformed === "destination-revision") return { ...receipt, destination: { ...receipt.destination!, revision: NaN } };
        if (malformed === "parent-type") return { ...receipt, parent: { ...receipt.parent, type: "file" } };
        return { ...receipt, traversed: receipt.traversed.map(entry => {
          if (entry.stat.type !== "symlink") return entry;
          if (malformed === "step-identity") { const { identityScope, ...stat } = entry.stat; void identityScope; return { ...entry, stat }; }
          if (malformed === "step-path") return { ...entry, path: "alias" };
          const { linkTarget, ...step } = entry; void linkTarget; return step;
        }) };
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = kind === "device" ? new DeviceFileSystem(backend) : scopeFileSystem(backend, () => {}, new AbortController().signal);
    await assert.rejects(fs.prepareStagingResolution!("/alias/a"), error => error instanceof FsError && ["EINVAL", "ENOTSUP"].includes(error.code));
    assert.deepEqual(await memory.readFile("/work/a"), Uint8Array.of(1));
  });
}

test("resolution admission withholds read-only and quota views", () => {
  const memory = new MemoryFileSystem();
  for (const fs of [new ReadOnlyFileSystem(memory), withFileSystemQuota(memory, { maxBytes: 1000 })]) {
    assert.equal(fs.capabilities.synchronousStagingResolution, false);
    assert.equal(fs.prepareStagingResolution, undefined);
  }
});

for (const kind of ["scope", "mount"] as const) {
  test(`${kind} resolution preparation refuses a read-only backend declaration`, async () => {
    const memory = new MemoryFileSystem();
    await memory.writeFile("/a", Uint8Array.of(1));
    const capabilities = Object.freeze({ ...memory.capabilities, readOnly: true });
    let preparations = 0;
    const backend = new Proxy(memory, { get(target, property) {
      if (property === "capabilities") return capabilities;
      if (property === "capabilitiesFor") return async () => capabilities;
      if (property === "prepareStagingResolution") return async (...args: Parameters<MemoryFileSystem["prepareStagingResolution"]>) => {
        preparations++;
        return target.prepareStagingResolution(...args);
      };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    } });
    const fs = kind === "mount" ? new MountFileSystem({ root: backend })
      : scopeFileSystem(backend, () => {}, new AbortController().signal);
    assert.equal((await fs.capabilitiesFor!("/a", { stagingResolution: true })).synchronousStagingResolution, false);
    await assert.rejects(fs.prepareStagingResolution!("/a"), { code: "ENOTSUP" });
    assert.equal(preparations, 0);
  });
}

test("Device resolution capability excludes traversed virtual ancestors", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/dev");
  await memory.mkdir("/output");
  await memory.writeFile("/output/a", Uint8Array.of(1));
  await memory.symlink("/dev/../output", "/alias");
  const fs = new DeviceFileSystem(memory);
  assert.equal((await fs.capabilitiesFor("/alias/a", { stagingResolution: true })).synchronousStagingResolution, false);
  await assert.rejects(fs.prepareStagingResolution("/alias/a"), { code: "ENOTSUP" });
  assert.deepEqual(await memory.readFile("/output/a"), Uint8Array.of(1));
});

test("resolution cannot follow a symlink into another mount", async () => {
  const memory = new MemoryFileSystem();
  await memory.symlink("/child", "/alias");
  const child = new MemoryFileSystem();
  await child.writeFile("/a", Uint8Array.of(1));
  const fs = new MountFileSystem({ root: memory, mounts: { "/child": child } });
  await assert.rejects(fs.prepareStagingResolution("/alias/a"), { code: "EACCES" });
  assert.deepEqual(await child.readFile("/a"), Uint8Array.of(1));
});

test("nested mounts advertise and bind followed staging resolution", async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/output");
  await memory.writeFile("/output/a", Uint8Array.of(1));
  await memory.symlink("/output", "/alias");
  const nested = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/inner": memory } });
  const fs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/outer": nested } });
  assert.equal((await fs.capabilitiesFor("/outer/inner/alias/a", { stagingResolution: true })).synchronousStagingResolution, true);
  const resolution = await fs.prepareStagingResolution("/outer/inner/alias/a");
  assert.equal(resolution.path, "/outer/inner/output/a");
  assert.equal(resolution.validate(), true);
  await memory.rm("/alias");
  await memory.symlink("/output", "/alias");
  assert.throws(() => resolution.validate(), { code: "EAGAIN" });
});

for (const view of ["memory", "mount", "devices", "scope"] as const) {
  async function fixture() {
    const memory = new MemoryFileSystem();
    await memory.mkdir("/work/output", { recursive: true });
    await memory.writeFile("/work/output/a", Uint8Array.of(1));
    await memory.symlink("output", "/work/alias");
    const controller = new AbortController();
    const fs: FileSystem = view === "memory" ? memory : view === "mount" ? new MountFileSystem({ root: memory })
      : view === "devices" ? new DeviceFileSystem(memory) : scopeFileSystem(memory, () => {}, controller.signal);
    return { memory, fs, controller };
  }

  test(`${view} binds followed staging resolution and publishes through its guard`, async () => {
    const { fs, memory } = await fixture();
    const resolution = await fs.prepareStagingResolution!("/work/alias/a");
    assert.equal(resolution.path, "/work/output/a");
    assert.ok(Object.isFrozen(resolution));
    assert.ok(Object.isFrozen(resolution.ancestors));
    assert.ok(resolution.traversed.some(entry => entry.path === "/work/alias" && entry.stat.type === "symlink"));
    assert.equal(resolution.validate(), true);
    const staging = await fs.createStagedFile!("/work/output/.stage", "entry", { type: "file", data: Uint8Array.of(2) }, {
      parent: resolution.parent, retainCleanup: true,
    });
    try {
      await fs.publishStagedFile!(staging, resolution.path, {
        parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate,
      });
      assert.deepEqual(await memory.readFile("/work/output/a"), Uint8Array.of(2));
      assert.equal(await memory.readlink("/work/alias"), "output");
    } finally { await staging.cleanup!.remove(); await staging.cleanup!.close(); }
  });

  test(`${view} resolution requires an absolute lexically canonical operand`, async () => {
    const { fs } = await fixture();
    for (const path of ["work/alias/a", "/work/./alias/a", "/work/alias/../output/a"]) {
      await assert.rejects(fs.prepareStagingResolution!(path), { code: "EINVAL" });
    }
  });

  test(`${view} binds missing destination absence`, async () => {
    const { fs, memory } = await fixture();
    const resolution = await fs.prepareStagingResolution!("/work/alias/missing");
    assert.equal(resolution.destination, null);
    assert.equal(resolution.validate(), true);
    await memory.writeFile("/work/output/missing", Uint8Array.of(3));
    assert.throws(() => resolution.validate(), { code: "EAGAIN" });
    assert.deepEqual(await memory.readFile("/work/output/missing"), Uint8Array.of(3));
  });

  for (const change of ["symlink", "ancestor", "destination", "permission", "cancel"] as const) {
    test(`${view} refuses changed staging resolution: ${change}`, async () => {
      const { fs, memory, controller } = await fixture();
      const resolution = await fs.prepareStagingResolution!("/work/alias/a", { signal: controller.signal });
      if (change === "symlink") { await memory.rm("/work/alias"); await memory.symlink("output", "/work/alias"); }
      else if (change === "ancestor") { await memory.rename("/work/output", "/work/held"); await memory.mkdir("/work/output"); await memory.writeFile("/work/output/a", Uint8Array.of(3)); }
      else if (change === "destination") await memory.writeFile("/work/output/a", Uint8Array.of(3));
      else if (change === "permission") await memory.chmod("/work", 0o600);
      else controller.abort(false);
      assert.throws(() => resolution.validate(), error => change === "cancel" ? error === false
        : (error as { code?: string }).code === (change === "permission" ? "EACCES" : "EAGAIN"));
      if (change === "permission") await memory.chmod("/work", 0o700);
      assert.deepEqual(await memory.readFile(change === "ancestor" ? "/work/held/a" : "/work/output/a"), Uint8Array.of(change === "destination" ? 3 : 1));
    });
  }
}
