import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI preserves existing alpha under black mask pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "enabled alpha", color: "804020", before: ["-alpha", "On"], alpha: "ff" },
        { name: "partial alpha", color: "80402060", before: [], alpha: "60" },
        { name: "RGB input", color: "804020", before: [], alpha: "00" },
        { name: "disabled alpha", color: "804020ff", before: ["-alpha", "Off"], alpha: "00" },
    ])(`${mode}: transparent honors $name`, async ({ color, before, alpha }) => {
        const mask = Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([0, 255, 255])]);
        const argv = ["-size", "3x1", `xc:#${color}`, ...before, "-write-mask", "mask.pgm",
            "-alpha", "Transparent", "+write-mask", "-depth", "8", "rgba:out"];
        const files = new Map([["out", Buffer.from("KEEP")], ["mask.pgm", mask]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(`804020${alpha}8040200080402000`);
    });
}
