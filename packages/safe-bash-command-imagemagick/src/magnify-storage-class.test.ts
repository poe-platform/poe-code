import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const input = Buffer.concat([
    Buffer.from("P6\n3 3\n255\n"),
    Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(index => colors[index]).join(""), "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI references, including the original controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { operations: ["+dither", "-colors", "3", "-magnify"], expected: "6x6,6x6+0+0,DirectClass sRGB " },
        { operations: ["+dither", "-colors", "3"], expected: "3x3,3x3+0+0,PseudoClass sRGB " },
        { operations: ["-magnify"], expected: "6x6,6x6+0+0,DirectClass sRGB " },
        { operations: ["+dither", "-colors", "3", "-magnify", "-depth", "8"], expected: undefined },
    ])(`preserves native magnification output for $operations (${mode})`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", ...operations, ...(expected === undefined ? ["rgb:/out"] : ["-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"])];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        if (expected === undefined) {
            expect(output).toHaveLength(108);
            expect(createHash("sha256").update(output).digest("hex")).toBe("4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a");
        } else {
            expect(new TextDecoder().decode(output)).toBe(expected);
        }
    });
}
