import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode("P3\n3 2\n255\n255 0 0 0 255 0 0 0 255\n255 255 0 0 255 255 255 0 255\n");
const points = "0,0 0,0 2,0 2,0 0,1 0,1 2,1 3,1";
const translation = "0,0 1,0 2,0 3,0 0,1 1,1 2,1 3,1";

// Geometry and RGB bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "reverse nonrectangular mapping", operator: "-distort", method: "BilinearReverse", points, expected: "ea000040bf00006a95bfbf00bfff4040ffbf" },
        { name: "reverse mapping with +distort", operator: "+distort", method: "BilinearReverse", points, expected: "ea000040bf00006a95bfbf00bfff4040ffbf" },
        { name: "default filtered mapping", filter: "Robidoux", operator: "-distort", method: "BilinearReverse", points, expected: "e5120047bc0b00779acdb400b9ef3943f897" },
        { name: "translation", operator: "-distort", method: "BilinearReverse", points: translation, expected: "000000ff000000ff00000000ffff0000ffff" },
        { name: "affine control", operator: "-distort", method: "AffineProjection", points: "1,0,0,1,1,0", expected: "000000ff000000ff00000000ffff0000ffff" },
        { name: "all five point pairs", operator: "-distort", method: "BilinearReverse", points: points + " 1,1 1,1", expected: "fa000032cd0000609ff1f10096ff6920ffdf" },
        ...[1, 2, 3].map(count => ({ name: `${count}-pair affine fallback`, operator: "-distort", method: "BilinearReverse", points: translation.split(" ").slice(0, count * 2).join(" "), expected: "000000ff000000ff00000000ffff0000ffff" })),
    ])(`matches native $name (${mode})`, async testCase => {
        const { operator, method, points: controls, expected } = testCase;
        const filter = "filter" in testCase ? testCase.filter : "point";
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input]]);
        await fs.writeFile("/in.ppm", input);
        const args = ["/in.ppm", "-virtual-pixel", "black", "-filter", filter, operator, method, controls, "-format", "%wx%h %g;", "-write", "info:", "-depth", "8", "rgb:/out"];
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "3x2 3x2+0+0;", stderr: "" });
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

it.each([
    [points + " 1", "requires at least 4 CPs"],
    ["0,0 0,0 1,1 1,1 2,2 2,2 3,3 3,3", "Unsolvable Matrix"],
    ["0,0 0", "complete source/destination point pairs"],
    [points + " z", "invalid list of numbers"],
])("rejects invalid reverse controls without replacing the destination: %s", async (controls, diagnostic) => {
    for (const retained of [false, true]) for (const operator of ["-distort", "+distort"]) {
        const original = new TextEncoder().encode("KEEP");
        const fs = new MemoryFileSystem(), files = new Map([["/in.ppm", input], ["/out.png", original]]);
        await fs.writeFile("/in.ppm", input);
        await fs.writeFile("/out.png", original);
        const result = await runMagickCli(["/in.ppm", operator, "BilinearReverse", controls!, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(diagnostic);
        expect(retained ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    }
});
