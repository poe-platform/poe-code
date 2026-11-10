import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("3060b080a04020e0802050b0c01030607733bb90808020c0", "hex")
]);
// ImageMagick 7.1.2-35 Q16-HDRI: in.pam <options> -negate -depth 8 rgba:out.
const sheared = "423319005b888b00569f940020382c00185a4e004d7326006060a80000000000";
const regional = "394251805fbfdf1f7fdfaf4f3b3c3c604b376090626223c0";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "clears the region after nonzero shear", options: ["-region", "2x1+1+0", "-shear", "20x0"], rgba: sheared },
        { name: "shears without a region", options: ["-shear", "20x0"], rgba: sheared },
        { name: "preserves the region without shear", options: ["-region", "2x1+1+0"], rgba: regional },
        { name: "preserves the region after identity shear", options: ["-region", "2x1+1+0", "-shear", "0x0"], rgba: regional }
    ])(`$name (${mode})`, async ({ options, rgba }) => {
        const keep = Buffer.from("KEEP"), filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>([["/in.pam", input], ["/out", keep]]);
        await filesystem.writeFile("/in.pam", input);
        await filesystem.writeFile("/out", keep);
        const args = ["/in.pam", ...options, "-negate", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result) stderr += result.stderr;
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(rgba);
    });
}
