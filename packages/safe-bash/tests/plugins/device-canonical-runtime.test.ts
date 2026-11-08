import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FileSystem } from "poe-code/safe-fs";

type Optional = {
  createDeviceFileSystem(): FileSystem;
  ddCommands(): import("poe-code/safe-bash").VirtualShellPlugin;
};

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

describe("compiled opt-in canonical devices", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const name of ["null", "zero", "random", "urandom"] as const) {
    for (const access of ["read", "write", "readwrite"] as const) {
      test(`${name}: mounted ${access} descriptor preserves the Darwin device contract`, async context => {
        const published = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const devices = optional.createDeviceFileSystem();
        assert.equal(typeof devices.open, "function");
        assert.equal(devices.capabilities.randomAccessWrite, false);
        const filesystem = published.createMountFileSystem({ root: published.createMemoryFileSystem(), mounts: { "/dev": devices } });
        const descriptor = await filesystem.open!(`/dev/${name}`, { access, ...(access === "read" ? {} : { append: true }) });
        context.after(() => descriptor.close());
        assert.equal(descriptor.capabilities.position, true);
        assert.equal(descriptor.capabilities.readObservation, true);
        assert.equal(descriptor.capabilities.synchronization, "volatile");
        assert.equal(await descriptor.probeRead!(), "ready");
        assert.equal(await descriptor.getPosition!(), 0);
        const original = await descriptor.stat!();
        assert.equal(original.type, "character");
        assert.equal(original.size, 0);
        let cursor = 0;
        if (access === "write") {
          await assert.rejects(descriptor.read(new Uint8Array(), null), { code: "EBADF" });
        } else {
          const bytes = new Uint8Array(3).fill(170);
          const expected = name === "null" ? 0 : 3;
          assert.equal(await descriptor.read(bytes, null), expected);
          cursor = expected;
          if (name === "null") assert.deepEqual(bytes, Uint8Array.of(170, 170, 170));
          if (name === "zero") assert.deepEqual(bytes, new Uint8Array(3));
          assert.equal(await descriptor.getPosition!(), cursor);
          assert.equal(await descriptor.read(new Uint8Array(2), 7), name === "null" ? 0 : 2);
          assert.equal(await descriptor.getPosition!(), cursor);
        }
        if (access === "read") {
          await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
          await assert.rejects(descriptor.truncate(0), { code: "EBADF" });
          assert.notEqual(descriptor.capabilities.delegateZeroLengthWrite, true);
        } else {
          if (name === "urandom") {
            assert.equal(descriptor.capabilities.delegateZeroLengthWrite, true);
            await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EPERM" });
            await assert.rejects(descriptor.write(Uint8Array.of(1, 2), 7), { code: "EPERM" });
            await assert.rejects(descriptor.write(Uint8Array.of(3), null), { code: "EPERM" });
          } else {
            assert.equal(await descriptor.write(new Uint8Array(), null), 0);
            assert.equal(await descriptor.write(Uint8Array.of(1, 2), 7), 2);
            assert.equal(await descriptor.getPosition!(), cursor);
            assert.equal(await descriptor.write(Uint8Array.of(3), null), 1);
            cursor++;
          }
          await descriptor.truncate(4096);
        }
        await descriptor.sync(false);
        await descriptor.sync(true);
        assert.equal(await descriptor.getPosition!(), cursor);
        assert.deepEqual(await descriptor.stat(), original);
        await descriptor.close();
        await descriptor.close();
        await assert.rejects(descriptor.getPosition!(), { code: "EBADF" });
        await assert.rejects(descriptor.write(new Uint8Array(), null), { code: "EBADF" });
      });
    }
  }

  for (const name of ["null", "zero", "random", "urandom"] as const) {
    for (const size of [65537, 262144]) {
      test(`${name}: public descriptor fills a ${size}-byte native-qualified read demand`, async context => {
        const published = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const mounted = published.createMountFileSystem({ root: published.createMemoryFileSystem(), mounts: { "/dev": optional.createDeviceFileSystem() } });
        const descriptor = await mounted.open!(`/dev/${name}`, { access: "read" });
        context.after(() => descriptor.close());
        const bytes = new Uint8Array(size).fill(170);
        const expected = name === "null" ? 0 : size;
        assert.equal(await descriptor.read(bytes, null), expected);
        assert.equal(await descriptor.getPosition!(), expected);
        if (name === "null") assert.equal(bytes.every(value => value === 170), true);
        if (name === "zero") assert.equal(bytes.every(value => value === 0), true);
        assert.equal(await descriptor.read(bytes, 3), expected);
        assert.equal(await descriptor.getPosition!(), expected);
        await descriptor.close();
      });

      test(`${name}: compiled dd copies one ${size}-byte device input block without a crypto-sized short read`, async context => {
        const published = await import("poe-code/safe-bash");
        const filesystem = await import("poe-code/safe-fs");
        const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
        const root = filesystem.createMemoryFileSystem();
        const mounted = filesystem.createMountFileSystem({ root, mounts: { "/dev": optional.createDeviceFileSystem() } });
        const shell = new published.Shell({ fs: mounted, limits: { maxWallClockMs: 2000, maxOutputBytes: 1048576 } }).use(published.agentCommands()).use(optional.ddCommands());
        context.after(() => shell.dispose());
        const result = await shell.exec(`dd if=/dev/${name} of=/output bs=${size} count=1 status=none`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "");
        const bytes = await root.readFile("/output");
        assert.equal(bytes.length, name === "null" ? 0 : size);
        if (name === "zero") assert.equal(bytes.every(value => value === 0), true);
      });
    }
  }

  for (const entry of ["inline", "bash", "sh"] as const) {
    test(`${entry}: explicit mounted devices work in a real virtual script`, async context => {
      const published = await import("poe-code/safe-bash");
      const filesystem = await import("poe-code/safe-fs");
      const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
      const root = filesystem.createMemoryFileSystem();
      const mounted = filesystem.createMountFileSystem({ root, mounts: { "/dev": optional.createDeviceFileSystem() } });
      const shell = new published.Shell({ fs: mounted, limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 } }).use(published.agentCommands());
      context.after(() => shell.dispose());
      const source = "{ head -c 3 <&3; } 3</dev/zero; cat /dev/null; printf '|ready'";
      await root.writeFile("/probe.sh", new TextEncoder().encode(source));
      const result = await shell.exec(entry === "inline" ? source : `${entry} /probe.sh`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.of(0, 0, 0, 124, 114, 101, 97, 100, 121));
    });
  }

  test("default public filesystem and shell still do not install devices", async () => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    assert.equal(Object.hasOwn(published, "createDeviceFileSystem"), false);
    const filesystem = createMemoryFileSystem();
    for (const name of ["null", "zero", "random", "urandom"]) {
      await assert.rejects(filesystem.stat(`/dev/${name}`), { code: "ENOENT" });
    }
  });
});
