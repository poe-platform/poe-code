import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export const moduleUrl = import.meta.url;
export function nodePort(authorized) {
  assert.equal(authorized, "ROOT_NATIVE_GO");
  return {
    runtimeIdentity: () => ({ path: fs.realpathSync(process.execPath), version: process.version, platform: process.platform, arch: process.arch }),
    now: () => performance.now(),
    timer: (delay, callback) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    stat(filename) {
      const stat = fs.lstatSync(filename);
      return { kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other", bytes: stat.size, mode: stat.mode & 0o7777, identity: `${stat.dev}:${stat.ino}` };
    },
    read: filename => fs.readFileSync(filename),
    hash(filename, maximumBytes) {
      assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 256 * 1024 * 1024);
      const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const before = fs.fstatSync(descriptor); assert.ok(before.isFile() && before.size === maximumBytes);
        const hash = createHash("sha256"), scratch = Buffer.alloc(65536);
        let total = 0;
        while (total < maximumBytes) {
          const count = fs.readSync(descriptor, scratch, 0, Math.min(scratch.length, maximumBytes - total), null);
          assert.ok(count > 0, "truncated bound file"); total += count; hash.update(scratch.subarray(0, count));
        }
        assert.equal(fs.readSync(descriptor, scratch, 0, 1, null), 0, "enlarged bound file");
        const after = fs.fstatSync(descriptor), pathname = fs.lstatSync(filename);
        assert.equal(after.size, before.size); assert.equal(after.mode, before.mode); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(after.ctimeMs, before.ctimeMs);
        assert.ok(pathname.isFile()); assert.equal(pathname.dev, after.dev); assert.equal(pathname.ino, after.ino);
        return hash.digest("hex");
      } finally { fs.closeSync(descriptor); }
    },
    list: directory => fs.readdirSync(directory),
    canonical: filename => fs.realpathSync(filename),
    mkdir: filename => fs.mkdirSync(filename, { mode: 0o700 }),
    rmdir: filename => fs.rmdirSync(filename),
    writeExclusive: (filename, bytes) => fs.writeFileSync(filename, bytes, { flag: "wx", mode: 0o600 }),
    start(spec, events) {
      const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      const pid = child.pid;
      const handle = {
        pid,
        signalGroup(signal) {
          assert.ok(Number.isSafeInteger(pid) && pid > 0);
          try { process.kill(-pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
        },
        groupExists() {
          assert.ok(Number.isSafeInteger(pid) && pid > 0);
          try { process.kill(-pid, 0); return true; }
          catch (error) { if (error.code === "ESRCH") return false; throw error; }
        },
        release() { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); },
      };
      try {
        child.on("error", events.error);
        child.on("spawn", events.spawn);
        child.on("exit", events.exit);
        child.on("close", events.close);
        for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
          stream.on("error", events.error); stream.on("data", bytes => events.data(name, bytes));
        }
        child.stdin.on("error", error => { if (error.code !== "EPIPE") events.error(error); });
        child.stdin.end(spec.stdin, error => { if (error && error.code !== "EPIPE") events.error(error); });
      } catch (error) { events.error(error); }
      return handle;
    },
  };
}
