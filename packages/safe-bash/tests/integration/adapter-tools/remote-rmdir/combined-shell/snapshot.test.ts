import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, MemoryFileSystem, MountFileSystem, ReadOnlyFileSystem, Shell } from "../../../../../src/index.js";
import { withFixture, success } from "../../fixtures.js";
import { assertWorkflowCommands } from "../../preflight-review/preflight.js";

for (const mounted of [false, true]) {
  for (const command of ["rmdir", "rm -d"]) {
    test(`actual S3 snapshot ${command}, mounted=${mounted}: exact marker deletion leaves late child visible`, async () => {
      await withFixture("s3", async ({ fs, s3, exec }) => {
        assert.ok(s3);
        await fs.mkdir("/work/empty");
        assert.equal(fs.capabilities.snapshotRmdir, true);
        const marker = { Bucket: "adapter-tools", Key: "isolated/work/empty/" };
        const child = { Bucket: marker.Bucket, Key: `${marker.Key}nested/late.bin` };
        const bytes = new Uint8Array([0, 128, 255, 10]);
        const originalDelete = s3.deleteObject.bind(s3);
        let injected = 0;
        s3.deleteObject = async (input, options) => {
          assert.deepEqual(input, marker);
          assert.ok(options?.abortSignal, "actual Shell signal reaches the transport");
          injected++;
          await s3.putObject({ ...child, Body: bytes }, options);
          return originalDelete(input, options);
        };
        const start = s3.requests.length;
        const mountedFs = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": fs } });
        const mountedShell = new Shell({ fs: mountedFs }).use(agentCommands());
        const path = mounted ? "/remote/work/empty" : "/work/empty";
        try {
          assert.equal(mountedFs.capabilities.snapshotRmdir, true);
          success(mounted ? await mountedShell.exec(`${command} ${path}`) : await exec(`${command} ${path}`), "");
          if (mounted) assertWorkflowCommands(mountedShell.commands);
          assert.equal(injected, 1);
          assert.deepEqual(s3.requests.slice(start).filter(request => request.operation === "deleteObject").map(request => request.input), [marker]);
          await assert.rejects(s3.headObject(marker), { code: "NoSuchKey" });
          assert.deepEqual(await fs.readFile("/work/empty/nested/late.bin"), bytes);
          assert.deepEqual(await mountedFs.readFile("/remote/work/empty/nested/late.bin"), bytes);
          const result = mounted
            ? await mountedShell.exec("cat /remote/work/empty/nested/late.bin")
            : await exec("cat /work/empty/nested/late.bin");
          success(result);
          assert.deepEqual(result.stdoutBytes, bytes);
          assert.equal((await fs.stat("/work/empty")).type, "directory", "success does not promise logical-directory absence");
        } finally {
          s3.deleteObject = originalDelete;
          await mountedShell.dispose();
        }
      });
    });
  }
}

test("actual aggregate S3 Shell removes quiescent explicit markers with rmdir and rm -d", async () => {
  await withFixture("s3", async ({ fs, s3, exec, dispatched }) => {
    assert.ok(s3);
    const start = s3.requests.length;
    success(await exec("mkdir first second && rmdir first && rm -d second && test ! -e first && test ! -e second"), "");
    assert.equal(fs.capabilities.snapshotRmdir, true);
    assert.ok(dispatched.includes("rmdir"));
    assert.ok(dispatched.includes("rm"));
    assert.deepEqual(s3.requests.slice(start).filter(request => request.operation === "deleteObject").map(request => request.input), [
      { Bucket: "adapter-tools", Key: "isolated/work/first/" },
      { Bucket: "adapter-tools", Key: "isolated/work/second/" },
    ]);
  });
});

test("actual aggregate Shell readonly S3 denies both removal commands without transport deletion", async () => {
  await withFixture("s3", async ({ fs, s3 }) => {
    assert.ok(s3);
    await fs.mkdir("/work/empty");
    const readonly = new ReadOnlyFileSystem(fs);
    const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/remote": readonly } });
    const shell = new Shell({ fs: mounted }).use(agentCommands());
    const start = s3.requests.length;
    try {
      assert.notEqual(readonly.capabilities.snapshotRmdir, true);
      assert.notEqual(mounted.capabilities.snapshotRmdir, true);
      for (const command of ["rmdir", "rm -d"]) {
        const result = await shell.exec(`${command} /remote/work/empty`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /read.only file system/i);
        assertWorkflowCommands(shell.commands);
      }
      await assert.rejects(readonly.rmdir("/work/empty"), { code: "EROFS", syscall: "rmdir", path: "/work/empty" });
      assert.equal((await fs.stat("/work/empty")).type, "directory");
      assert.equal((await s3.headObject({ Bucket: "adapter-tools", Key: "isolated/work/empty/" })).ContentLength, 0);
      assert.deepEqual(s3.requests.slice(start).filter(request => request.operation === "deleteObject"), []);
    } finally {
      await shell.dispose();
    }
  });
});
