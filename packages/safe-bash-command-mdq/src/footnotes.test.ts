import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { mdq } from "./index.js";

async function run(source: string, args: string[] = []): Promise<string> {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await mdq({ command: "mdq", args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(new TextEncoder().encode(source)),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }
  });
  assert.equal(Buffer.concat(stderr).toString(), "");
  assert.equal(result.exitCode, 0);
  return Buffer.concat(stdout).toString();
}

test("uppercase footnotes retain their bodies in Markdown and JSON", async () => {
  const source = "A[^UP].\n\n[^UP]: Note.\n";
  assert.equal(await run(source), "A[^1].\n\n[^1]: Note.\n");
  const json = JSON.parse(await run(source, ["-o", "json"]));
  assert.deepEqual(json.footnotes["1"], [{ paragraph: "Note." }]);
});

test("footnote recognition folds case while body lookup preserves raw labels", async () => {
  assert.equal(await run("A[^UP] b[^up].\n\n[^up]: Note.\n"), "A[^1] b[^2].\n\n[^1]: \n[^2]: Note.\n");
  assert.equal(await run("A[^UP] b[^up].\n\n[^UP]: Upper.\n\n[^up]: Lower.\n"), "A[^1] b[^2].\n\n[^1]: Upper.\n[^2]: Lower.\n");
});

test("duplicate footnotes keep the first body in document order", async () => {
  assert.equal(await run("A[^a].\n\n[^a]: first\n\n[^a]: second\n"), "A[^1].\n\n[^1]: first\n");
  assert.equal(await run("A[^a].\n\n> [^a]: first\n\n[^a]: second\n"), "A[^1].\n\n>\n\n[^1]: first\n");
});

test("ten footnotes are emitted in numeric order", async () => {
  const labels = Array.from({ length: 10 }, (_, i) => i + 1);
  const refs = labels.map(i => `[^n${i}]`).join(" ");
  const defs = labels.map(i => `[^n${i}]: note ${i}`).join("\n\n");
  assert.equal(await run(`${refs}\n\n${defs}\n`), `${labels.map(i => `[^${i}]`).join(" ")}\n\n${labels.map(i => `[^${i}]: note ${i}`).join("\n")}\n`);
});
