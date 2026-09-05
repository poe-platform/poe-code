import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import type { ShellOptions } from "poe-code/safe-bash";

type PublicExtension = NonNullable<ShellOptions["extensions"]>[number];
type ShellExtensionContext = Parameters<ReturnType<PublicExtension["create"]>["builtins"][number]["execute"]>[0];

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

async function fixture(readiness: "ready" | "blocked" | "unknown", inspect: (invocation: ShellExtensionContext) => Promise<number>) {
  const published = await import("poe-code/safe-bash");
  const filesystem = await import("poe-code/safe-fs");
  const backing = filesystem.createMemoryFileSystem();
  await backing.writeFile("/device", new Uint8Array());
  const resource = { opens: 0, closes: 0, reads: 0, writes: 0, probes: 0 };
  const metadata = { type: "character" as const, size: 0, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  const replacements: Partial<FileSystem> = {
    async stat(path, options) {
      if (path === "/device") { options?.signal?.throwIfAborted(); return metadata; }
      return backing.stat(path, options);
    },
    async open(path, options) {
      if (path !== "/device") return backing.open!(path, options);
      resource.opens++;
      return filesystem.openFileDescriptor(path, options, {
        positionedRead: false, positionedWrite: false, truncate: false,
        readObservation: true, openTruncate: true, synchronization: "none",
      }, async () => ({
        resource,
        async probeRead(retained) { assert.equal(retained, resource); retained.probes++; return readiness; },
        async stat() { return metadata; },
        async read(retained) { retained.reads++; return 0; },
        async write(retained, bytes) { retained.writes++; return bytes.length; },
        async truncate() { assert.fail("Open admission must not invoke ftruncate"); },
        async sync() { assert.fail("Synchronization is not advertised"); },
        async close(retained) { retained.closes++; },
      }));
    },
  };
  const fs = new Proxy(backing, { get(target, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const shell = new published.Shell({ fs, extensions: [{
    name: "public-provider-observer", runtimeIdentity: published.commandRuntimeIdentity,
    create: () => ({ builtins: [{ name: "inspectfd", execute: inspect }] }),
  }] }).use(published.agentCommands());
  return { fs, shell, resource };
}

describe("compiled provider observation through retained redirections", { skip: selected === undefined ? "Requires a current public build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const entry of ["inline", "bash", "sh"]) {
    for (const access of ["read", "write"] as const) {
      for (const readiness of ["ready", "blocked", "unknown"] as const) {
        test(`${entry}: ${access} alias preserves provider ${readiness} and independent timeout policy`, async context => {
          let inspections = 0;
          const timeout = access === "read" ? "honor" : "unknown";
          const subject = await fixture(readiness, async invocation => {
            inspections++;
            assert.throws(() => invocation.input.observe(3), { code: "EBADF" });
            const observer = invocation.input.observe(4);
            assert.equal(observer.readable, access === "read");
            if (access === "write") assert.throws(() => invocation.input.borrow(4), { code: "EBADF" });
            assert.deepEqual(await observer.probeRead(), { readiness, timeout });
            assert.equal(subject.resource.reads, 0);
            assert.equal(subject.resource.writes, 0);
            assert.equal(subject.resource.closes, 0);
            assert.equal(subject.resource.opens, 1);
            assert.equal(subject.resource.probes, 1);
            await observer.release();
            await observer.release();
            assert.equal(subject.resource.closes, 0);
            await assert.rejects(observer.probeRead(), { code: "EBADF" });
            const next = invocation.input.observe(4);
            assert.deepEqual(await next.probeRead(), { readiness, timeout });
            await next.release();
            return 0;
          });
          context.after(() => subject.shell.dispose());
          const source = access === "read" ? "inspectfd 3<device 4<&3 3<&-" : "inspectfd 3>device 4>&3 3>&-";
          if (entry !== "inline") await subject.fs.writeFile("/program.sh", Buffer.from(source));
          const result = await subject.shell.exec(entry === "inline" ? source : `${entry} /program.sh`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, "");
          assert.equal(inspections, 1);
          assert.deepEqual(subject.resource, { opens: 1, closes: 1, reads: 0, writes: 0, probes: 2 });
        });
      }
    }
    test(`${entry}: terminal stream EOF preserves the retained observation until redirection closes`, async context => {
      const subject = await fixture("ready", async invocation => {
        const input = invocation.input.borrow(3);
        const first = await input.read(true);
        assert.equal(first.reason, "eof");
        await first.release();
        assert.equal(subject.resource.reads, 1);
        await input.release();
        assert.equal(subject.resource.closes, 0);
        const observer = invocation.input.observe(3);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        await observer.release();
        assert.equal(subject.resource.closes, 0);
        const again = invocation.input.borrow(3);
        const second = await again.read(true);
        assert.equal(second.reason, "eof");
        await second.release();
        await again.release();
        assert.equal(subject.resource.reads, 1);
        return 0;
      });
      context.after(() => subject.shell.dispose());
      const source = "inspectfd 3<device";
      if (entry !== "inline") await subject.fs.writeFile("/program.sh", Buffer.from(source));
      const result = await subject.shell.exec(entry === "inline" ? source : `${entry} /program.sh`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(subject.resource, { opens: 1, closes: 1, reads: 1, writes: 0, probes: 1 });
    });
  }
});
