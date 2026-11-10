import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including alpha extrema.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    { operation: "Max", before: ["Multiply", "3"], after: ["Divide", "3"], expected: "ef7f43e1" },
    { operation: "Max", before: [], after: [], expected: "ef7f43e1" },
    { operation: "Min", before: ["Divide", "7"], after: ["Multiply", "7"], expected: "9c5a2759" },
    { operation: "Min", before: [], after: [], expected: "9c5a2759" },
    { operation: "", before: ["Multiply", "3"], after: ["Divide", "3"], expected: "ef7f4359" },
  ])(`${mode}: $operation preserves working values through $before / $after`, async ({ operation, before, after, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const initial = new TextEncoder().encode("KEEP");
    files.set("/out", initial);
    await fs.writeFile("/out", initial);
    const colors = operation ? ["#ef7f4359", "#9c5a27e1"] : ["#ef7f4359"];
    const args = [
      ...colors.flatMap(color => ["(", `xc:${color}`, ...(before.length ? ["-evaluate", ...before] : []), ")"]),
      ...(operation ? ["-evaluate-sequence", operation] : []),
      ...(after.length ? ["-evaluate", ...after] : []), "-depth", "8", "rgba:/out",
    ];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const depth of [8, 16]) {
    it.each([
      { operation: "Max", channel: ["-channel", "RGB"], alpha: 0 },
      { operation: "Min", channel: ["-channel", "RGB"], alpha: 0 },
      { operation: "Mean", channel: ["-channel", "RGB"], alpha: 0 },
      { operation: "Max", channel: [], alpha: 0x82 },
      { operation: "Min", channel: [], alpha: 0x46 },
    ])(`${mode}: $operation alpha with $channel at depth ${depth}`, async ({ operation, channel, alpha }) => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      const initial = new TextEncoder().encode("KEEP");
      files.set("/out", initial);
      await fs.writeFile("/out", initial);
      const args = [
        "-depth", String(depth), "xc:#b5267382", "xc:#297d3846", "-colorspace", "sRGB",
        ...channel, "-evaluate-sequence", operation, "+channel", "-channel", "A", "-separate",
        "+channel", "-depth", String(depth), "gray:/out",
      ];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
      expect(output).toEqual(new Uint8Array(depth / 8).fill(alpha));
    });
  }
}
