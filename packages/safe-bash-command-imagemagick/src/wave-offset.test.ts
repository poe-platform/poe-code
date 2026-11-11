import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: an offset after x leaves wavelength unset.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["2x+5", "2x"])(`${mode}: preserves wave geometry %s`, async geometry => {
        const input = Buffer.concat([
            Buffer.from("P6\n7 5\n255\n"),
            Buffer.from(Array.from({ length: 105 }, (_, i) => (13 * i + 9) % 256)),
        ]);
        const files = new Map([["/in.ppm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const argv = ["/in.ppm", "-wave", geometry, "-depth", "8", "rgb:/out.raw"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(output).toHaveLength(189);
        expect(createHash("sha256").update(output).digest("hex"))
            .toBe("850ba917f6027ac518b08bb44b5823590c45b027ab1354e4acd717bb025eb771");
    });
}
