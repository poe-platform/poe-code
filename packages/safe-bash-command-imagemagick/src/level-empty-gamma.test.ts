import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes for the same PPM input.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["-level", "10%,80%,", "00004e29ab620000b56cfffff317ffff38a6"],
        ["+level", "10x80%,", "242451d27f7f258c846abbeea2a2abc54747"],
        ["+level", "10%,80%,,", "242451d27f7f258c846abbeea2a2abc54747"],
        ["-level", "10x80%,1", "00004e29ab620000b56cfffff317ffff38a6"],
        ["+level", "10x80%", "242451d27f7f258c846abbeea2a2abc54747"],
    ])(`${mode} defaults empty gamma to one in %s %s`, async (operator, geometry, expected) => {
        const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
        const files = new Map([["/a.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const argv = ["/a.ppm", operator, geometry, "-endian", "MSB", "-depth", "16", "rgb:/out"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command"
            ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } })
            : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
