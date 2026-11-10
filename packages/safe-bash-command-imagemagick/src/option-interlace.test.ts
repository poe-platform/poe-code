import { describe, expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick: option metadata changes do not enable encoder interlacing.
describe.each(["command", "retained", "buffered", "sync"] as const)("option interlace (%s)", mode => {
  async function run(options: string[], output: string[], missingOption = false) {
    const args = ["xc:#204080", "xc:#305090", "+append", ...options, ...output];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    let stdout = "", stderr = "";
    const chunks: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe(missingOption ? "magick: unknown image property '%[option:interlace]'\n" : "");
    return {
      stdout: "stdout" in result ? result.stdout : stdout,
      bytes: "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks)
    };
  }

  it.each([
    { options: ["-set", "option:interlace", "Plane"], expected: "Plane/Plane" },
    { options: ["-define", "interlace=Plane"], expected: "Plane/Plane" },
    { options: ["-define", "interlace=Plane", "+define", "interlace"], expected: "Plane/" },
    { options: ["-set", "option:interlace", "Plane", "+set", "option:interlace"], expected: "Plane/" },
    { options: ["-set", "interlace", "Plane"], expected: "Plane/" },
    { options: ["-interlace", "Plane"], expected: "Plane/Plane" },
    { options: ["-define", "interlace=lInE"], expected: "Line/lInE" },
    { options: ["-define", "interlace=custom"], expected: "Unrecognized/custom" }
  ])("reports $expected for $options", async ({ options, expected }) => {
    expect((await run(options, ["-format", "%[interlace]/%[option:interlace]", "info:-"], expected.endsWith("/"))).stdout).toBe(expected);
  });

  it.each([
    ["-set", "option:interlace", "Plane"],
    ["-define", "interlace=Plane"]
  ])("captures image metadata before removing %s", async (...options) => {
    expect((await run([...options, "-set", "label", "%[interlace]", "+define", "interlace"],
      ["-format", "%[label]/%[interlace]", "info:-"])).stdout).toBe("Plane/Plane");
  });

  it.each([
    ["-set", "option:interlace", "Plane"],
    ["-define", "interlace=Plane"],
    ["-define", "interlace=Plane", "+define", "interlace"]
  ])("preserves packed RGB and noninterlaced PNG for %s", async (...options) => {
    const raw = await run(options, ["-depth", "8", "rgb:-"]);
    expect(Buffer.from(raw.bytes).toString("hex")).toBe("204080305090");
    const png = await run(options, ["PNG24:-"]);
    expect(png.bytes[28]).toBe(0);
    expect(Buffer.from(sharp(png.bytes).removeAlpha().raw().toBufferSync()).toString("hex")).toBe("204080305090");
  });
});
