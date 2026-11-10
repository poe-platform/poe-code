import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray has one color channel, selected by R.
const cases = [
    { name: "Gray R", args: ["xc:red", "-colorspace", "Gray", "-channel", "R", "-evaluate", "set", "100%", "+channel", "-depth", "8", "rgba:out"], output: "ffffffff" },
    { name: "Gray G", args: ["xc:red", "-colorspace", "Gray", "-channel", "G", "-evaluate", "set", "100%", "+channel", "-depth", "8", "rgba:out"], output: "363636ff" },
    { name: "Gray metadata", args: ["xc:red", "-colorspace", "Gray", "-format", "%[colorspace]|%r", "info:out"], output: "Gray|DirectClass Gray " },
    { name: "sRGB G", args: ["xc:#806020", "-channel", "G", "-evaluate", "set", "100%", "+channel", "-depth", "8", "rgba:out"], output: "80ff20ff" },
    { name: "sRGB R", args: ["xc:#806020", "-channel", "R", "-evaluate", "set", "100%", "+channel", "-depth", "8", "rgba:out"], output: "ff6020ff" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: evaluates the logical channel for $name`, async ({ args, output }) => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(bytes).toString(args.at(-1) === "info:out" ? "utf8" : "hex")).toBe(output);
    });
}
