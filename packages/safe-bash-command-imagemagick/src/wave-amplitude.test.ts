import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG32 output decoded as 8-bit RGBA.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const standaloneHash = "082bbfc2fff28169b8da9e62e51dc0f603c256272058c15c9cdf91c6f0ab19b3";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["+2", standaloneHash], ["-2", standaloneHash],
        ["2@", standaloneHash], ["2#", standaloneHash], ["2", standaloneHash],
        ["-2x8", "4eb9ab2ae078b9bd6cf3732cbebd9c024df132716b1d1fcda7c76cbcabe7d713"],
        ["2x8@", "2b460165d6bea062e0486b82c1d0a3f0c06cdf3280f41b5eb906baa1df30cf40"],
    ])(`${mode}: preserves wave amplitude %s`, async (geometry, hash) => {
        const files = new Map([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.png", "-wave", geometry!, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, 11]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
