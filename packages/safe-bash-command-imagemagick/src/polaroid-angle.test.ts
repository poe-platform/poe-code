import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI geometry parsing and output preservation.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        ...["12x0", "12%", "12>", "(12)", "+12", "%[fx:12]"].map(angle => ({ angle, expected: "44x42,44x42-4-5" })),
        ...["0b1100", "0xC", "bogus"].map(angle => ({ angle, expected: "KEEP" })),
    ])(`${mode}: parses polaroid angle $angle like native`, async ({ angle, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n8 6\n255\n"), ...Uint8Array.from({ length: 144 }, (_, i) => (i * 37 + 19) % 256)]);
        const files = new Map([["im.ppm", input], ["out", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = ["-seed", "7", "im.ppm", "-polaroid", angle, "-format", "%wx%h,%Wx%H%X%Y", "info:out"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(expected === "KEEP" ? 1 : 0);
        if (expected === "KEEP") expect(stderr).toContain("invalid argument for option '-polaroid'");
        const output = mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        expect(new TextDecoder().decode(output)).toBe(expected);
    });
}
