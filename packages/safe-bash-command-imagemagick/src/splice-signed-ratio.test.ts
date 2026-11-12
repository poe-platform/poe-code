import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => (17 * i + 3) % 256))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "+1:1", columns: 3, rows: 3, offset: 1, hash: "413a4d758f663b4176d8b730fe465037df2d7b9cfc1f35721416b8a0c3b33882" },
        { geometry: "+1:2", columns: 2, rows: 3, offset: 1, hash: "92f418376bcd92074482d91c5320e88422bdae64140396a04951576e9a76ce75" },
        { geometry: "+2:1", columns: 4, rows: 2, offset: 2, hash: "a9fcb10f3b0f1d70872366cff74488b431261d94b85c7c3c414bfd4f0f75533a" },
        { geometry: "+1.8:1", columns: 4, rows: 2, offset: 1, hash: "47bddc13be403cbc53d6a8e73d77affef7bb429568ef2cb3124b839becbce589" },
        { geometry: "+1e0:2", columns: 2, rows: 3, offset: 1, hash: "92f418376bcd92074482d91c5320e88422bdae64140396a04951576e9a76ce75" },
        { geometry: "1:1", columns: 3, rows: 3, offset: 0 },
        { geometry: "1:2", columns: 2, rows: 3, offset: 0 },
        { geometry: "1:1+1+0", columns: 3, rows: 3, offset: 1 },
        { geometry: "1:2+1+0", columns: 2, rows: 3, offset: 1 },
    ])(`preserves splice ratio offsets for $geometry (${mode})`, async ({ geometry, columns, rows, offset, hash }) => {
        const files = new Map([["in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["in.ppm", "-splice", geometry, "-depth", "8", "rgb:out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        const expected: number[] = [];
        for (let y = 0; y < 3 + rows; y++) for (let x = 0; x < 4 + columns; x++) {
            if (y < rows || x >= offset && x < offset + columns) expected.push(255, 255, 255);
            else {
                const pixel = ((y - rows) * 4 + (x < offset ? x : x - columns)) * 3;
                expected.push(...input.subarray(input.length - 36 + pixel, input.length - 36 + pixel + 3));
            }
        }
        // Native ImageMagick 7.1.2-35 Q16-HDRI hashes also pin the reported examples.
        if (hash) expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        expect(output).toEqual(Uint8Array.from(expected));
    });
}
