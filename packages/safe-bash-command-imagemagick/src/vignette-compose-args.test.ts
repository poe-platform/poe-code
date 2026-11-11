import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, complete 7x5 RGBA8 output and center pixel.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["Dissolve", undefined, "ba3363f2", "5cfdad8474a57bf34aa25bb5f359909737a62a33122192047899e7d0272a30e9"],
        ["Dissolve", "25,75", "705a8a7b", "7cef75a6972190187f10737f06c1eb7813e613a87e6db2a77bc2cbc70f380995"],
        ["Blend", "25,75", "665f8f8e", "4f41249769249a9c0b184c63663fea0ff2e32478719b47ccf25b2bce7d59a36f"],
        ["Mathematics", "0,0,1,0", "7a5585f2", "e479035ab19fa325cd399f82455da70fcba1ca2bde00aaecb8a649bd0dc1da75"],
    ] as const)(`matches native vignette %s compose:args=%s (${backend})`, async (compose, composeArgs, center, digest) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "7x5", "xc:#c0306090", "-background", "#2880b070",
            ...(composeArgs === undefined ? [] : ["-define", `compose:args=${composeArgs}`]),
            "-compose", compose, "-vignette", "0x1+1+1", "+define", "compose:args", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(7 * 5 * 4);
        expect.soft(Buffer.from(output.subarray((2 * 7 + 3) * 4, (2 * 7 + 4) * 4)).toString("hex")).toBe(center);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
