import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 0 0 255\n");
// ImageMagick 7.1.2-35 Q16-HDRI signature of the input pixels.
const digest = "eb9ebef982835ea92e7e6a83ae2d97ab8dad9528d966e4740da5137a077f4584";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    async function run(args: string[]) {
        const files = new Map([["/a.ppm", input]]);
        if (mode === "sync") return runMagickCliSync(args, files);
        if (mode === "buffered") return runMagickCli(args, files);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.ppm", input);
        if (mode === "retained") return runMagickCli(args, { filesystem, cwd: "/" });
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = await command.execute({
            command: command.name, args: argumentValues.args, argumentValues, fs: filesystem, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        });
        return { ...result, stdout, stderr };
    }

    for (const output of ["info:", "identify", "histogram:info:"]) {
        it(`${mode} ${output}: reads signature in format order`, async () => {
            const args = (format: string) => output === "identify"
                ? ["identify", "-format", format, "/a.ppm"]
                : ["/a.ppm", "-format", format, output];
            const baseline = await run(args("%#"));
            expect(baseline).toMatchObject({ exitCode: 0, stderr: "" });
            if (output !== "histogram:info:") expect(baseline.stdout).toBe(digest);
            else expect(baseline.stdout).toHaveLength(64);
            for (const { format, stdout, stderr } of [
                { format: "%[signature]", stdout: "", stderr: expect.stringContaining("unknown image property '%[signature]'\n") },
                { format: "%[signature]/%#/%[SIGNATURE]", stdout: `/${baseline.stdout}/${baseline.stdout}`, stderr: expect.stringContaining("unknown image property '%[signature]'\n") },
                { format: "%#/%[signature]", stdout: `${baseline.stdout}/${baseline.stdout}`, stderr: "" }
            ]) {
                expect(await run(args(format))).toEqual({ exitCode: 0, stdout, stderr });
            }
        });
    }

    it(`${mode}: preserves explicit signature until the digest is requested`, async () => {
        expect(await run(["/a.ppm", "-set", "signature", "from-script", "-format", "%[signature]/%#/%[signature]", "info:"]))
            .toEqual({ exitCode: 0, stderr: "", stdout: `from-script/${digest}/${digest}` });
    });

    it(`${mode}: stores the computed signature for subsequent formats`, async () => {
        expect(await run(["/a.ppm", "-format", "%#", "-write", "info:", "-format", "/%[signature]", "info:"]))
            .toEqual({ exitCode: 0, stderr: "", stdout: `${digest}/${digest}` });
    });

    it(`${mode}: allows the computed signature to be replaced or removed`, async () => {
        expect(await run(["/a.ppm", "-format", "%#", "-write", "info:", "-set", "signature", "replacement", "-format", "/%[signature]", "info:"]))
            .toEqual({ exitCode: 0, stderr: "", stdout: `${digest}/replacement` });
        expect(await run(["/a.ppm", "-format", "%#", "-write", "info:", "+set", "signature", "-format", "/%[signature]", "info:"]))
            .toEqual({ exitCode: 0, stderr: "magick: unknown image property '%[signature]'\n", stdout: `${digest}/` });
    });

}
