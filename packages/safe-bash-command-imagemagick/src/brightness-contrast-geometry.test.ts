import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, 8-bit MSB RGB output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["x30", 1, "4b454550"],
        ["10+30", 1, "4b454550"],
        ["1e", 1, "4b454550"],
        ["1.2.3", 1, "4b454550"],
        ["bogus", 1, "4b454550"],
        ["0x9", 0, "044b93069af1cad83b"],
        ["0X9", 0, "044b93069af1cad83b"],
        ["0e+0x9e0", 0, "044b93069af1cad83b"],
        ["10x30+2", 0, "0360bd06c7ffffff4b"],
    ] as const)(`${mode}: validates brightness-contrast %s before replacing output`, async (geometry, exitCode, expected) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const destination = new TextEncoder().encode("KEEP");
        const files = new Map([["a.ppm", input], ["out", destination]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a.ppm", input);
        await fs.writeFile("/out", destination);
        const argv = ["a.ppm", "-brightness-contrast", geometry, "-endian", "MSB", "-depth", "8", "rgb:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(result.exitCode).toBe(exitCode);
        expect(Buffer.from(output).toString("hex")).toBe(expected);
        if (exitCode) expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-brightness-contrast'");
    });
}
