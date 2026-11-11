import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI; SHA-256 of decoded 8-bit RGBA, not PNG bytes.
const opaque = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const translucent = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC", "base64");
const fixtures = [
    { input: opaque, args: ["-interpolate", "spline", "-swirl", "105"], height: 7, hash: "c9c279c59e4931f75c4885c839ef20dd834a51a6c22f17c194bfc04d6453035a" },
    { input: translucent, args: ["-interpolate", "spline", "-implode", "1.25"], height: 7, hash: "068619193d14cfe20678b91d78b161835461087deb43ec3e256d8e112cb464f2" },
    { input: opaque, args: ["-interpolate", "spline", "-wave", "2x8"], height: 11, hash: "89e576184f877548d92f71119da778159f91d54afa0725176506fd8083e882ff" },
    { input: opaque, args: ["-interpolate", "bilinear", "-swirl", "105"], height: 7, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" },
    { input: opaque, args: ["-interpolate", "spline", "+interpolate", "-swirl", "105"], height: 7, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: matches native pixels for $args`, async ({ input, args, height, hash }) => {
        const files = new Map([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const argv = ["/in.png", ...args, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, height]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}

for (const retained of [false, true]) {
    it.each([
        ["-kuwahara", "2x1"]
    ])(`rejects unsupported spline callers without replacing output, retained=${retained}: %j`, async (...operation) => {
        const original = new TextEncoder().encode("KEEP"), files = new Map<string, Uint8Array>([["/in.png", opaque], ["/out.png", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const result = await runConvertCli(["/in.png", "-interpolate", "spline", ...operation, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("interpolation: spline");
        expect(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")).toEqual(original);
    });
}
