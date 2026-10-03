import { expect, test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createDotCommand } from "./index.js";
import { createNeatoCommand } from "safe-bash-command-neato";
import { createSvgoCommand } from "safe-bash-command-svgo";
async function run(command: CommandDefinition, args: string[], input = "digraph { a -> b }") {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.dot", new TextEncoder().encode(input));
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await command.execute({
    command: command.name,
    args: createCommandArguments(args).args,
    cwd: "/",
    env: {},
    fs,
    stdin: toByteSource(input),
    stdout: {
      async write(b) {
        chunks.push(b.slice());
      }
    },
    stderr: {
      async write(b) {
        stderr += new TextDecoder().decode(b);
      }
    },
    signal: new AbortController().signal
  });
  const bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of chunks) {
    bytes.set(b, offset);
    offset += b.length;
  }
  return { ...result, bytes, text: new TextDecoder().decode(bytes), stderr, fs };
}
test("DOT formats and overrides work on stdin and virtual files", async () => {
  for (const format of ["svg", "json", "dot", "canon", "plain"]) {
    const r = await run(createDotCommand(), [
      "-T" + format,
      "-Grankdir=LR",
      "-Nshape=box",
      "-Ecolor=red",
      "in.dot"
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.text.length).toBeGreaterThan(10);
  }
  const r = await run(createDotCommand(), ["-Tjson", "-Grankdir=LR"]);
  const g = JSON.parse(r.text);
  expect(g.nodes[1].x).toBeGreaterThan(g.nodes[0].x);
  expect((await run(createDotCommand(), ["-Tsvg", "-Nshape=box"])).text).toContain("polygon");
});
test("raster output preserves bytes on stdout and in files", async () => {
  for (const [format, magic] of [
    ["png", [137, 80, 78, 71]],
    ["jpg", [255, 216]],
    ["jpeg", [255, 216]],
    ["webp", [82, 73, 70, 70]]
  ] as const) {
    const r = await run(createDotCommand(), ["-T" + format]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect([...r.bytes.slice(0, magic.length)]).toEqual(magic);
    const f = await run(createDotCommand(), ["-T" + format, "-o", "image"]);
    expect(f.exitCode, f.stderr).toBe(0);
    expect(await f.fs.readFile("/image")).toEqual(r.bytes);
    expect(f.bytes.length).toBe(0);
  }
});
test("neato selects a deterministic distinct layout, including -K", async () => {
  const input = "graph { a -- b; b -- c; c -- a }";
  const a = await run(createNeatoCommand(), ["-Tjson"], input),
    b = await run(createDotCommand(), ["-Tjson", "-Kneato"], input);
  expect(a.exitCode, a.stderr).toBe(0);
  expect(a.text).toBe(b.text);
  expect(a.text).not.toBe((await run(createDotCommand(), ["-Tjson"], input)).text);
});
test("help, version, invalid input, options and resource limits", async () => {
  for (const flag of ["--help", "-?", "-V"]) {
    expect((await run(createDotCommand(), [flag], "invalid")).exitCode).toBe(0);
  }
  for (const args of [["-Tnope"], ["-Knope"], ["-o"], ["-Gbad"]])
    expect((await run(createDotCommand(), args)).exitCode).not.toBe(0);
  expect((await run(createDotCommand(), [], "invalid")).exitCode).toBe(1);
  await expect(run(createDotCommand({ limits: { maxInputBytes: 4 } }), [])).rejects.toThrow(
    "input byte limit"
  );
  expect((await run(createDotCommand({ limits: { maxNodes: 1 } }), [])).exitCode).toBe(1);
  expect(
    (await run(createDotCommand({ limits: { maxOutputBytes: 4 } }), ["-Tsvg"])).bytes.length
  ).toBe(0);
});
test("svgo supports strings, streaming, precision, multipass, pretty and file output", async () => {
  const svg = '<svg width="10" height="20"><!-- drop --><path d="M0 0 L1.23456 0"/></svg>';
  const a = await run(createSvgoCommand(), [
    "-s",
    svg,
    "--multipass",
    "-p",
    "2",
    "--pretty",
    "--indent",
    "4",
    "-q"
  ]);
  expect(a.exitCode, a.stderr).toBe(0);
  expect(a.text).not.toContain("drop");
  expect(a.text).toContain("1.23");
  expect(a.text).toContain("\n    <path");
  const b = await run(createSvgoCommand(), ["-", "-o", "-"], svg);
  expect(b.exitCode, b.stderr).toBe(0);
  const c = await run(createSvgoCommand(), ["-i", "in.dot", "-o", "out.svg"], svg);
  expect(c.exitCode, c.stderr).toBe(0);
  expect(new TextDecoder().decode(await c.fs.readFile("/out.svg"))).toBe(b.text);
  for (const args of [["-p", "-1"], ["--indent", "999"], ["-s"], ["--unknown"]])
    expect((await run(createSvgoCommand(), args, svg)).exitCode).not.toBe(0);
});
test("Graphviz family registers all commands and works in shell pipelines", async () => {
  const shellSource: string = "../../safe-bash/src/shell/shell.js";
  const pluginSource: string = "../../safe-bash/src/commands/graphviz/index.js";
  const { Shell } = await import(shellSource);
  const { graphvizCommands, parseDot } = await import(pluginSource);
  expect(parseDot("digraph { a }").directed).toBe(true);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/graph.dot", new TextEncoder().encode("digraph { a -> b }"));
  const shell = new Shell({ fs, cwd: "/" }).use(graphvizCommands());
  try {
    expect(await shell.exec("dot -Tsvg graph.dot | svgo - -o graph.svg --multipass")).toMatchObject(
      { exitCode: 0, stdout: "", stderr: "" }
    );
    expect(new TextDecoder().decode(await fs.readFile("/graph.svg"))).toContain("<svg");
    expect(await shell.exec("neato -Twebp graph.dot -o graph.webp")).toMatchObject({
      exitCode: 0,
      stdout: "",
      stderr: ""
    });
    expect(new TextDecoder().decode((await fs.readFile("/graph.webp")).slice(0, 4))).toBe("RIFF");
  } finally {
    await shell.dispose();
  }
});
