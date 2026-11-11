import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "command"] as const) {
    for (const coder of ["label", "caption"]) {
        it.each([
            ["NorthWest", 0, 12], ["North", 0, 12], ["NorthEast", 0, 12],
            ["West", 24, 39], ["Center", 24, 39], ["East", 24, 39],
            ["SouthWest", 50, 63], ["South", 50, 63], ["SouthEast", 50, 63],
        ] as const)(`${mode}: ${coder} positions %s text vertically`, async (gravity, first, last) => {
            const argv = ["-pointsize", "12", "-size", "35x64", "-gravity", gravity, `${coder}:Hi`, "-depth", "8", "rgb:out"];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const result = mode === "buffered" ? runMagickCliSync(argv, files) : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            });
            expect(result.exitCode).toBe(0);
            const output = mode === "buffered" ? files.get("out")! : await fs.readFile("/out");
            expect(output.length).toBe(35 * 64 * 3);
            const rows = Array.from({ length: 64 }, (_, row) => row)
                .filter(row => output.subarray(row * 35 * 3, (row + 1) * 35 * 3).some(value => value < 255));
            expect(rows.length).toBeGreaterThan(0);
            expect(rows[0]).toBeGreaterThanOrEqual(first);
            expect(rows.at(-1)).toBeLessThanOrEqual(last);
        });
    }
}
