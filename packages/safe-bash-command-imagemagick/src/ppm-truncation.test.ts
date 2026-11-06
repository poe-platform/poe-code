import { expect, it } from "vitest";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const maxval of [255, 65535]) {
    const header = Buffer.from(`P6\n2 1\n${maxval}\n`);
    const raster = maxval === 255 ? Buffer.from([255, 0, 0, 0, 255, 0]) : Buffer.from([255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0]);
    for (const length of [0, raster.length / 2, raster.length - 1]) {
        for (const existing of [false, true]) {
            it(`rejects P6 max=${maxval} with ${length} raster bytes, existing=${existing}`, async () => {
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.dat", Buffer.concat([header, raster.subarray(0, length)]));
                if (existing) await fs.writeFile("/out.png", Buffer.from("original"));
                const args = createCommandArguments(["in.dat", "out.png"]);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect(result.exitCode).toBe(1);
                expect(stderr).toContain("Truncated PPM raster");
                if (existing) expect(new TextDecoder().decode(await fs.readFile("/out.png"))).toBe("original");
                expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(existing ? ["in.dat", "out.png"] : ["in.dat"]);
            });
        }
    }
}

it.each([9, 10, 13, 32, 35])("preserves a complete P6 raster beginning with byte %i", async first => {
    const bytes = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([first, 0, 0, 0, 255, 0])]);
    const expected = [first, 0, 0, 255, 0, 255, 0, 255];
    expect(Array.from(decodeImage(bytes).data)).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.dat", bytes);
    expect((await runMagickCli(["in.dat", "out.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    expect(Array.from(decodeImage(await fs.readFile("/out.png")).data)).toEqual(expected);
});
