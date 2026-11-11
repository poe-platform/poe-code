import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference input and output.
const source = Buffer.concat([Buffer.from("P6\n8 6\n255\n"), Buffer.from(Array.from({ length: 144 }, (_, i) => i))]);
// Red 8-bit output additionally checked with ImageMagick 7.1.2-31 Q16-HDRI.
const cases = [
    { channel: "R", geometry: "18x0", depth: 8, expected: "45001ab70f1c976d62d313b1c76533d1a84a9def9f66d81ded591cd3c06dc1b4" },
    { channel: "R", geometry: "0x0", depth: 16, expected: "04730be78a6d96b65d8e486c9a0cea3418390b4269dd444e3573efa19fe6dcb6" },
    { channel: "R", geometry: "18x0", depth: 16, expected: "be944d94f1b344ab8d3249b026cbb4beb0d0f1c7ca9a2cbd0a57efc44a78ec65" },
    { channel: "A", geometry: "0x0", depth: 16, expected: "e351dcd26b1e5eb1fed5305535af30c2796b51d9271c249dbad5e225825e8611" },
    { channel: "A", geometry: "18x0", depth: 16, expected: "b7838872db532ca1ad1acbe5bc60d3d8a0dfd925774703eecac1eb8f3cc4ab84" },
    { channel: "A", geometry: "18x0", depth: 8, expected: "6040447a04164e82d8ce1cf0b78b321d18204d173446effcffd084d31c7b7b8a" },
    { channel: "", geometry: "18x0", depth: 16, expected: "b48d515ba885a637d4f8cdd4a8ede1da9e588be134bc5741121df8f2b737ab47" },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`${mode}: shears fractional $channel samples at $depth bits, $geometry`, async ({ channel, geometry, depth, expected }) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map<string, Uint8Array>([["/in.pam", source], ["/out", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pam", source);
        await fs.writeFile("/out", keep);
        const args = ["/in.pam", ...(channel ? ["-alpha", "set", "-channel", channel, "-evaluate", "set", "50%", "+channel", "-background", "none"] : []), "-shear", geometry, "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(output.length).toBe((geometry === "0x0" ? 48 : 60) * 4 * depth / 8);
        expect(createHash("sha256").update(output).digest("hex")).toBe(expected);
    });
}
