import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, 6x4 xc:red on black, depth-8 RGB output.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(["20,15", "20/15", "20x15", "20"])(`${mode}: reads shear angles in %s`, async geometry => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = ["-size", "6x4", "xc:red", "-background", "black", "-shear", geometry, "PNG24:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect.soft([output.width, output.height]).toEqual([7, geometry === "20" ? 6 : 5]);
        const rgb = Uint8Array.from(output.data).filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(geometry === "20"
            ? "09c08ac54c997fbf79f936a8a96703890dfefdf622907b17d23846df0a66e712"
            : "b0eecd5331370f6d5e0d796c8c2a8b0593bac4c6ec8333fa9ca848b4ba595d00");
    });
}
