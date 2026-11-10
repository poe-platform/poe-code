import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: offsets preserve the default rectangle height.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["info", "rgb"]) {
        it.each([
            { geometry: "2x+1+1", rows: 4, offset: 1 },
            { geometry: "2x4+1+1", rows: 4, offset: 1 },
            { geometry: "2x0+1+1", rows: 0, offset: 1 },
            { geometry: "2x", rows: 0, offset: 0 },
        ])(`preserves omitted splice height (${mode}, ${format}): $geometry`, async ({ geometry, rows, offset }) => {
            const input = Uint8Array.from(Array.from({ length: 24 }, (_, i) => [i + 1, 50, 123]).flat());
            const files = new Map([["/in.rgb", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.rgb", input);
            const argv = ["-size", "6x4", "-depth", "8", "rgb:/in.rgb", "-gravity", "NorthWest",
                "-splice", geometry, "-depth", "8", "-format", "%wx%h|%g", `${format}:/out`];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe(`8x${4 + rows}|8x${4 + rows}+0+0`);
            } else {
                const expected = [];
                for (let y = 0; y < 4 + rows; y++) {
                    for (let x = 0; x < 8; x++) {
                        if ((x >= offset && x < offset + 2) || (y >= offset && y < offset + rows)) {
                            expected.push(255, 255, 255);
                        } else {
                            const source = ((y < offset ? y : y - rows) * 6 + (x < offset ? x : x - 2)) * 3;
                            expected.push(...input.subarray(source, source + 3));
                        }
                    }
                }
                expect(output).toEqual(Uint8Array.from(expected));
                if (rows === 4) expect(createHash("sha256").update(output).digest("hex"))
                    .toBe("5977f9ac2442be5c4a5e83f504f19ad8ab99f01d9581ea85593bc018917bb0dc");
            }
        });
    }
}
