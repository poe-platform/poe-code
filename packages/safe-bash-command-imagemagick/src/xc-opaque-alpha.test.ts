import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "retained", "command", "sync"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI reference results.
  it.each([
    { args: ["xc:#c04020ff", "-format", "%[channels]", "info:/out"], expected: "srgba 4.0" },
    { args: ["xc:#2060b0", "(", "xc:#c04020ff", ")", "-evaluate-sequence", "Mean", "-depth", "8", "rgba:/out"], expected: "70506880" },
    { args: ["xc:#2060b0", "(", "xc:#c04020ff", "-alpha", "on", ")", "-evaluate-sequence", "Mean", "-depth", "8", "rgba:/out"], expected: "70506880" },
    { args: ["xc:#c04020", "-format", "%[channels]", "info:/out"], expected: "srgb  3.0" },
    { args: ["xc:#c04020fe", "-format", "%[channels]", "info:/out"], expected: "srgba 4.0" },
    { args: ["canvas:#c04020ff", "-format", "%[channels]", "info:/out"], expected: "srgba 4.0" },
  ])(`${mode}: $args`, async ({ args, expected }) => {
    const fs = createMemoryFileSystem(), files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const bytes = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(args.at(-1)!.startsWith("info:") ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
  });
}
