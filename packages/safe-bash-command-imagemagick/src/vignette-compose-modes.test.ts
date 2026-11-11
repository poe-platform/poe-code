import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
for (const backend of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["PinLight", "4a1bfec62415fcbfc69b2100ab8ee8d479beeb432282544d2a8c5d017dd8cd98", "9f4885f2"],
        ["LinearLight", "387e8745bda26ebfbd48f897f7be2b4c6ca96346d916946c05174433c1c67606", "b01f6af2"],
        ["VividLight", "6ff7d60040696933fcfd3bb7f6561a6309c0095825901c8f4ed2636c1ccf33e3", "8b1f7af2"],
        ["HardMix", "72840ed356c5a9aa42800724d807e92aa7b5515c0a1b7064d0cbf4bd0db0bdd8", "691fa6f2"],
        ["DarkenIntensity", "24045c10c12a89f4c11e3b88ea34558fcdf926a8c1008cd08cc33bc71407c774", "00000000"],
        ["LightenIntensity", "ae2f9bc8aaaad773bc198acb0ec4b1ca52c83ce3b08d6c6bc6cb809209a2889c", "2880b000"],
        ["LinearBurn", "247ca59a9844c12422ff1f77a6141b7ea3bedfb8fc3f359e1b1eb2c5d2f3742a", "691f42f2"],
        ["ColorDodge", "e0ad8cff103dcb048ed00eb29496449d75cd56532dba4ccad37bb95d1bb89ace", "ad61a6f2"],
        ["ColorBurn", "fe5229dcb8ef273a83dbe57e7fd9b5b8bba77f169744b3646c4218d9d42fb38f", "691f4ef2"],
        ["ModulusAdd", "28c6de1b48c040815094323386510cbff747201aa6ce667c0071668d6b57ff1c", "c164a559"],
        ["ModulusSubtract", "7b56c6454d682aa59d93f99fe7421421992d52c8ea5e04895b8d24e126e8adde", "9df30a78"],
        ["Threshold", "a75b312bd16694a7e1eca7b7a62aaba6a2fbd72e0d78d9cda851276999bffac7", "74517eff"],
        ["Mathematics", "c88869802b093b1a21fcf218ec3c7c81cbd29a5021498ec60d1b40d1a6c795f4", "691f3bf2"],
        ["Hue", "f5b56234444f20ced82fce0368fdf4a91a07f9b1ad3d7dcb80853009b66b3e89", "c53d6be8"],
        ["Saturate", "a764fdde7e5e783e9d6335da331104888182da1c5ce0969c7b5245b2ee22f713", "2481b4e8"],
        ["Colorize", "8b3ad83585db3e1ddc79e6bff11d57034fb04a059e44f085c89a9cd0fde20375", "cb3b6be8"],
        ["Luminize", "6b384352347feae1b3a4b13fb33a6e0bfe814ce650e61c9fec1894080b608070", "1d75a5e8"],
        ["Bumpmap", "f10432342b45dba33b9d0391a3a4c35bf1d4bea369d54fc14f2a785e14f9a4de", "0d293924"],
        ["ChangeMask", "1e7a3d0068c35a74b730d69440bdc5ece0749d5fefd3ca038b8cf3f02ce46a9a", "2880b070"],
        ["Blend", "50d6d6712bf86c400a78b415d9cb71ae45463b7ed2b502585b10afe29dd6c958", "c164a5ff"],
        ["Over", "5cfdad8474a57bf34aa25bb5f359909737a62a33122192047899e7d0272a30e9", "ba3363f2"],
        ["Copy", "f0a7d79e2c4d582c2195df2f3533819daebdbab734029b5b3ec94be01848e355", "c03060e8"],
        ["CopyAlpha", "a74b9a07d1232e0d7f194ebd924101c8cbd637353fe0f407649d28b0e0171d98", "2880b0e8"],
    ] as const)(`matches native vignette %s (${backend})`, async (compose, digest, rgba) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "7x5", "xc:#c0306090", "-background", "#2880b070", "-compose", compose,
            "-vignette", "0x1+1+1", "-depth", "8", "rgba:/out"];
        let stderr = "";
        const result = backend === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : backend === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, backend === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output).toHaveLength(7 * 5 * 4);
        expect.soft(Buffer.from(output.subarray(17 * 4, 18 * 4)).toString("hex")).toBe(rgba);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
