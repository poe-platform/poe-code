import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/fs/memory";
import { toByteSource } from "safe-bash-contracts/io";
import { mdq } from "./index.js";

async function execute(source: string, args: string[] = [], files: string[] = []) {
  const fs = createMemoryFileSystem();
  for (const [index, content] of files.entries()) await fs.writeFile(`/input${index}.md`, new TextEncoder().encode(content));
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const result = await mdq({ command: "mdq", args: [...args, ...(files.length ? ["", ...files.map((_, index) => `/input${index}.md`)] : [])], cwd: "/", env: {},
    fs, signal: new AbortController().signal,
    stdin: toByteSource(new TextEncoder().encode(source)),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }
  });
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

async function run(source: string, args: string[] = []): Promise<string> {
  const result = await execute(source, args);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  return result.stdout;
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

// Verified against mdq 0.10.0, source c4eccd0e340ad32f966ee8675c093dabe1005ee0.
for (const format of ["markdown", "json"]) {
  for (const referenced of [false, true]) {
    for (const second of ["first", "second"]) {
      for (const input of ["stdin", "files"]) {
        test(`duplicate footnotes reject ${format}, referenced=${referenced}, body=${second}, ${input}`, async () => {
          const first = `${referenced ? "A[^a].\n\n" : ""}[^a]: first\n\n`;
          const last = `[^a]: ${second}\n`;
          assert.deepEqual(await execute(input === "stdin" ? first + last : "", ["-o", format], input === "files" ? [first, last] : []), {
            exitCode: 1, stdout: "", stderr: "Markdown parse error:\nfound multiple definitions for link/image/footnote: a\n\n"
          });
        });
      }
    }
  }
  test(`nested duplicate footnotes reject ${format}`, async () => {
    assert.deepEqual(await execute("A[^a].\n\n> [^a]: first\n\n[^a]: second\n", ["-o", format]), {
      exitCode: 1, stdout: "", stderr: "Markdown parse error:\nfound multiple definitions for link/image/footnote: a\n\n"
    });
  });
}

test("ordinary duplicate link definitions still keep the first destination", async () => {
  const source = "[a][a]\n\n[a]: /x\n[a]: /y\n";
  assert.equal(await run(source), "[a][a]\n\n[a]: /x\n");
  assert.deepEqual(JSON.parse(await run(source, ["-o", "json"])).links, { a: { url: "/x" } });
});

test("differently cased footnote definitions remain distinct in JSON", async () => {
  assert.deepEqual(JSON.parse(await run("A[^UP] b[^up].\n\n[^UP]: Upper.\n\n[^up]: Lower.\n", ["-o", "json"])).footnotes, {
    "1": [{ paragraph: "Upper." }], "2": [{ paragraph: "Lower." }]
  });
});

test("ten footnotes are emitted in numeric order", async () => {
  const labels = Array.from({ length: 10 }, (_, i) => i + 1);
  const refs = labels.map(i => `[^n${i}]`).join(" ");
  const defs = labels.map(i => `[^n${i}]: note ${i}`).join("\n\n");
  assert.equal(await run(`${refs}\n\n${defs}\n`), `${labels.map(i => `[^${i}]`).join(" ")}\n\n${labels.map(i => `[^${i}]: note ${i}`).join("\n")}\n`);
});
