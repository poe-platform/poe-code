import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: in.png -implode AMOUNT PNG32:out.png.
// Hashes cover decoded 8-bit RGBA pixels, including native's unchanged pixels
// when the mapped coordinates exceed its signed pixel-cache offset limits.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAIAAABV+fA3AAAAX0lEQVR4nH2LsQmAMBQFo9icO1i/8tfuEGfIDtkhO2SH7JAdMo2tRRQiiHDFwXGTc8WO/ZNF7MKLIHzHKF16Cw/JbllFG79oRxSnKGITbR6bSCKLIurrM86nZVGN/PddRtsqDADym3wAAAAASUVORK5CYII=", "base64");
const cases = [
    { amount: 30, hash: "ccd5820093c90ba3a68efd6b8af4fc751e4409b87e25d1f351b93e3f25b76940" },
    { amount: 40, hash: "34e4f39df8acb09f8fb9fdc622a17a59047d50d929f27d5dd8b0a51ae5b5a644" },
    { amount: 80, hash: "284cde96a03df2b2cc501b9e23a0a04a7b5b6ca759f0b4813867a4de26dd08f4" },
    { amount: 100, hash: "b930366660d2f84a91f501fad303702456d15a9b212334ee8686e8749a783268" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native implode strength $amount`, async ({ amount, hash }) => {
        const files = new Map([["/in.png", input], ["/out.png", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/in.png", "-implode", String(amount), "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, 7]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
