import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join, dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { directory, digest, read, putJson } from "./common.mjs";

export const limits = Object.freeze({ preview: 1048576, trace: 67108864, chunk: 65536, line: 131072, diagnostics: 256, diagnosticBytes: 262144, reapMs: 5000 });

function parser(requiredPaths, stop) {
  const decoder = new StringDecoder("utf8"), diagnostics = [], found = requiredPaths.map(() => false);
  let incomplete = "", lines = 0, diagnosticBytes = 0, forbidden = false, complete = true;
  function line(value) {
    lines++;
    for (const [index, path] of requiredPaths.entries()) if (value.includes(path)) found[index] = true;
    if (value.includes("successfully resolved") && value.includes("/src/")) forbidden = true;
    if (/error TS\d+/u.test(value)) {
      diagnosticBytes += Buffer.byteLength(value);
      if (diagnostics.length >= limits.diagnostics || diagnosticBytes > limits.diagnosticBytes) { complete = false; stop("trace-diagnostic-retention-overflow"); }
      else diagnostics.push(value);
    }
  }
  function text(value) {
    if (!complete) return;
    let offset = 0;
    while (offset < value.length) {
      const newline = value.indexOf("\n", offset), end = newline === -1 ? value.length : newline;
      const fragment = value.slice(offset, end);
      if (Buffer.byteLength(incomplete) + Buffer.byteLength(fragment) > limits.line) { complete = false; stop("trace-incomplete-line-overflow"); return; }
      incomplete += fragment;
      if (newline === -1) return;
      line(incomplete); incomplete = ""; offset = end + 1;
      if (!complete) return;
    }
  }
  return {
    feed(bytes) { text(decoder.write(bytes)); },
    finish() { text(decoder.end()); if (complete && incomplete) line(incomplete); incomplete = ""; return { lines, diagnostics, diagnosticBytes, forbiddenResolution: forbidden, requiredPaths, found, complete }; },
  };
}

