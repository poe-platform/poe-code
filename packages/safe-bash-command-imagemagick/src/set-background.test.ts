import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB output.
const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Uint8Array.from({ length: 36 }, (_, i) => i)]);
const operations = [
    { operation: "-splice", geometry: "1x1+0+0", length: 60,
        white: "72311cc505f01a0c6652262ec016d4672ff38db89fb4a72c180f15a1b4086217",
        orange: "2512abdd0643d4a1fa4668ebd7159cd33df2794c5bcfd3d3cce5e61cafbf452d" },
    { operation: "-extent", geometry: "6x5+0+0", length: 90,
        white: "93bd9d77488a9a1fcd4902b27a257a552963549857766b890d3cd25eeb6590d4",
        orange: "c41913cf7a765341ac29865ab9c97ebf2cc87d5870fdbe715d50f7158d697935" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const { operation, geometry, length, white, orange } of operations) {
        it.each([
            { name: "default", inputs: ["in.ppm"], hashes: [white] },
            { name: "explicit", inputs: ["in.ppm", "-background", "orange"], hashes: [orange] },
            { name: "image property", inputs: ["in.ppm", "-set", "background", "orange"], hashes: [orange] },
            { name: "option property", inputs: ["in.ppm", "-set", "option:background", "orange"], hashes: [orange] },
            { name: "option before read", inputs: ["-set", "option:background", "orange", "in.ppm"], hashes: [orange] },
            { name: "image property scope", inputs: ["in.ppm", "-set", "background", "orange", "in.ppm"], hashes: [orange, white] },
            { name: "option property scope", inputs: ["in.ppm", "-set", "option:background", "orange", "in.ppm"], hashes: [orange, orange] },
            { name: "explicit setting precedence", inputs: ["in.ppm", "-background", "white", "-set", "background", "orange"], hashes: [white] },
            { name: "option reset", inputs: ["in.ppm", "-set", "option:background", "orange", "+background", "in.ppm"], hashes: [orange, white] },
            { name: "expanded property", inputs: ["in.ppm", "-set", "color", "orange", "-set", "background", "%[color]"], hashes: [orange] },
            { name: "expanded option", inputs: ["in.ppm", "-set", "color", "orange", "-set", "option:background", "%[color]"], hashes: [orange] }
        ])(`${mode}: ${operation} uses $name background`, async ({ inputs, hashes }) => {
            const files = new Map([["in.ppm", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const args = [...inputs, operation, geometry, "-depth", "8", "rgb:out"];
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
            expect(output.length).toBe(length * hashes.length);
            expect(hashes.map((_, index) => createHash("sha256").update(output.subarray(index * length, (index + 1) * length)).digest("hex"))).toEqual(hashes);
        });
    }
}
