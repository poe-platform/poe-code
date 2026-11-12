import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const [input, success] of [
        ["in.ppm", false], ["in.PPM", false], ["ppm:in.tga", false],
        ["tga:in.ppm", true], ["in.tga", true], ["ppm", true],
    ] as const) {
        it(`respects the PPM filename and explicit TGA coder (${mode}, ${input})`, async () => {
            const fixture = Uint8Array.from(Buffer.from("0000020000000000000000000300020018000000ff00ff00ff0000332211776655aa9988", "hex"));
            const path = input.slice(input.indexOf(":") + 1);
            const files = new Map([[path, fixture]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile(`/${path}`, fixture);
            const args = [input, "-format", "%wx%h", "info:"];
            let stdout = "", stderr = "", exitCode: number;
            if (mode === "command") {
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                });
                exitCode = result.exitCode;
            } else {
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                ({ stdout, stderr, exitCode } = result);
            }
            expect(exitCode).toBe(success ? 0 : 1);
            expect(stdout).toBe(success ? "3x2" : "");
            if (success) expect(stderr).toBe("");
            else expect(stderr).toContain("improper image header");
        });
    }
}