export async function supervise({ name, executable, executableSha256, args, cwd, home, rawDirectory, timeout = 15000, trace = false, requiredPaths = [], prelaunch = [] }) {
  assert.equal(globalThis.exprStop, undefined, "outer stop closes child admission");
  assert.equal(digest(read(executable)), executableSha256);
  const bindings = [...new Set([join(directory, "transport.mjs"), join(directory, "common.mjs"), ...prelaunch])].map(path => ({ path, sha256: digest(read(path)) }));
  const started = Date.now(), preview = { stdout: [], stderr: [] }, streams = {};
  let observedBytes = 0, capturedBytes = 0, previewBytes = 0, supervision = null, spawnError, child, reapTimer, timer, resolveReap, childClosed = false;
  const cap = trace ? limits.trace : limits.preview;
  const environment = { PATH: `${dirname(executable)}:/usr/bin:/bin`, HOME: home, TMPDIR: home, LC_ALL: "C", LANG: "C", TZ: "UTC" };
  const reaping = new Promise(resolve => { resolveReap = resolve; });
  function stop(reason) {
    if (supervision) return;
    supervision = reason;
    if (childClosed) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    reapTimer = setTimeout(() => {
      child.stdout.destroy(); child.stderr.destroy();
      resolveReap({ status: null, signal: "SIGKILL", closed: false, reapExpired: true });
    }, limits.reapMs);
  }
  for (const channel of ["stdout", "stderr"]) {
    const path = join(rawDirectory, `${name}.${channel}.raw`);
    streams[channel] = { path, handle: await open(path, "wx", 0o644), hash: createHash("sha256"), bytes: 0, observedBytes: 0, parser: trace ? parser(requiredPaths, stop) : undefined };
  }
  putJson(join(rawDirectory, `${name}.prelaunch.json`), { name, executable, executableSha256, args, cwd, environment, bindings, class: trace ? "TRACE" : "ordinary", limits, startedAt: new Date(started).toISOString() });
  child = spawn(executable, args, { cwd, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  timer = setTimeout(() => stop("child-deadline"), Math.max(1, timeout));
  child.once("error", error => { spawnError = error.message; });
  const closed = new Promise(resolve => child.once("close", (status, signal) => { childClosed = true; resolve({ status, signal, closed: true }); }));
  async function consume(channel) {
    const stream = streams[channel];
    try {
      for await (const incoming of child[channel]) {
        for (let position = 0; position < incoming.length; position += limits.chunk) {
          const chunk = incoming.subarray(position, position + limits.chunk);
          observedBytes += chunk.length; stream.observedBytes += chunk.length;
          const count = Math.min(chunk.length, cap - capturedBytes), bytes = chunk.subarray(0, count);
          capturedBytes += count;
          let offset = 0;
          while (offset < count) {
            const result = await stream.handle.write(bytes, offset, count - offset, null);
            assert.ok(result.bytesWritten > 0); offset += result.bytesWritten;
          }
          stream.bytes += count; stream.hash.update(bytes);
          const previewCount = Math.min(count, limits.preview - previewBytes);
          if (previewCount) { preview[channel].push(Buffer.from(bytes.subarray(0, previewCount))); previewBytes += previewCount; }
          stream.parser?.feed(bytes);
          if (count !== chunk.length) stop(trace ? "trace-artifact-ceiling-64MiB" : "combined-output-cap-1MiB");
        }
      }
    } catch (error) { stream.error = error.message; stop("capture-stream-error"); }
    finally { await stream.handle.sync(); await stream.handle.close(); }
  }
  const consumers = Promise.all([consume("stdout"), consume("stderr")]);
  const outcome = await Promise.race([closed, reaping]);
  clearTimeout(timer); clearTimeout(reapTimer);
  await consumers;
  const output = {};
  for (const channel of ["stdout", "stderr"]) {
    const stream = streams[channel];
    output[channel] = { path: stream.path, bytes: stream.bytes, observedBytes: stream.observedBytes, sha256: stream.hash.digest("hex"), error: stream.error, analysis: stream.parser?.finish() };
  }
  const receipt = { name, executable, executableSha256, args, cwd, environment, bindings, pid: child.pid, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    ...outcome, error: spawnError, supervision, class: trace ? "TRACE" : "ordinary", naturalSettlement: !supervision && outcome.signal === null && !spawnError,
    observedBytes, capturedBytes, previewBytes, previewTruncated: observedBytes > previewBytes,
    artifactCompleteness: !supervision && capturedBytes === observedBytes && outcome.closed && !Object.values(output).some(value => value.error) ? "full-observed-child-streams" : "captured-prefix-truncated",
    producerCompletedNaturally: !supervision && outcome.signal === null && !spawnError,
    stdout: Buffer.concat(preview.stdout, preview.stdout.reduce((total, bytes) => total + bytes.length, 0)).toString(),
    stderr: Buffer.concat(preview.stderr, preview.stderr.reduce((total, bytes) => total + bytes.length, 0)).toString(), output, limits, durableBeforeAssertions: true };
  putJson(join(rawDirectory, `${name}.json`), receipt);
  return receipt;
}

export function traceVerdict(receipt) {
  const analyses = Object.values(receipt.output).map(value => value.analysis);
  if (!receipt.closed || !receipt.naturalSettlement || receipt.artifactCompleteness !== "full-observed-child-streams" || analyses.some(value => !value?.complete)) return "supervision-failure";
  if (analyses.some(value => value.forbiddenResolution)) return "forbidden-resolution";
  if (analyses.some(value => value.diagnostics.some(line => /TS2307|TS2688/u.test(line)))) return "missing-tool-or-library";
  if (analyses.some(value => value.diagnostics.length)) return "type-diagnostics";
  if (receipt.status !== 0) return "nonzero-child";
  return "pass";
}
