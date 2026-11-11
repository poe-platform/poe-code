import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  it.each([["null:", "xc:red"], ["xc:red", "null:"], ["xc:red"]])(
    `reports the native separator diagnostic for incomplete Composite lists (${mode}): %j`,
    async (...inputs) => {
      const args = [...inputs, "-layers", "Composite", "-depth", "8", "rgb:-"];
      const filesystem = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(1);
      expect("stdout" in result ? result.stdout : stdout).toBe("");
      expect("stderr" in result ? result.stderr : stderr).toContain("missing Null Image List Separator layers Composite");
    }
  );
}

const fixture = "R0lGODlhCQAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwCAAMAAwACAAACAoRfACH5BAAXAAAALAUABAACAAIAgAAA/wAAAAIChFEAOw==";

for (const mode of ["buffered", "retained", "command"]) {
  const retained = mode !== "buffered";
  it(`composites one overlay across animation frames (${mode})`, async () => {
    const input = new Uint8Array(Buffer.from(fixture, "base64"));
    const files = new Map([["in.gif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.gif", input);
    const io = retained ? { filesystem, cwd: "/" } : files;
    expect(await runConvertCli(["-size", "1x1", "xc:lime", "mark.gif"], io)).toMatchObject({ exitCode: 0 });
    const args = ["in.gif", "-coalesce", "null:", "mark.gif", "-geometry", "+2+3", "-layers", "Composite", "out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
      args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} } })
      : await runConvertCli(args, io);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    const decoded = decodeImage(output, { animated: true });
    expect(decoded).toMatchObject({ width: 9, delay: [70, 230], loop: 4 });
    expect(decoded.data.length).toBe(9 * 8 * 4 * 2);
    for (const page of [0, 1]) {
      const frame = decodeImage(output, { page });
      expect(frame).toMatchObject({ width: 9, height: 8 });
      expect(Array.from(frame.data.slice((3 * 9 + 2) * 4, (3 * 9 + 2) * 4 + 4))).toEqual([0, 255, 0, 255]);
    }
  });
}

for (const retained of [false, true]) {
  it(`requires a null separator, not a transparent image (retained=${retained})`, async () => {
    const io = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
    expect(await runConvertCli(["-size", "1x1", "xc:red", "xc:none", "xc:lime", "-layers", "Composite", "out.gif"], io)).toMatchObject({
      exitCode: 1, stderr: expect.stringContaining("missing Null Image List Separator")
    });
  });

  it(`pairs two sequences without emitting the separator (retained=${retained})`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    expect(await runConvertCli(["-size", "1x1", "xc:red", "xc:blue", "null:", "xc:lime", "xc:yellow", "-layers", "composite", "out.gif"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const output = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect(Array.from(decodeImage(output, { animated: true }).data)).toEqual([0, 255, 0, 255, 255, 255, 0, 255]);
  });
}
