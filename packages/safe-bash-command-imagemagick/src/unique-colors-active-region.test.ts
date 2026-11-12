import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("50370a574944544820340a48454947485420330a444550544820340a4d415856414c203235350a5455504c54595045205247425f414c5048410a454e444844520a2d6fd00034a67b33d43f5a502c6ed100fefffdff261413f0d43f5a50fefffdff2d6fd00034a67b332c6ed100261413f0", "hex");

// ImageMagick 7.1.2-35 Q16-HDRI, including closed-region and no-region controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) for (const destination of ["/out", "-"]) {
    it.each([
        { alpha: "On", region: "active", hex: "d43f5a5034a67b332d6fd0002c6ed100261413f0fefffdff" },
        { alpha: "On", region: "closed", hex: "d43f5a5034a67b332d6fd0002c6ed100261413f0fefffdff" },
        { alpha: "On", region: "none", hex: "d43f5a5034a67b332d6fd0002c6ed100261413f0fefffdff" },
        { alpha: "Off", region: "active", hex: "26141300d43f5a0034a67b002d6fd0002c6ed100fefffd00" },
        { alpha: "Off", region: "closed", hex: "261413ffd43f5aff34a67bff2d6fd0ff2c6ed1fffefffdff" },
        { alpha: "Off", region: "none", hex: "261413ffd43f5aff34a67bff2d6fd0ff2c6ed1fffefffdff" },
    ])(`${mode} ${destination}: writes palette with alpha $alpha and $region region`, async ({ alpha, region, hex }) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-alpha", alpha, ...(region === "none" ? [] : ["-region", "2x1+1+1"]),
            "-unique-colors", ...(region === "closed" ? ["+region"] : []), "-depth", "8", `rgba:${destination}`];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = destination === "-"
            ? mode === "command" ? Buffer.concat(stdout) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array()
            : mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
