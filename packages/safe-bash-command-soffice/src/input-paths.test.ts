import assert from "node:assert/strict";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createLibreofficeCommand, createSofficeCommand, runSofficeCli, runSofficeCliSync } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);

function invocation(fs: MemoryFileSystem, args: string[], check: (bytes: number) => void): CommandContext {
  return {
    command: "soffice", cwd: "/work", env: {}, fs, ...createCommandArguments(args),
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    inputBudget: { maxBytes: 100, check }
  };
}

for (const factory of [createSofficeCommand, createLibreofficeCommand]) {
  it(`${factory.name} rejects cumulative input overflow before writing any destination`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/a.csv", encode("a,b"));
    await fs.writeFile("/work/b.csv", encode("c,d"));
    const saved = encode("saved output");
    await fs.writeFile("/work/a.txt", saved);
    const totals: number[] = [];
    const failure = new Error("input budget exceeded");
    await assert.rejects(async () => factory().execute(invocation(fs, ["--convert-to", "txt", "a.csv", "b.csv"], bytes => {
      totals.push(bytes);
      if (bytes > 3) throw failure;
    })), error => error === failure);
    assert.deepEqual(totals, [3, 6]);
    assert.deepEqual(await fs.readFile("/work/a.txt"), saved);
    await assert.rejects(fs.readFile("/work/b.txt"), { code: "ENOENT" });
  });
}

it("reads only source operands and charges their bytes once across normalized aliases", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/data.csv", encode("a,b"));
  for (const name of ["txt", "Text", "en-US", "pid", "data.txt"]) await fs.writeFile(`/work/${name}`, encode("not an input"));
  const reads: string[] = [];
  const originalRead = fs.readFile.bind(fs);
  fs.readFile = async (path, options) => { reads.push(path); return originalRead(path, options); };
  const totals: number[] = [];
  const result = await createSofficeCommand().execute(invocation(fs, ["--convert-to", "txt", "--infilter", "Text", "--language", "en-US", "--pidfile", "pid", "--outdir", ".", "data.csv", "./data.csv"], bytes => totals.push(bytes)));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(reads, ["/work/data.csv"]);
  assert.deepEqual(totals, [3]);
  assert.equal(new TextDecoder().decode(await originalRead("/work/data.txt")), "a\tb\n");
});

for (const outdir of [".", "./out", "../out", "/work/out/../out"]) {
  it(`normalizes command source and output paths for --outdir ${outdir}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/sub", { recursive: true });
    await fs.writeFile("/work/data.csv", encode("a,b"));
    const observed: string[] = [];
    const read = fs.readFile.bind(fs), write = fs.writeFile.bind(fs);
    fs.readFile = async (path, options) => { observed.push(path); return read(path, options); };
    fs.writeFile = async (path, bytes, options) => { observed.push(path); return write(path, bytes, options); };
    const result = await createSofficeCommand().execute(invocation(fs, ["--convert-to=txt", `--outdir=${outdir}`, "./sub/../data.csv"], () => {}));
    assert.equal(result.exitCode, 0);
    const expected = outdir === "." ? "/work/data.txt" : outdir === "../out" ? "/out/data.txt" : "/work/out/data.txt";
    assert.deepEqual(observed, ["/work/data.csv", expected]);
  });
}

for (const run of [runSofficeCli, runSofficeCliSync]) {
  it(`${run.name} resolves normalized absolute input map keys and relative output directories`, async () => {
    const files = new Map([["/work/data.csv", encode("a,b")]]);
    const result = await run(["--convert-to", "txt", "--outdir", "../out/.", "./data.csv"], files, "/work");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(files.get("/out/data.txt")), "a\tb\n");
  });
}

for (const args of [["--help", "data.csv"], ["--version", "data.csv"], ["data.csv", "--outdir"]]) {
  it(`does not read files for a terminal argument result: ${args.join(" ")}`, async () => {
    const fs = new MemoryFileSystem();
    const reads: string[] = [];
    fs.readFile = async path => { reads.push(path); return encode("a,b"); };
    await createSofficeCommand().execute(invocation(fs, args, () => {}));
    assert.deepEqual(reads, []);
  });
}
