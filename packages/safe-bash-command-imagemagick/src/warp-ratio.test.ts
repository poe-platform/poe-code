import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 9x7 RGB fixture, PNG32 output decoded as RGBA8.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "convert", "retained", "buffered", "sync"] as const) {
    for (const [option, height, hash] of [
        ["-swirl", 7, "98526fccb36f4ac3c0046a411402c4e1316fe4e334812d0d14eb4349220127fe"],
        ["-implode", 7, "37d987ca37e896fff35d9207b9c0284cdf728b34e8c9953c1863a337d5f047b0"],
        ["-wave", 8, "c622d83ca1056ee040416e7d255c91dba4806ee94d5157b6a8a63999e0e13c09"]
    ] as const) {
        it.each(["3:4", "0.75", "%[option:ratio]"])(`${mode}: ${option} %s matches native ratio pixels`, async geometry => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.png", input], ["/out.png", original]]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const argv = ["/in.png", "-set", "option:ratio", "3:4", option, geometry, "PNG32:/out.png"];
            let stdout = "", stderr = "";
            const result = mode === "command" || mode === "convert" ? {
                ...await (mode === "command" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode === "command" ? "magick" : "convert",
                    args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr
            } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
            const output = decodeImage(mode === "buffered" || mode === "sync"
                ? files.get("/out.png")! : await fs.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([9, height]);
            expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
        });
    }
}
