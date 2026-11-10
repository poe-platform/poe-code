import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const opaque = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=";
const translucent = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC";

// ImageMagick 7.1.2-35 Q16-HDRI decoded 8-bit RGBA reference hashes.
const cases = [
    { input: opaque, method: "catrom", operation: "-swirl", value: "105", height: 7, hash: "6cdc719642b526e296c6868c4f49f9b5263f5e4d4996d329423a2bc3a8fb4144" },
    { input: translucent, method: "catrom", operation: "-implode", value: "1.25", height: 7, hash: "f125f7d2143b6fbb7d80b206d8dbfd54da4a3c8cfe8ae0b82d09fbe869e93911" },
    { input: opaque, method: "catrom", operation: "-wave", value: "2x8", height: 11, hash: "71eba74944ccb2e7d26387472085427680124ca2c677bba1dfd64d97c3058952" },
    { input: opaque, method: "bilinear", operation: "-swirl", value: "105", height: 7, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native $method $operation pixels`, async fixture => {
        const files = new Map([["/in.png", Buffer.from(fixture.input, "base64")], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.png", "-interpolate", fixture.method, fixture.operation, fixture.value, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const actual = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([actual.width, actual.height]).toEqual([9, fixture.height]);
        expect(createHash("sha256").update(actual.data).digest("hex")).toBe(fixture.hash);
    });
}

for (const retained of [false, true]) {
    it.each([
        ["-fx", "p{0.5,0.5}"], ["-kuwahara", "2x1"],
        ["/in.png", "-clut"], ["-interpolative-resize", "5x5!"],
        ["-filter", "point", "-rotate", "30"],
    ])(`rejects unsupported Catrom consumers without replacing output, retained=${retained}: %j`, async (...operation) => {
        const existing = Buffer.from("KEEP"), files = new Map([["/in.png", Buffer.from(opaque, "base64")], ["/out.png", existing]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const result = await runConvertCli(["/in.png", "-interpolate", "catrom", ...operation, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("interpolation: catrom");
        expect(Buffer.from(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!)).toEqual(existing);
    });
}
