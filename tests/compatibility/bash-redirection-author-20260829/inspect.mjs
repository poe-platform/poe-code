import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, lstat, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scope = resolve("tests/compatibility/bash-redirection-author-20260829");
const receipt = `${scope}/PREPARATION-ROOT.json`;
let root;
try { root = JSON.parse(await readFile(receipt, "utf8")).root; }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  root = await mkdtemp(`${tmpdir()}/bash-redirection-author-`);
  await writeFile(`${root}/START.json`, JSON.stringify({ started: new Date().toISOString(), purpose: "SOURCE_PREPARATION_BEFORE_VALIDATION_PRESEAL" }), { flag: "wx" });
  await writeFile(receipt, JSON.stringify({ root }), { flag: "wx" });
}
const outputs = [];
const hashes = [];
try {
  const requests = JSON.parse(process.argv[2]);
  if (!Array.isArray(requests) || requests.length > 12) throw new Error("request cap");
  for (const request of requests) {
    if (request.kind === "git") {
      if (!["status", "diff", "log", "cat-file", "ls-tree", "show"].includes(request.args[0])) throw new Error("development metadata only");
      const result = spawnSync("/usr/bin/git", request.args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 10000, env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } });
      outputs.push({ request, code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
      if (result.error || result.status !== 0 || result.signal) throw result.error ?? new Error("metadata failed");
      continue;
    }
    if (request.path.includes("..") || request.path.split("/").some(name => name.toLowerCase() === "agents.md")) throw new Error("path refused");
    const path = resolve(request.path);
    if (!path.startsWith(process.cwd() + "/")) throw new Error("outside repository");
    if (request.kind === "list") {
      const names = await readdir(path);
      if (names.length > 1000) throw new Error("directory cap");
      outputs.push({ request, names }); continue;
    }
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024 || !/\.(?:mjs|ts|json|md)$/.test(path)) throw new Error("text admission");
    const bytes = await readFile(path);
    hashes.push({ path: request.path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    const lines = bytes.toString().split("\n");
    const text = request.pattern ? lines.flatMap((line, index) => new RegExp(request.pattern, "u").test(line) ? [`${index + 1}:${line}`] : []).join("\n")
      : lines.slice((request.from ?? 1) - 1, request.to ?? 200).map((line, index) => `${(request.from ?? 1) + index}:${line}`).join("\n");
    outputs.push({ request, text });
  }
  const data = JSON.stringify({ outputs, hashes }, null, 2);
  if (Buffer.byteLength(data) > 1024 * 1024) throw new Error("capture cap");
  const index = (await readdir(root)).filter(name => /^inspect-/.test(name)).length + 1;
  await writeFile(`${root}/inspect-${index}.json`, data, { flag: "wx" });
  for (const output of outputs) console.log(JSON.stringify(output.request), output.text ?? JSON.stringify(output));
  console.log(JSON.stringify(hashes));
} catch (error) {
  await writeFile(`${root}/inspect-error-${Date.now()}.json`, JSON.stringify({ outputs, hashes, error: String(error), stack: error.stack }), { flag: "wx" });
  throw error;
}
