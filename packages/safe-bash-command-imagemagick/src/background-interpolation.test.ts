import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const opaque = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=";
const translucent = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC";

// SHA-256 of decoded PNG32 8-bit RGBA pixels from ImageMagick 7.1.2-35 Q16-HDRI.
// Background interpolation falls through to bilinear, including alpha weighting.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const method of ["background", "bilinear"])
it.each([
    [opaque, "-swirl", "105", 7, "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b"],
    [translucent, "-implode", "1.25", 7, "8d5660580f7802072ad7b5289179be577e926dd8b99e810bb2e525a5e4878fa7"],
    [opaque, "-wave", "2x8", 11, "2b460165d6bea062e0486b82c1d0a3f0c06cdf3280f41b5eb906baa1df30cf40"],
] as const)(`${mode}: ${method} matches native warp pixels (case %#)`, async (input, operation, value, height, hash) => {
    const files = new Map([["/input.png", Buffer.from(input, "base64")], ["/out.png", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
    const args = ["/input.png", "-interpolate", method, operation, value, "PNG32:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result, stderr).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([9, height]);
    expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
});
