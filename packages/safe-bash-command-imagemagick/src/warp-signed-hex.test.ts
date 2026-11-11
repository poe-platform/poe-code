import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P6\n5 4\n255\n"),
    Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 31) % 256)),
]);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    // Native ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB.
    it.each([
        ["-wave", "-0x2x4", "-2x4", 120, "b69406de4125b837158fe5ae99a206a2df30e6d4ccd04324fb230b5146959488"],
        ["-wave", "+0x2x4", "2x4", 120, "10a4660ebd7e48cea92041e71e6452371b0bcbd1d931b8009d7c0bc351548db3"],
        ["-swirl", "-0x30", "-48", 60, "7b4249efc0918dd72f107d3c09ee73477e5720246e68997a18f5ef33d4f70dba"],
        ["-swirl", "+0x30", "48", 60, "8eebadce21f72c92e1f237364c5ebd13267900f16cc237ccfa3f260a163eb13f"],
        ["-implode", "-0x2", "-2", 60, "54e8c381bc7bb5c564eac4a02d8d7b80421c5aa47c1d40a240232ddb9210fa1f"],
        ["-implode", "+0x2", "2", 60, "d20988680d8d40ff1c1e1afb4d141fec016d633afb8abf40e66e78c9bc17d4e5"],
        ["-wave", "0x4", "0x4", 60, "85826be80810478f2886b3c236cd7a990b2556ed91fefae64542f27e75ec79f3"],
    ] as const)(`${mode}: %s %s matches native pixels`, async (option, hex, decimal, length, hash) => {
        for (const geometry of new Set([hex, decimal])) {
            const files = new Map<string, Uint8Array>([["/in.ppm", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.ppm", input);
            const args = ["/in.ppm", option, geometry, "-depth", "8", "rgb:/out.raw"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
            expect(output).toHaveLength(length);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        }
    });
}
