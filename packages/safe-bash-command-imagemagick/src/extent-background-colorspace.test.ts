import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw CMYKA8: covered source pixel followed by padding.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const compose of ["Copy", "Over"] as const) {
        it.each([
            { background: "cmyka(10%,20%,30%,40%,0.5)", padding: "1a334d6680", over: "8f541993c0" },
            { background: "cmyk(0%,100%,100%,25%)", padding: "00ffff40ff", over: "65b27f75ff" },
            { background: "gray(128)", padding: "0000007fff", over: "65330094ff" },
            { background: "gray50", padding: "00000080ff", over: "65330095ff" },
            { background: "#808080", padding: "000000c8ff", over: "653300b8ff" },
            { background: "white", padding: "00000000ff", over: "65330055ff" },
        ])(`${mode}: ${compose} extent honors $background colorspace`, async ({ background, padding, over }) => {
            const argv = ["xc:#12345680", "-colorspace", "CMYK", "-background", background,
                "-compose", compose, "-extent", "2x1", "-depth", "8", "cmyka:/out"];
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe((compose === "Copy" ? "ca6500a980" : over) + padding);
        });
    }
}
