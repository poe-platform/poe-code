import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const alpha = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAb0lEQVR4nI2MsQmAMBREo9icC1xlfeWvLdwgmcEdskN2yA7ZITs4ja1NCKIgFsfdweMNzhVnYd2+MgkrBU9hb+0p+M1Q+m/Qfkui9T1TOPgwRVqIFE4KhcJC4eD4hIREITeovk2G8wZlCpWG/M90AT6gMPRY2FjQAAAAAElFTkSuQmCC";
const opaque = "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=";

// Native ImageMagick 7.1.2-35 Q16-HDRI, SHA-256 of decoded 8-bit RGBA.
const cases = [
    { input: alpha, args: ["-channel", "R", "-swirl", "105"], height: 7, hash: "b19fb0eb716bd5f9d6680a9ef7af99c6d97d8c370903f89869965e41716762d3" },
    { input: alpha, args: ["-channel", "A", "-swirl", "105"], height: 7, hash: "2dd1634acb60f922dd51836f84ee6750ce67015aaae185aa05a39e873daba967" },
    { input: alpha, args: ["-channel", "R", "-implode", "1.25"], height: 7, hash: "a8f2b6dc85c58c268e209dc556d3048a87cfe6c1dfc6102091a14647b558d1b4" },
    { input: alpha, args: ["-channel", "R", "-wave", "2x8"], height: 11, hash: "6ef3e176254f9beb69cc7939d5433263f26e66d8a3deb8aa1612a6210cd42a59" },
    { input: alpha, args: ["-swirl", "105"], height: 7, hash: "d6dcba154e2f84400a8d2ee4d86155a111e4987f31cfa668afbc872c4baf1cd1" },
    { input: opaque, args: ["-channel", "R", "-swirl", "105"], height: 7, hash: "be5bde33802b682f93c9ef08b96c69b1a81685488dce9b45b2ee31c72c96827b" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native channel interpolation for $args`, async fixture => {
        const files = new Map([["/input.png", Buffer.from(fixture.input, "base64")], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", ...fixture.args, "PNG32:/out.png"];
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
