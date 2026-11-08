import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const directory = fileURLToPath(new URL("./", import.meta.url));
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export function save(name, content) {
  const path = resolve(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n", { flag: "wx" });
}
export function snapshot(name) {
  const git = (...args) => execFileSync("git", args, { cwd: root }).toString().trim();
  const tracked = git("ls-files", "src", "tests/stress/harness-timing-20260827", "tests/commands/search-stress", "tests/commands/structured-stress/jq-grammar-author-20260827").split("\n").filter(path => !path.includes("/review/"));
  const paths = [...new Set([...tracked, ...readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => relative(root, resolve(directory, entry.name)))])];
  save(name, { at: new Date().toISOString(), head: git("rev-parse", "HEAD"), status: git("status", "--short"), index: git("diff", "--cached", "--name-only"), fullgateRouting: git("rev-parse", "51282a9"), fullgateSource: "e36dab2b6abc216ddc89e5786a0eba76f08a1722", node: process.version, platform: process.platform, arch: process.arch, hashes: Object.fromEntries(paths.map(path => [path, digest(readFileSync(resolve(root, path)))])) });
}
export async function run(name, command, args, timeout = 120000, extraEnv = {}) {
  const events = []; const output = []; const errors = [];
  const started = performance.now();
  const mark = (event, detail = {}) => events.push({ event, ms: performance.now() - started, ...detail });
  const env = { ...process.env, LC_ALL: "C", LANG: "C", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1", ...extraEnv };
  delete env.NODE_TEST_CONTEXT;
  mark("launch", { command, args, timeout });
  const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let failure; let captured = 0;
  const registrations = [];
  const listen = (target, event, handler) => { target.on(event, handler); registrations.push([target, event, handler]); };
  const stop = message => { failure ??= message; mark("kill", { message, pid: child.pid }); child.kill("SIGKILL"); };
  const armedMs = performance.now() - started; const dueMs = armedMs + timeout;
  mark("outer-timer-armed", { armedMs, dueMs, timeout });
  const deadline = setTimeout(() => { const firedMs = performance.now() - started; mark("outer-timer-fired", { armedMs, dueMs, firedMs, latenessMs: firedMs - dueMs }); stop("outer deadline"); }, timeout);
  const result = await new Promise(resolveResult => {
    listen(child, "spawn", () => mark("spawn", { pid: child.pid }));
    listen(child, "error", error => { failure ??= String(error); mark("error", { message: String(error) }); });
    listen(child, "exit", (code, signal) => mark("exit", { code, signal }));
    for (const [label, stream, chunks] of [["stdout", child.stdout, output], ["stderr", child.stderr, errors]]) {
      listen(stream, "data", chunk => { mark(`${label}-data`, { bytes: chunk.length }); captured += chunk.length; if (captured > 4 * 1024 * 1024) stop("capture limit"); else chunks.push(Buffer.from(chunk)); });
      listen(stream, "end", () => mark(`${label}-end`));
      listen(stream, "close", () => mark(`${label}-close`));
      listen(stream, "error", error => stop(`${label}: ${error}`));
    }
    listen(child.stdin, "error", error => { if (error.code !== "EPIPE") stop(String(error)); });
    listen(child.stdin, "close", () => mark("stdin-close"));
    listen(child, "close", (code, signal) => {
      clearTimeout(deadline); mark("outer-timer-cleared"); mark("close", { code, signal });
      for (const [target, event, handler] of registrations) target.removeListener(event, handler);
      const ownedListenersRemaining = registrations.filter(([target, event, handler]) => target.listeners(event).includes(handler)).length;
      resolveResult({ name, command, args, code, signal, failure: failure ?? null, durationMs: performance.now() - started, ownedListenersRemaining, streamsDestroyed: [child.stdin, child.stdout, child.stderr].map(stream => stream.destroyed), events });
    });
    child.stdin.end();
  });
  save(`evidence/${name}.stdout.log`, Buffer.concat(output).toString());
  save(`evidence/${name}.stderr.log`, Buffer.concat(errors).toString());
  save(`evidence/${name}.json`, result);
  return result;
}
