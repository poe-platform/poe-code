import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results for the PPM below.
const cases = [
    { suffix: ",50%", metadata: "6x5 4x3+1+1", pixels: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f50515253545556575859" },
    { suffix: ",5:2", metadata: "1x1 1x1+0+0", pixels: "000102" },
    { suffix: ",2/3", metadata: "2x2 1x1+0+0", pixels: "0001020f101148494a575859" },
    { suffix: ",3", metadata: "5x4 3x2+1+1", pixels: "0001020304050607080c0d0e0f101112131415161718191a1e1f202122232425262728292a2b2c30313233343548494a4b4c4d4e4f50545556575859" },
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const output of ["info", "rgb"]) {
        it.each(cases)(`honors chop comma suffix $suffix for ${output} (${mode})`, async ({ suffix, metadata, pixels }) => {
            const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...Array.from({ length: 90 }, (_, i) => i)]);
            const files = new Map([["/in.ppm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const argv = ["/in.ppm", "-repage", "4x3+1+1", "-gravity", "Center", "-chop", `1x1+1+1${suffix}`,
                ...(output === "info" ? ["-format", "%wx%h %g"] : ["-depth", "8"]), `${output}:/out`];
            const args = createCommandArguments(argv);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output === "info" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(output === "info" ? metadata : pixels);
        });
    }
}
