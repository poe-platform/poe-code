import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
const cases = [
    { name: "shadow color", shadow: true, output: ["-colorspace", "sRGB"], pixel: "2fbfdf66" },
    { name: "shadow black ink", shadow: true, output: ["-channel", "K", "-separate"], pixel: "000000ff" },
    { name: "unchanged color", shadow: false, output: ["-colorspace", "sRGB"], pixel: "5080c080" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`${mode}: renders CMYK $name`, async ({ shadow, output, pixel }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const args = ["-size", "3x2", "xc:#5080c080", "-colorspace", "CMYK", "-background", "#d04020",
        ...(shadow ? ["-shadow", "80x0+0+0"] : []), ...output, "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(pixel.repeat(6));
});
