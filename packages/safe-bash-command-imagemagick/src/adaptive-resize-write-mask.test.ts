import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i % 2 * 255))]);
// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 outputs.
const cases = [
    { patterned: false, selection: "write-mask", geometry: "4x3!", clear: false, length: 36, hash: "bd698f60bd6492bd5c57f1c654945bf0a31fcd55d59c4752d6b0cc912b8ab10d" },
    { patterned: false, selection: "region", geometry: "4x3!", clear: false, length: 36, hash: "f7c26e47204d4867c1ce787ec6efe41cc3ac1a1d8a24361c3efd652c80722459" },
    { patterned: false, selection: "write-mask", geometry: "7x6!", clear: false, length: 126, hash: "d3086831ef064e8731aeafd1459d2cd676911ce4d2b6bfab3edd91ab2ee13e5e" },
    { patterned: false, selection: "write-mask", geometry: "4x3!", clear: true, length: 36, hash: "c38236f1e6d5ba2e8616b0c8a115bf8bf0814ddae740ac6cbea93d063417cd0e" },
    { patterned: false, selection: "region", geometry: "4x3!", clear: true, length: 36, hash: "c38236f1e6d5ba2e8616b0c8a115bf8bf0814ddae740ac6cbea93d063417cd0e" },
    { patterned: false, selection: "write-mask", geometry: "5x4!", clear: false, length: 60, hash: "3ac578ab43aa3117284a265bf0ed160eb92c8360290d2a961e8618b379147627" },
    { patterned: true, selection: "write-mask", geometry: "4x3!", clear: false, length: 36, hash: "f3fdc20a4d937c80d44eb5b689a19da9a9696f472368b4740d9f1402e55d573b" },
    { patterned: true, selection: "write-mask", geometry: "7x6!", clear: false, length: 126, hash: "5bb9040a0da923095f6c67786c980cd163d61b737a2b188803e60ee9fde7cdce" },
    { patterned: true, selection: "region", geometry: "4x3!", clear: false, length: 36, hash: "7c7bf4cd1d34845a5e36b12379871bc2e2ed40c6010095070b75c321bf0acf35" },
    { patterned: true, selection: "region", geometry: "7x6!", clear: false, length: 126, hash: "8b475318a31fee63f9f62a790095fc39063af9f5e8b9dfc6bf48df6a88ab84aa" },
];

for (const mode of ["public", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: adaptive resize $selection $geometry clear=$clear patterned=$patterned`, async ({ patterned, selection, geometry, clear, length, hash }) => {
        const files = new Map([["/im.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", ...(patterned ? [] : ["-fill", "black", "-colorize", "100%"]),
            `-${selection}`, selection === "region" ? "2x2+1+0" : "/mask.pgm", "-adaptive-resize", geometry,
            ...(clear ? [`+${selection}`] : []), "-fill", "white", "-colorize", "100%", `+${selection}`, "-depth", "8", "rgb:/out"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
