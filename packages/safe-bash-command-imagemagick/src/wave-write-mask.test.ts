import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const mask = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAAAAAD/8Di8AAAAHElEQVR4nGNggAFGBob/DAyMDAwMTHAxBAs/AAA6MwEGXzAFcwAAAABJRU5ErkJggg==", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI: in.png [-write-mask mask.png] -wave 2x8 PNG32:out.png.
// Hashes cover decoded RGBA8 pixels, including hidden RGB under transparent alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { masked: true, hash: "77ea7f5b457df6592817500d8ee284afd38122e2d9684dd783165398caffd3b6", alpha: 0 },
        { masked: false, hash: "2b460165d6bea062e0486b82c1d0a3f0c06cdf3280f41b5eb906baa1df30cf40", alpha: 255 },
    ])(`${mode}: preserves native wave alpha with write mask=$masked`, async ({ masked, hash, alpha }) => {
        const files = new Map<string, Uint8Array>([["/in.png", input], ["/mask.png", mask], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = ["/in.png", ...(masked ? ["-write-mask", "/mask.png"] : []), "-wave", "2x8", "PNG32:/out.png"];
        const commandArgs = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: commandArgs.args, argumentValues: commandArgs,
            fs: filesystem, cwd: "/", env: {}, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, 11]);
        expect([...output.data.slice(0, 4)]).toEqual([255, 255, 255, alpha]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
