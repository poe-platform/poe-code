import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { warpPixelSteps } from "./warp-kernel.js";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const alpha = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded as row-major RGBA8.
for (const mode of ["command", "convert", "retained", "buffered", "sync"] as const) {
    it.each([
        ["blend", input, "-swirl", "105", 7, "7fc34251d4cf39da6d8a1f89191883e13a33420cf45328e7e25f3f0633f13075"],
        ["blend", alpha, "-implode", "1.25", 7, "b4aa774c2f89cc8bd40293adfd0053765f6198bd9216d091dbb208e650c30569"],
        ["blend", input, "-wave", "2x8", 11, "790790cf3e14aebaac73aadcfa26905673cf7030557a1c040f0328118233d903"],
        ["bilinear", input, "-swirl", "105", 7, "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b"]
    ] as const)(`${mode}: matches native blend interpolation %#`, async (method, source, option, geometry, height, hash) => {
        const files = new Map([["/in.png", source], ["/out.png", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(name, bytes);
        const argv = ["/in.png", "-interpolate", method, option, geometry, "PNG32:/out.png"];
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

for (const retained of [false, true]) {
    it.each([
        ["-fx", "p{0.5,0.5}"],
        ["-kuwahara", "1x1"],
        ["-interpolative-resize", "5x4!"]
    ])(`rejects unsupported blend sampling in %s without replacing output, retained=${retained}`, async (...operation) => {
        const original = Buffer.from("KEEP"), files = new Map([["/in.png", input], ["/out.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const result = await runConvertCli(["/in.png", "-interpolate", "blend", ...operation, "PNG32:/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(Buffer.from(retained ? await fs.readFile("/out.png") : files.get("/out.png")!)).toEqual(original);
    });
}

// Native BlendInterpolatePixel includes the lower quarter boundary, excludes
// the upper one, alpha-weights RGB, and averages alpha by neighbor count.
for (const depth of [8, 16]) {
    it.each([
        [0.25, 0.25, [210, 0, 0, 255], [53970, 0, 0, 65535]],
        [0.2501, 0.25, [158, 53, 0, 170], [40478, 13493, 0, 43690]],
        [0.7499, 0.25, [158, 53, 0, 170], [40478, 13493, 0, 43690]],
        [0.75, 0.25, [0, 210, 0, 85], [0, 53970, 0, 21845]],
        [0.25, 0.2501, [210, 0, 0, 128], [53970, 0, 0, 32768]],
        [0.25, 0.75, [0, 0, 0, 0], [0, 0, 0, 0]],
        [0.5, 0.5, [180, 120, 90, 149], [46260, 30840, 23130, 38229]]
    ] as const)(`honors blend boundaries at %s,%s with ${depth}-bit alpha`, (x, y, expected8, expected16) => {
        const values = [210, 0, 0, 255, 0, 210, 0, 85, 0, 0, 210, 0, 210, 210, 210, 255];
        const data = depth === 16 ? Uint16Array.from(values, value => value * 257) : Uint8Array.from(values);
        const steps = warpPixelSteps({ width: 2, height: 2, hasAlpha: true, ...(depth === 16 ? { data16: data as Uint16Array } : {}) }, {
            width: 1, height: 1, hasAlpha: true, interpolation: "blend", map: () => [x, y]
        }, { r: 0, g: 0, b: 0, a: 0 }, "edge");
        let next = steps.next(), output: number[] | undefined;
        while (!next.done) {
            const request = next.value;
            if (request?.kind === "read") {
                const chunk = data.slice(request.position, request.position + request.length);
                next = steps.next(new Uint8Array(chunk.buffer));
            } else {
                if (request?.kind === "write" && !request.evaluate)
                    output = Array.from(depth === 16 ? new Uint16Array(request.data.slice().buffer) : request.data);
                next = steps.next();
            }
        }
        expect(output).toEqual(depth === 16 ? expected16 : expected8);
    });
}
