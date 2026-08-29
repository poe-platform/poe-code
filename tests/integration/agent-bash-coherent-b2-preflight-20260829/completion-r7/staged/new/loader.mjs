import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { admit, canonical } from "./support.mjs";
import { createTrace } from "./trace.mjs";

const bindingFile = process.env.PUBLIC_BINDING;
canonical(bindingFile);
assert.match(process.env.PUBLIC_BINDING_BYTES ?? "", /^(0|[1-9][0-9]*)$/);
const binding = JSON.parse(admit(bindingFile, { bytes: Number(process.env.PUBLIC_BINDING_BYTES), sha256: process.env.PUBLIC_BINDING_SHA256 }, 1048576));
canonical(binding.packageRoot); canonical(binding.trace);
const members = new Map(binding.members.map(row => [row.absolute, row]));
assert.equal(members.size, binding.members.length);
const trace = createTrace(binding.trace);
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "virtual-bash") return { url: pathToFileURL(path.join(binding.packageRoot, "dist/index.js")).href, shortCircuit: true };
  if (specifier.startsWith("virtual-bash/")) throw new Error("undeclared B2 public alias");
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("node:")) return nextLoad(url, context);
  assert.ok(url.startsWith("file:"));
  const filename = fileURLToPath(url);
  const row = members.get(filename);
  function refuse(alteration) {
    const member = path.relative(binding.packageRoot, filename);
    const identity = `B2_BINDING_REFUSAL:${alteration}:${filename}`;
    trace({ kind: "binding-refusal", alteration, member, filename, identity });
    throw new Error(identity);
  }
  if (!row) refuse("missing");
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink()); assert.equal(before.size, row.bytes);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let source;
  try {
    const opened = fs.fstatSync(descriptor); assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    source = Buffer.alloc(row.bytes); let offset = 0;
    while (offset < source.length) { const count = fs.readSync(descriptor, source, offset, source.length - offset, offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  } finally { fs.closeSync(descriptor); }
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  if (digest !== row.sha256) refuse("changed");
  trace({ kind: "authenticated-source-prepared", url, member: row.path, sha256: digest });
  return { format: "module", source, shortCircuit: true };
}
