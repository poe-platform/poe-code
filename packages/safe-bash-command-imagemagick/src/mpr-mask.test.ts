import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI outputs for these exact PPM/PGM bytes.
const input = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from(Array.from({ length: 24 }, (_, i) => i * 10))]);
const mask = Buffer.concat([Buffer.from("P5\n4 2\n255\n"), Buffer.from([0, 255, 255, 0, 255, 0, 0, 255])]);
const saveMask = ["mask.pgm", "-write", "mpr:mask", "+delete"];
const negated = "fff5ebff1e2832ff3c4650ffa59b91ff78828cff695f55ff4b4137ffd2dce6ff";
const cases = [
    { name: "register write mask", args: [...saveMask, "in.ppm", "-write-mask", "mpr:mask", "-negate", "+write-mask"], output: "PNG32:out", expected: negated },
    { name: "register clip mask alias", args: [...saveMask, "in.ppm", "-clip-mask", "mpr:mask", "-negate", "+clip-mask"], output: "PNG32:out", expected: negated },
    { name: "register read mask", args: [...saveMask, "in.ppm", "-read-mask", "mpr:mask", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.117647" },
    { name: "file write mask control", args: ["in.ppm", "-write-mask", "mask.pgm", "-negate", "+write-mask"], output: "PNG32:out", expected: negated },
    { name: "file read mask control", args: ["in.ppm", "-read-mask", "mask.pgm", "-format", "%[fx:minima.r]"], output: "info:out", expected: "0.117647" },
    { name: "register image control", args: [...saveMask, "mpr:mask"], output: "PNG32:out", expected: "000000ffffffffffffffffff000000ffffffffff000000ff000000ffffffffff" },
    ...["read-mask", "write-mask", "clip-mask"].map(option => ({
        name: `missing register ${option}`, args: ["in.ppm", `-${option}`, "mpr:missing"], output: "PNG32:out", expected: "KEEP",
    })),
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native mask register behavior: $name, ${mode}`, async ({ args, output, expected }) => {
        const files = new Map([["in.ppm", input], ["mask.pgm", mask], ["out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const argv = [...args, output];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const error = "stderr" in result ? result.stderr : stderr;
        const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        if (expected === "KEEP") {
            expect(result.exitCode).toBe(1);
            expect(error).toContain("mpr:missing");
            expect(new TextDecoder().decode(bytes)).toBe("KEEP");
        } else {
            expect(result.exitCode).toBe(0);
            expect(error).toBe("");
            if (output === "info:out") expect(new TextDecoder().decode(bytes)).toBe(expected);
            else {
                const image = decodeImage(bytes);
                expect([image.width, image.height]).toEqual([4, 2]);
                expect(Buffer.from(image.data).toString("hex")).toBe(expected);
            }
        }
        expect("stdout" in result ? result.stdout : stdout).toBe("");
    });
}
