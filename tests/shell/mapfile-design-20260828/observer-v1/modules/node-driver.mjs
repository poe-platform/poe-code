import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export const moduleUrl = import.meta.url;
export function nodePort(authorized) {
  assert.equal(authorized, "ROOT_NATIVE_GO");
  return {
    now: () => performance.now(),
    timer: (delay, callback) => setTimeout(callback, delay),
    clearTimer: timer => clearTimeout(timer),
    stat(filename) {
      const stat = fs.lstatSync(filename);
      return { kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other", bytes: stat.size, identity: `${stat.dev}:${stat.ino}` };
    },
    read: filename => fs.readFileSync(filename),
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
