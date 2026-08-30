import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { appendFileSync, copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const directory = process.env.ARCHIVE_PREREQUISITE_TRACE;
let sequence = 0;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => value == null ? null : Buffer.from(value).toString("base64");

if (directory) {
  for (const method of ["execFileSync", "spawnSync"]) {
    const original = childProcess[method];
    childProcess[method] = function (...parameters) {
      const [executable, args, options] = parameters;
      if (!["gtar", "bsdtar"].includes(basename(String(executable)))) return Reflect.apply(original, this, parameters);
      const id = `${process.pid}-${++sequence}`;
      const record = { id, method, executable, executableSha256: sha256(readFileSync(executable)), args, options, startedAt: new Date().toISOString() };
      appendFileSync(join(directory, "calls.jsonl"), `${JSON.stringify({ ...record, event: "start" })}\n`);
      let result;
      let failure;
      try {
        result = Reflect.apply(original, this, parameters);
        return result;
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        const outcome = failure ?? result;
        const artifacts = [];
        if (options?.cwd && existsSync(options.cwd)) {
          for (const name of readdirSync(options.cwd).filter(name => /\.tar(?:\.gz)?$/.test(name)).sort()) {
            const source = join(options.cwd, name);
            const saved = `${id}-${name}`;
            copyFileSync(source, join(directory, saved));
            artifacts.push({ name, saved, sha256: sha256(readFileSync(source)) });
          }
        }
        appendFileSync(join(directory, "calls.jsonl"), `${JSON.stringify({
          ...record, event: "finish", endedAt: new Date().toISOString(),
          status: method === "execFileSync" && !failure ? 0 : outcome?.status,
          signal: outcome?.signal ?? null, error: failure?.message ?? outcome?.error?.message ?? null,
          stdoutBase64: bytes(method === "execFileSync" && !failure ? result : outcome?.stdout),
          stderrBase64: bytes(outcome?.stderr), artifacts,
        })}\n`);
      }
    };
  }
  syncBuiltinESMExports();
}
