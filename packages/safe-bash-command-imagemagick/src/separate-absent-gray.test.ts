import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Gray has only R and optional A samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const alpha of ["80", "38"])
for (const channel of ["G", "B", "K", "R", "A"]) {
    it(`${mode}: separates Gray ${channel} with alpha=${alpha}`, async () => {
        const files = new Map([["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const argv = [`xc:#2060b0${alpha}`, "-alpha", "on", "-colorspace", "Gray", "-channel", channel, "-separate", "-depth", "8", "rgba:out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        const sample = channel === "R" ? "58" : channel === "A" ? alpha : "00";
        expect(Buffer.from(output).toString("hex")).toBe(sample.repeat(3) + "ff");
    });
}
