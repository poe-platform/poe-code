import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete row-major Meta0 gray8 output.
const cases = [
    { name: "virtual canvas", options: ["-repage", "7x5+1+1"], hex: "00000000000000002a6a9ea69000003479aab4ab00003982b1bcbb0000000000000000" },
    { name: "white background", options: ["-background", "white"], hex: "2a6a9ea6903479aab4ab3982b1bcbb" },
    { name: "default channels", options: [], hex: "2a6a9ea6903479aab4ab3982b1bcbb" },
    { name: "Meta0 selected", options: ["-channel", "Meta0"], hex: "005cc0c05d00c0c0c0c000c0c0c0c0" },
    { name: "R selected", options: ["-channel", "R"], hex: "000000000000000000000000000000" },
    { name: "unchanged input", options: [], vignette: false, hex: "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`${mode}: renders Meta0 $name`, async ({ vignette = true, options, hex }) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const args = ["-size", "5x3", "xc:#404040", "-duplicate", "3", "xc:#c0c0c0", "-combine", "-background", "black",
        ...options, ...(vignette ? ["-vignette", "0x1+1+0"] : []), "+channel", "-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"];
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
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
