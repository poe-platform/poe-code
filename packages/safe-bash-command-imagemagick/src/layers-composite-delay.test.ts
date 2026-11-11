import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  const retained = mode !== "buffered";
  it.each([
    { destinations: [7], sources: [14, 15], expected: [14, 15] },
    { destinations: [7], sources: [14, 15, 16], expected: [14, 15, 16] },
    { destinations: [7], sources: ["14x50", "15x50"], expected: [14, 15] },
    { destinations: [7], sources: [14], expected: [7] },
    { destinations: [7, 8], sources: [14], expected: [7, 8] },
    { destinations: [7, 8], sources: [14, 15], expected: [7, 8] }
  ])(`preserves Composite timing and destination metadata (${mode}): %j`, async ({ destinations, sources, expected }) => {
    const filesystem = new MemoryFileSystem();
    const args = ["-label", "destination", "-dispose", "None",
      ...destinations.flatMap(delay => ["-delay", String(delay), "xc:red"]), "null:",
      "-label", "source", "-dispose", "Previous",
      ...sources.flatMap((delay, index) => ["-delay", String(delay), index % 2 ? "xc:yellow" : "xc:lime"]),
      "-layers", "Composite", "-format", "%T;%l;%D;", "info:"];
    let stdout = "";
    if (mode === "command") {
      const result = await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async data => { stdout += typeof data === "string" ? data : new TextDecoder().decode(data); } },
        stderr: { write: async () => {} } });
      expect(result.exitCode).toBe(0);
    } else {
      const result = await runConvertCli(args, retained ? { filesystem, cwd: "/" } : new Map<string, Uint8Array>());
      expect(result.exitCode).toBe(0);
      stdout = result.stdout;
    }
    expect(stdout).toBe(expected.map(delay => `${delay};destination;None;`).join(""));
  });
}

for (const retained of [false, true]) {
  it(`copies decoded source frame delays into the output animation (retained=${retained})`, async () => {
    const input = new Uint8Array(Buffer.from("R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwCAAMAAwACAAACAoRfACH5BAAXAAAALAUABAACAAIAgAAA/wAAAAIChFEAOw==", "base64"));
    const filesystem = new MemoryFileSystem(), files = new Map([["in.gif", input]]);
    await filesystem.writeFile("/in.gif", input);
    const result = await runConvertCli(["-size", "9x8", "xc:white", "null:", "in.gif", "-layers", "Composite", "out.gif"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(decodeImage(output, { animated: true }).delay).toEqual([70, 230]);
  });
}
