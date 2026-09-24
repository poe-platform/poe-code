import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCommandArguments,
  type CommandContext
} from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import {
  createMmdcCommand,
  decodePngToRgba,
  mmdcCommands,
  parseMmdcArguments,
  renderMermaidPng,
  renderMermaidSvg,
  runMmdc,
  type MmdcSettings
} from "./index.js";

it("uses consistent viewport sizing for graphs and sequences and rejects fractional pixels", () => {
  for (const source of ["flowchart TD; A --> B", "sequenceDiagram\nA->>B: Hello"]) {
    const natural = renderMermaidSvg(source);
    const resized = renderMermaidSvg(source, { width: 320 });
    assert.equal(resized.width, 320);
    assert.equal(resized.height, Math.max(1, Math.round(320 * natural.height / natural.width)));
    for (const dimension of ["width", "height"] as const) {
      assert.throws(() => renderMermaidSvg(source, { [dimension]: 0.1 }), /positive integer/);
    }
  }
});

it("namespaces SVG definitions when embedding diagrams with different root IDs", () => {
  const source = "classDiagram\nclass Example";
  const first = renderMermaidSvg(source, { svgId: "first" }).svg;
  const second = renderMermaidSvg(source, { svgId: "second" }).svg;
  assert.ok(first.includes('id="svg-66-69-72-73-74-mmdc-shadow"'));
  assert.ok(second.includes('id="svg-73-65-63-6f-6e-64-mmdc-node-clip-0"'));
  assert.ok(second.includes('url(#svg-73-65-63-6f-6e-64-mmdc-node-clip-0)'));
  assert.ok(!second.includes('id="mmdc-shadow"'));
});

function createTestVfs(initialFiles: Record<string, string | Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(initialFiles)) {
    files.set(k, typeof v === "string" ? new TextEncoder().encode(v) : v.slice());
  }
  const identityScope = Symbol("test-vfs");
  const dirStat = { type: "directory" as const, size: 0, ino: 1, dev: 1, identityScope };
  const inodes = new Map<string, number>();
  let nextIno = 2;
  const fileStat = (path: string) => {
    const data = files.get(path);
    if (!data) throw new FsError("ENOENT", { path, message: `No such file: ${path}` });
    let ino = inodes.get(path);
    if (ino === undefined) {
      ino = nextIno++;
      inodes.set(path, ino);
    }
    return { type: "file" as const, size: data.byteLength, ino, dev: 1, identityScope };
  };
  return {
    files,
    fs: {
      capabilities: { atomicFileMutation: true, atomicFilePublication: true },
      async readFile(path: string) {
        const data = files.get(path);
        if (!data) throw new FsError("ENOENT", { path, message: `No such file: ${path}` });
        return data.slice();
      },
      async lstat(path: string) {
        return fileStat(path);
      },
      async stat(path: string) {
        if (path === "/" || path === "/vfs") return dirStat;
        return fileStat(path);
      },
      async realpath(path: string) {
        return path;
      },
      async writeFileConditional(path: string, data: Uint8Array) {
        files.set(path, data.slice());
        return fileStat(path);
      }
    }
  };
}

function createMockContext(
  argv: readonly string[],
  vfs: ReturnType<typeof createTestVfs>,
  stdinText = ""
) {
  const carrier = createCommandArguments(argv);
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const context = {
    command: "mmdc",
    args: carrier.args,
    argumentValues: carrier,
    cwd: "/vfs",
    env: {},
    signal: new AbortController().signal,
    stdin: (async function* () {
      if (stdinText.length > 0) {
        yield new TextEncoder().encode(stdinText);
      }
    })(),
    stdout: {
      async write(bytes: Uint8Array) {
        stdoutChunks.push(bytes.slice());
      }
    },
    stderr: {
      async write(bytes: Uint8Array) {
        stderrChunks.push(bytes.slice());
      }
    },
    registerCleanup() {},
    fs: vfs.fs
  } as unknown as CommandContext;

  const concatBytes = (chunks: readonly Uint8Array[]) => {
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  };

  return {
    context,
    stdoutBytes: () => concatBytes(stdoutChunks),
    stdoutText: () => new TextDecoder().decode(concatBytes(stdoutChunks)),
    stderrText: () => new TextDecoder().decode(concatBytes(stderrChunks))
  };
}

