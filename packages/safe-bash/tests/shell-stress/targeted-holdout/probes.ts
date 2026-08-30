import assert from "node:assert/strict";
import type { ByteSource } from "../../../src/index.js";
import { runtime } from "../probes.js";

export const probeNames = [
  "moved-origin-with-transparent-forwarding",
  "zero-count-no-pulls-across-scopes",
  "fragmented-utf8-shared-offset-and-eof-origin",
  "closed-file-pipeline-origin",
  "moved-delimited-read-cancellation",
  "shortcut-read-error-restores-outer-stream",
  "case-posix-prefix-cancellation-stops-file-effects",
  "invalid-substitution-never-acquires-or-invokes",
] as const;

export async function runHoldoutProbe(name: string): Promise<void> {
  const { shell, fs, commands } = runtime();
  const origins: { label: string; default: boolean | undefined }[] = [];
  commands.register({ name: "origin", execute(context) {
    origins.push({ label: context.args[0] ?? "", default: context.stdinIsDefault });
    return { exitCode: 0 };
  } });
  commands.register({ name: "forward", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("origin", context.args, { stdin: context.stdin, ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }) });
  } });
  const controller = new AbortController();
  const reason = new Error(`targeted holdout cancellation: ${name}`);
  try {
    if (name === "moved-origin-with-transparent-forwarding") {
      for (const supplied of [false, true]) {
        origins.length = 0;
        const result = await shell.exec("forward outer; { forward group 3<&0 0<&3-; }; forward restored; ( forward sub 3<&0 0<&3- ); forward final", supplied ? { stdin: "" } : {});
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, { stdout: "", stderr: "", exitCode: 0 });
        assert.deepEqual(origins, ["outer", "group", "restored", "sub", "final"].map(label => ({ label, default: !supplied })));
      }
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "zero-count-no-pulls-across-scopes") {
      let pulls = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return { async next() { pulls++; throw new Error("zero count pulled input"); } }; } };
      const result = await shell.exec('fn() { read -n0 first; }; first=old; read -n0 first; fn; { read -n0 first; }; ( read -n0 first ); forward supplied; printf "<%s>" "$first"', { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, pulls }, { stdout: "<>", stderr: "", exitCode: 0, pulls: 0 });
      assert.deepEqual(origins, [{ label: "supplied", default: false }]);
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "fragmented-utf8-shared-offset-and-eof-origin") {
      const stdin: ByteSource = { async *[Symbol.asyncIterator]() { for (const byte of new TextEncoder().encode("é😀Z")) yield Uint8Array.of(byte); } };
      const result = await shell.exec('IFS= read -rn2 value 3<&0 0<&3-; forward partial; printf "<%s>" "$value"; cat; read -rn1 tail; printf ":%s" "$?"; forward eof', { stdin, env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" } });
      assert.deepEqual({ stdoutBase64: Buffer.from(result.stdoutBytes).toString("base64"), stderr: result.stderr, exitCode: result.exitCode }, { stdoutBase64: Buffer.from("<é😀>Z:1").toString("base64"), stderr: "", exitCode: 0 });
      assert.deepEqual(origins, [{ label: "partial", default: false }, { label: "eof", default: false }]);
      assert.deepEqual(await fs.readdir("/"), []);
    } else if (name === "closed-file-pipeline-origin") {
      await fs.writeFile("/input", new TextEncoder().encode("file"));
      const result = await shell.exec("forward closed 0<&-; forward file 3<input 0<&3-; printf pipe | forward pipe; forward restored");
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, { stdout: "", stderr: "", exitCode: 0 });
      assert.deepEqual(origins, [{ label: "closed", default: false }, { label: "file", default: false }, { label: "pipe", default: false }, { label: "restored", default: true }]);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["input"]);
      assert.equal(Buffer.from(await fs.readFile("/input")).toString(), "file");
    } else if (name === "moved-delimited-read-cancellation") {
      let pulls = 0;
      let returns = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        next() { pulls++; setImmediate(() => controller.abort(reason)); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
        async return() { returns++; return { value: undefined, done: true }; },
      }; } };
      await assert.rejects(shell.exec(": >before; read -n7 -d : value 3<&0 0<&3-; : >after", { stdin, signal: controller.signal }), error => error === reason);
      assert.deepEqual({ pulls, returns }, { pulls: 1, returns: 1 });
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["before"]);
      assert.equal((await fs.readFile("/before")).length, 0);
    } else if (name === "shortcut-read-error-restores-outer-stream") {
      await fs.writeFile("/fault", new TextEncoder().encode("unchanged"));
      let reads = 0;
      const originalReadStream = fs.readStream.bind(fs);
      fs.readStream = (path, options) => path === "/fault" ? { async *[Symbol.asyncIterator]() { reads++; throw new Error("holdout injected read failure"); } } : originalReadStream(path, options);
      const result = await shell.exec('value=$(<fault); status=$?; printf "<%s>:%s:" "$value" "$status"; cat; forward exhausted; : >after', { stdin: "outer" });
      assert.deepEqual({ stdout: result.stdout, exitCode: result.exitCode, reads }, { stdout: "<>:1:outer", exitCode: 0, reads: 1 });
      assert.match(result.stderr, /holdout injected read failure/u);
      assert.deepEqual(origins, [{ label: "exhausted", default: false }]);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["after", "fault"]);
      assert.equal(Buffer.from(await fs.readFile("/fault")).toString(), "unchanged");
      assert.equal((await fs.readFile("/after")).length, 0);
    } else if (name === "case-posix-prefix-cancellation-stops-file-effects") {
      commands.register({ name: "arm", execute() { setImmediate(() => controller.abort(reason)); return { exitCode: 0 }; } });
      await assert.rejects(shell.exec(": >before; arm; case x in $PATTERN) : >wrong;; esac; : >after", { env: { PATTERN: "[[:".repeat(16384) + "]" }, signal: controller.signal }), error => error === reason);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["before"]);
      assert.equal((await fs.readFile("/before")).length, 0);
    } else if (name === "invalid-substitution-never-acquires-or-invokes") {
      let acquired = 0;
      let marks = 0;
      commands.register({ name: "mark", execute() { marks++; return { exitCode: 0 }; } });
      const stdin: ByteSource = { [Symbol.asyncIterator]() { acquired++; throw new Error("invalid source acquired input"); } };
      const result = await shell.exec("mark; value=$(true |); : >after", { stdin });
      assert.deepEqual({ stdout: result.stdout, exitCode: result.exitCode, acquired, marks, files: await fs.readdir("/") }, { stdout: "", exitCode: 127, acquired: 0, marks: 0, files: [] });
      assert.notEqual(result.stderr, "");
    } else throw new Error(`Unknown holdout probe: ${name}`);
  } finally { await shell.dispose(); }
}
