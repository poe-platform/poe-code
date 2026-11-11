import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Full RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI for a 3x2 PPM.
const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => 20 + i * 10))]);
const cases = [
    { operations: ["-roll", "+0+0", "-flop", "+region"], rgb: "505a64323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-flip", "+region"], rgb: "6e7882323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-transpose", "+region"], rgb: "141e28323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-transverse", "+region"], rgb: "aab4be323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-rotate", "180", "+region"], rgb: "aab4be323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-flop", "+region"], rgb: "505a64323c46505a646e78828c96a0aab4be" },
    { operations: ["-flop", "+region"], rgb: "505a64323c46141e28aab4be8c96a06e7882" },
    { operations: ["-roll", "+0+0", "+region"], rgb: "141e28323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "+region", "-flop"], rgb: "505a64323c46141e28aab4be8c96a06e7882" },
    { operations: ["-roll", "+0+0", "-flop", "-negate", "+region"], rgb: "505a64323c46afa59b6e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-flip", "-negate", "+region"], rgb: "6e7882323c46505a6491877d8c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-transpose", "-negate", "+region"], rgb: "ebe1d7323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-transverse", "-negate", "+region"], rgb: "aab4be323c46505a646e78828c96a0554b41" },
    { operations: ["-roll", "+0+0", "-rotate", "180", "-negate", "+region"], rgb: "aab4be323c46505a646e78828c96a0554b41" },
    { operations: ["-roll", "+1+1", "-flop", "-negate", "+region"], rgb: "505a64323c46505a646e788273695faab4be" },
    { operations: ["-roll", "+1+1", "-flip", "-negate", "+region"], rgb: "6e7882cdc3b9505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-transpose", "-negate", "+region"], rgb: "aab4be323c46505a6491877d8c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-transverse", "-negate", "+region"], rgb: "aab4be323c46afa59b6e78828c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-rotate", "180", "-negate", "+region"], rgb: "aab4becdc3b9505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-negate", "-flop", "+region"], rgb: "505a64323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+0+0", "-flop", "-flop", "+region"], rgb: "505a64323c46505a646e78828c96a0aab4be" },
    { operations: ["-roll", "+1+1", "-flop", "-negate", "-flop", "+region"], rgb: "505a64323c46505a646e788273695faab4be" },
    { operations: ["-roll", "+1+1", "-negate", "-rotate", "0", "+region"], rgb: "aab4be323c46505a646e788273695faab4be" },
    { operations: ["-roll", "+1+1", "-crop", "2x2+0+0", "-flop", "+region"], rgb: "323c46aab4be8c96a06e7882", geometry: "2,2,3x2+1+0" },
    { operations: ["-roll", "+1+1", "-resize", "6x4!", "-flop", "+region"], rgb: "515b6547515b37414b505a648d97a1aab4be67717b5e687266707a48525c87919b9ba5af949ea8929ca6949ea88c96a0808a947d8791aeb8c2a6b0baadb7c18c96a0737d876c7680", geometry: "6,4,6x4+0+0" },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each(cases)(`preserves the region after roll in ${mode}: $operations`, async ({ operations, rgb, geometry: expectedGeometry }) => {
        const files = new Map<string, Uint8Array>([["/input.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.ppm", input);
        const args = ["/input.ppm", "-region", "1x1+0+0", ...operations, "-format", "%w,%h,%g", "-write", "info:/geometry.txt", "-depth", "8", "rgb:/output.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" || mode === "sync" ? files.get("/output.rgb")! : await fs.readFile("/output.rgb");
        expect(Buffer.from(output).toString("hex")).toBe(rgb);
        const geometry = mode === "buffered" || mode === "sync" ? files.get("/geometry.txt")! : await fs.readFile("/geometry.txt");
        expect(new TextDecoder().decode(geometry)).toBe(expectedGeometry ?? (operations.includes("-transverse") ? "2,3,3x2+1-1" : operations.includes("-transpose") ? "2,3,3x2+0+0" : "3,2,3x2+0+0"));
    });
}
