import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");

// SHA-256 of decoded 8-bit RGBA from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "command", "mogrify"] as const)
for (const [option, geometries, height, hash] of [
    ["-wave", ["3/7", "3,7", "3x7", "%[fx:w-6]/7", "%[fx:w-6],7"], 13, "3dbfe9a0508b4637848e8d507b2abff03eefe6b277fe322195f1c80a6eb63f1f"],
    ["-wave", ["3"], 13, "5db76ae9ee179bf9026fd279c15eaef0adb07e75418e92ee7be1adfa767cecb3"],
    ["-swirl", ["3/7", "3,7", "3"], 7, "7e2964b9cd5064ced1650bf1e78cce6dda05c6f38cb5ce5048ef31917a86f7e5"],
    ["-implode", ["3/7", "3,7", "3"], 7, "f7bd18bab16632de4ff580b40f305ce1b28c18061176a73e22019d5af7f83e9f"]
] as const) {
    it.each(geometries)(`${mode}: ${option} %s matches native geometry`, async (geometry) => {
        const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const argv = mode === "mogrify" ? ["mogrify", option, geometry, "/input.png"]
            : ["/input.png", option, geometry, "PNG32:/out.png"];
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : mode === "retained" ? await runConvertCli(argv, { filesystem, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} }
            });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "sync" || mode === "buffered" ? files.get("/out.png")!
            : await filesystem.readFile(mode === "mogrify" ? "/input.png" : "/out.png"));
        expect([output.width, output.height]).toEqual([9, height]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
