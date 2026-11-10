import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before", "after", "none"])(`validates splice input order (%s, ${mode})`, async (placement) => {
        const beforeInput = placement === "before";
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/output.png", keep]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/output.png", keep);
        const args = [...(beforeInput ? ["-splice", "1x1", "/in.ppm"] : placement === "after" ? ["/in.ppm", "-background", "#123456", "-splice", "1x1"] : ["/in.ppm"]), "PNG32:/output.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
        expect(result.exitCode).toBe(beforeInput ? 1 : 0);
        if (beforeInput) {
            expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-splice'");
            expect(output).toEqual(keep);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual(placement === "after" ? [5, 4] : [4, 3]);
            const original = "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff";
            const spliced = "123456ff123456ff123456ff123456ff123456ff123456ff00070eff151c23ff2a3138ff3f464dff123456ff545b62ff697077ff7e858cff939aa1ff123456ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff";
            expect(Buffer.from(decoded.data).toString("hex")).toBe(placement === "after" ? spliced : original);
        }
    });
}
