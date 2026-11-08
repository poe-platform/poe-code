import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

for (const format of ["gif", "tiff"] as const) {
    const input = `input.${format}`, output = `output.${format}`;
    const fixture = spawnSync("magick", ["-size", "4x3", "-delay", "7", "xc:red", "-delay", "11", "xc:lime", "-delay", "17", "xc:blue", "-delay", "23", "xc:yellow", `${format}:-`]);
    if (fixture.status !== 0) throw new Error(fixture.stderr.toString());
    for (const mode of ["buffered", "retained", "command", "sync"] as const)
    for (const spec of format === "tiff" ? ["9", "-9", "1,9", "5-2", "-9-2"] : ["9", "-9", "1,9", "5-2", "-9-2", "1-9", "-1", "3-1", ""]) {
        it(`${mode}: ${format} input scenes [${spec}] preserve invalid destinations and select valid frames`, async () => {
            const bytes = new Uint8Array(fixture.stdout);
            const files = new Map([[input, bytes], [output, bytes]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile(`/${input}`, bytes);
            await filesystem.writeFile(`/${output}`, bytes);
            const args = [spec ? `${input}[${spec}]` : input, output];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            const actual = mode === "buffered" || mode === "sync" ? files.get(output)! : await filesystem.readFile(`/${output}`);
            const valid = ["1-9", "-1", "3-1", ""].includes(spec);
            expect(result.exitCode, stderr).toBe(valid ? 0 : 1);
            if (!valid) {
                expect(stderr).toContain("invalid image index");
                expect(actual).toEqual(bytes);
            } else {
                const expected = spec === "1-9" ? [1, 2, 3] : spec === "-1" ? [3] : spec === "3-1" ? [3, 2, 1] : [0, 1, 2, 3];
                const inspected = spawnSync("magick", ["identify", "-format", "%wx%h %[pixel:p{0,0}] %T;", "-"], { input: actual, encoding: "utf8" });
                expect(inspected.status, inspected.stderr).toBe(0);
                const original = spawnSync("magick", ["identify", "-format", "%wx%h %[pixel:p{0,0}] %T;", "-"], { input: bytes, encoding: "utf8" });
                expect(original.status, original.stderr).toBe(0);
                const frames = original.stdout.split(";").filter(Boolean);
                expect(frames).toHaveLength(4);
                expect(inspected.stdout).toBe(expected.map(index => frames[index] + ";").join(""));
            }
        });
    }
}
