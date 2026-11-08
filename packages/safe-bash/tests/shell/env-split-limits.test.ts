import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let source: string;
before(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../shell-stress/env-split-author/core-host.mjs", import.meta.url))],
    alias: {
      "safe-bash-contracts": fileURLToPath(new URL("../../../safe-bash-contracts/src", import.meta.url)),
      "@poe-code/safe-fs": fileURLToPath(new URL("../../../safe-fs/src", import.meta.url)),
      "poe-code/safe-fs": fileURLToPath(new URL("../../../safe-fs/src", import.meta.url)),
    },
    bundle: true, platform: "node", format: "esm", target: "node22", write: false,
  });
  source = result.outputFiles[0]!.text;
});

test("env split additional parser cancellation, exact caps and non-S compatibility", { timeout: 7000 }, async () => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-"], {
      detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let failure: Error | undefined;
    let bytes = 0;
    const kill = () => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {} };
    const timer = setTimeout(() => { failure = new Error("author child deadline"); kill(); }, 5000);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]] as const) stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk); bytes += chunk.length;
      if (bytes > 262144) { failure = new Error("author child output cap"); kill(); }
    });
    child.on("error", error => { failure = error; });
    child.stdin.on("error", error => { failure = error; kill(); });
    child.on("close", (status, signal) => {
      clearTimeout(timer); kill();
      try {
        assert.equal(failure, undefined); assert.equal(signal, null);
        assert.equal(status, 0, Buffer.concat(stderr).toString());
        assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), { checks: 10 });
        assert.throws(() => process.kill(child.pid!, 0), error => (error as NodeJS.ErrnoException).code === "ESRCH");
        resolve();
      } catch (error) { reject(error); }
    });
    child.stdin.end(source);
  });
});
