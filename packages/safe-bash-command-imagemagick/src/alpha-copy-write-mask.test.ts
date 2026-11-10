import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including the stored-alpha and rectangular-region controls.
for (const backend of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "attached mask", operations: ["-write-mask", "mask.pgm", "-alpha", "Copy"], expected: "8040204b2c160bff2c160bff" },
        { name: "intermediate write", operations: ["-write-mask", "mask.pgm", "-alpha", "Copy", "-depth", "8", "-write", "rgba:masked", "+write-mask"], expected: "804020ff482412ff482412ff" },
        { name: "cleared mask", operations: ["-write-mask", "mask.pgm", "-alpha", "Copy", "+write-mask"], expected: "804020ff482412ff482412ff" },
        { name: "stored alpha", operations: ["-write-mask", "mask.pgm", "-alpha", "Copy", "+write-mask", "-channel", "A", "-separate", "+channel"], expected: "4b4b4bff606060ff606060ff" },
        { name: "region", operations: ["-region", "1x1+1+0", "-alpha", "Copy"], expected: "2c160bff8040204b2c160bff" },
    ])(`${backend}: alpha Copy with $name`, async ({ name, operations, expected }) => {
        const files = new Map([
            ["mask.pgm", new Uint8Array([...new TextEncoder().encode("P5\n3 1\n255\n"), 0, 255, 255])],
            ["out", new TextEncoder().encode("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = ["-size", "3x1", "xc:#80402060", ...operations, "-depth", "8", "rgba:out"];
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = backend === "sync" ? runMagickCliSync(argv, files)
            : backend === "buffered" ? await runMagickCli(argv, files)
            : backend === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "command" || backend === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
        if (name === "intermediate write") {
            const masked = backend === "command" || backend === "retained" ? await fs.readFile("/masked") : files.get("masked")!;
            expect(Buffer.from(masked).toString("hex")).toBe("8040204b2c160bff2c160bff");
        }
    });
}
