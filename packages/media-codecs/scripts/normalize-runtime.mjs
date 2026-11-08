import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "acorn";

const path = process.argv[2];
assert.ok(path, "Pass the generated runtime path");
const source = readFileSync(path, "utf8");
const program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const entry = program.body[0];
assert.equal(entry.type, "FunctionDeclaration");
assert.equal(entry.id.name, "Module");
assert.equal(entry.async, true);
// Emscripten marks the factory async even for WASM=0. Verify that initialization
// contains no await before exposing its synchronous return/error contract.
function check(node) {
  if (node !== entry && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return;
  assert.notEqual(node.type, "AwaitExpression", "Codec initialization became asynchronous");
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child?.type) check(child);
    } else if (value?.type) check(value);
  }
}
check(entry);
assert.equal(source.slice(entry.start, entry.start + 6), "async ");
const notices = ["ffmpeg", "libogg", "libvorbis", "libopus"].map(name =>
  readFileSync(new URL(`../vendor/LICENSE.${name}`, import.meta.url), "utf8")).join("\n\n");
const banner = "/*!\nGenerated portable media codecs.\nCorresponding source and build instructions: https://github.com/poe-platform/poe-code/tree/main/packages/media-codecs\n\n" + notices + "\n*/\n";
writeFileSync(path, banner + source.slice(0, entry.start) + source.slice(entry.start + 6));