describe("mmdc CLI grammar, VFS command execution, and SDK parity", () => {
  it("uses standard stdin, output filename, format override, and scale defaults", () => {
    const stdin = parseMmdcArguments([]);
    assert.equal(stdin.input, "-");
    assert.equal(stdin.output, "out.svg");
    assert.equal(renderMermaidPng("flowchart LR\n A --> B").scale, 1);
    assert.deepEqual(Array.from(decodePngToRgba(renderMermaidPng("flowchart LR\n A --> B").png).rgba.slice(0, 4)), [255, 255, 255, 255]);
    assert.equal(parseMmdcArguments(["-i", "architecture.mmd"]).output, "architecture.mmd.svg");
    assert.equal(parseMmdcArguments(["-i", "-", "-e", "png"]).output, "out.png");
    assert.equal(parseMmdcArguments(["-o", "/dev/stdout"]).output, "-");
    assert.equal(parseMmdcArguments(["-o", "diagram.svg", "-e", "png"]).outputFormat, "png");
  });

  it("accepts standard theme names through both CLI and SDK", () => {
    const source = "flowchart LR\n A --> B";
    for (const theme of ["default", "neutral", "forest", "base", "dark"] as const) {
      assert.equal(parseMmdcArguments(["-t", theme]).theme, theme);
      assert.ok(renderMermaidSvg(source, { theme }).svg.startsWith("<svg"));
    }
  });

  it("honors config scale when no CLI scale is supplied and exposes SVG IDs through typed SDK options", async () => {
    const source = "flowchart LR\n A --> B";
    const vfs = createTestVfs({ "/vfs/config.json": JSON.stringify({ scale: 0.5 }), "/vfs/source.mmd": source });
    const context = createMockContext(["-i", "/vfs/source.mmd", "-o", "-", "-e", "png", "-c", "/vfs/config.json"], vfs);
    assert.equal((await runMmdc(context.context)).exitCode, 0);
    assert.deepEqual(context.stdoutBytes(), renderMermaidPng(source, { scale: 0.5 }).png);
    const typed = createMockContext([], vfs, source);
    assert.equal((await runMmdc(typed.context, { input: "-", output: "-", svgId: "architecture" })).exitCode, 0);
    assert.ok(typed.stdoutText().includes('id="architecture"'));
    assert.ok(renderMermaidSvg(source, { svgId: 'a"b' }).svg.includes('id="a&quot;b"'));
  });

  it("accepts standard Mermaid flowchart configuration and theme variables", async () => {
    const source = "flowchart TD\n A[Start] --> B[End]";
    const config = { theme: "forest", flowchart: { nodeSpacing: 48, rankSpacing: 96, wrappingWidth: 160 },
      themeVariables: { primaryColor: "#dcfce7", primaryTextColor: "#14532d", lineColor: "#166534" } };
    const vfs = createTestVfs({ "/vfs/config.json": JSON.stringify(config) });
    const run = createMockContext(["-i", "-", "-o", "-", "-c", "/vfs/config.json"], vfs, source);
    assert.equal((await runMmdc(run.context)).exitCode, 0, run.stderrText());
    assert.ok(run.stdoutText().includes("#166534"));
    const sdk = renderMermaidSvg(source, { mermaidConfig: config });
    assert.equal(run.stdoutText(), sdk.svg);
    const override = createMockContext(["-i", "-", "-o", "-", "-t", "dark", "-c", "/vfs/config.json"], vfs, source);
    assert.equal((await runMmdc(override.context)).exitCode, 0);
    assert.equal(override.stdoutText(), sdk.svg);
    const typed = createMockContext([], vfs, source);
    assert.equal((await runMmdc(typed.context, { input: "-", output: "-", mermaidConfig: config })).exitCode, 0);
    assert.equal(typed.stdoutText(), sdk.svg);
  });

  it("rejects malformed nested configuration instead of silently ignoring it", () => {
    for (const mermaidConfig of [{ theme: { light: true } }, { theme: { dark: [] } }]) {
      assert.throws(() => renderMermaidSvg("flowchart LR\n A --> B", { mermaidConfig }),
        (error: unknown) => (error as { code?: string }).code === "E_CONFIG");
    }
  });

  it("uses explicit format before the output extension and rejects unsupported formats", () => {
    assert.equal(parseMmdcArguments(["-i", "in.mmd", "-o", "out.svg"]).outputFormat, "svg");
    assert.equal(parseMmdcArguments(["-i", "in.mmd", "-o", "out.png"]).outputFormat, "png");
    assert.equal(parseMmdcArguments(["-i", "-", "-o", "-"]).outputFormat, "svg");
    assert.equal(parseMmdcArguments(["-i", "-", "-o", "-", "-e", "png"]).outputFormat, "png");
    assert.equal(parseMmdcArguments(["-i", "in.mmd", "-o", "out.png"]).scale, undefined);

    assert.equal(parseMmdcArguments(["-i", "in.mmd", "-o", "out.svg", "-e", "png"]).outputFormat, "png");
    assert.throws(
      () => parseMmdcArguments(["-i", "in.mmd", "-o", "out.pdf"]),
      (err: unknown) => (err as { exitCode?: number }).exitCode === 2
    );
    assert.throws(
      () => parseMmdcArguments(["-i", "in.mmd", "-o", "out.svg", "-t", "unknown"]),
      (err: unknown) => (err as { exitCode?: number }).exitCode === 2
    );
    assert.throws(
      () => parseMmdcArguments(["-i", "in.mmd", "-o", "out.svg", "--cssFile", "inject.css"]),
      (err: unknown) => (err as { exitCode?: number }).exitCode === 2
    );
  });

  it("executes with VFS files, pipes, light/dark themes, settings immutability, and preserves output on failure", async () => {
    const source = "flowchart LR\n  A([Start]) --> B{Check}\n  B -->|OK| C[End]\n";
    const vfs = createTestVfs({
      "/vfs/diagram.mmd": source,
      "/vfs/invalid.mmd": "flowchart LR\n  subgraph Unclosed\n  A --> B\n"
    });

    const mutableSettings: { theme: { mode: "light" | "dark"; light: { accent: string } } } = {
      theme: {
        mode: "light",
        light: { accent: "#2563eb" }
      }
    };
    const cmd = createMmdcCommand(mutableSettings as MmdcSettings);
    const plugin = mmdcCommands(mutableSettings as MmdcSettings);
    assert.equal(plugin.length, 1);
    // Mutate caller settings after command creation to prove snapshot isolation
    mutableSettings.theme.mode = "dark";

    // Render light SVG (using snapshotted 'light' default from settings)
    const runLight = createMockContext(["-i", "/vfs/diagram.mmd", "-o", "/vfs/light.svg"], vfs);
    const resLight = await cmd.execute(runLight.context);
    assert.equal(resLight.exitCode, 0);
    const lightSvgText = new TextDecoder().decode(vfs.files.get("/vfs/light.svg")!);
    assert.ok(lightSvgText.includes('fill="white"'));

    // Render dark SVG
    const runDark = createMockContext(
      ["-i", "/vfs/diagram.mmd", "-o", "/vfs/dark.svg", "-t", "dark"],
      vfs
    );
    const resDark = await cmd.execute(runDark.context);
    assert.equal(resDark.exitCode, 0);
    const darkSvgText = new TextDecoder().decode(vfs.files.get("/vfs/dark.svg")!);
    assert.ok(darkSvgText.includes("#1e293b"));
    assert.notEqual(lightSvgText, darkSvgText);

    // Render PNG at scale 2
    const runPng = createMockContext(
      ["-i", "/vfs/diagram.mmd", "-o", "/vfs/out.png", "-t", "dark", "-s", "2"],
      vfs
    );
    const resPng = await cmd.execute(runPng.context);
    assert.equal(resPng.exitCode, 0);
    const pngBytes = vfs.files.get("/vfs/out.png")!;
    assert.deepEqual(Array.from(pngBytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

    // Piped stdin -> stdout SVG
    const runPipeSvg = createMockContext(["-i", "-", "-o", "-", "-t", "light"], vfs, source);
    const resPipeSvg = await cmd.execute(runPipeSvg.context);
    assert.equal(resPipeSvg.exitCode, 0);
    assert.equal(runPipeSvg.stdoutText(), lightSvgText);
    assert.equal(runPipeSvg.stderrText(), "");

    // Piped stdin -> stdout PNG
    const runPipePng = createMockContext(
      ["-i", "-", "-o", "-", "-e", "png", "-t", "dark", "-s", "2"],
      vfs,
      source
    );
    const resPipePng = await cmd.execute(runPipePng.context);
    assert.equal(resPipePng.exitCode, 0);
    assert.deepEqual(runPipePng.stdoutBytes(), pngBytes);

    // Invalid source must exit 1, emit source location on stderr, and preserve existing /vfs/light.svg
    const runInvalid = createMockContext(
      ["-i", "/vfs/invalid.mmd", "-o", "/vfs/light.svg"],
      vfs
    );
    const resInvalid = await cmd.execute(runInvalid.context);
    assert.equal(resInvalid.exitCode, 1);
    assert.ok(runInvalid.stderrText().includes("E_SYNTAX"));
    assert.equal(new TextDecoder().decode(vfs.files.get("/vfs/light.svg")!), lightSvgText);

    // Input/output alias rejected with exit 1
    const runAlias = createMockContext(
      ["-i", "/vfs/light.svg", "-o", "/vfs/light.svg"],
      vfs
    );
    const resAlias = await cmd.execute(runAlias.context);
    assert.equal(resAlias.exitCode, 1);

    // Unsupported .pdf rejected with exit 2
    const runPdf = createMockContext(["-i", "/vfs/diagram.mmd", "-o", "/vfs/diagram.pdf"], vfs);
    const resPdf = await cmd.execute(runPdf.context);
    assert.equal(resPdf.exitCode, 2);

    // SDK parity
    const sdkSvg = renderMermaidSvg(source, { theme: "light" });
    assert.equal(sdkSvg.svg, lightSvgText);

    const sdkPng = renderMermaidPng(source, { theme: "dark", scale: 2 });
    assert.deepEqual(sdkPng.png, pngBytes);

    // Typed runMmdc parity
    const typedRun = createMockContext([], vfs, source);
    const resTyped = await runMmdc(typedRun.context, {
      input: "-",
      output: "-",
      outputFormat: "svg",
      themeMode: "light"
    });
    assert.equal(resTyped.exitCode, 0);
    assert.equal(typedRun.stdoutText(), lightSvgText);
  });
});
