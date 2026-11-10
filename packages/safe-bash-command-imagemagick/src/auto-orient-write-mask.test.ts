import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n4 3\n255\n"), Buffer.from(Array.from({ length: 36 }, (_, i) => i * 7))]);
const mask = Buffer.concat([Buffer.from("P5\n4 3\n255\n"), Buffer.from("00ff00000000000000000000", "hex")]);
// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 outputs.
const cases = [
    { orientation: "RightTop", negate: true, hex: "57afb6ab5b62ff070e42c4cb967077151c232dd9e081858cd5313818eef56c9aa1c0464d" },
    { orientation: "TopRight", negate: true, hex: "c0464dd53138151c23ff070e6c9aa181858c967077ab5b6218eef52dd9e042c4cb57afb6" },
    { orientation: "RightTop", hex: "a8afb6545b6200070ebdc4cb697077151c23d2d9e07e858c2a3138e7eef5939aa13f464d" },
    { orientation: "TopRight", hex: "3f464d2a3138151c2300070e939aa17e858c697077545b62e7eef5d2d9e0bdc4cba8afb6" },
    { orientation: "RightTop", negate: true, unmasked: true, hex: "57afb6ab5b62ff070e42c4cb967077ea1c232dd9e081858cd5313818eef56c9aa1c0464d" },
    { roll: "+2-1", negate: true, hex: "81858cea1c23ab5b629670772dd9e018eef557afb642c4cbd53138c0464dff070e151c23" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: transforms write mask ($orientation, $roll, negate=$negate, unmasked=$unmasked)`, async ({ orientation, roll, negate, unmasked, hex }) => {
        const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = ["/in.ppm", ...(unmasked ? [] : ["-write-mask", "/mask.pgm"]),
            ...(roll ? ["-roll", roll] : ["-orient", orientation!, "-auto-orient"]),
            ...(negate ? ["-channel", "R", "-negate", "+channel"] : []),
            "+write-mask", "-depth", "8", "rgb:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
