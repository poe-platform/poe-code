import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: two 2x1 red/blue GIFs, written with
// -delay 1x24 a.gif -delay 7x1000 b.gif -type TrueColor -compress None miff:-
// colors=2 is replaced with colors=0 to isolate sequence decoding.
const sequence = Buffer.from("aWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9VW5kZWZpbmVkCm51bWJlci1jaGFubmVscz0zIG51bWJlci1tZXRhLWNoYW5uZWxzPTAgY2hhbm5lbC1tYXNrPTB4MDAwMDAwMDAwN2ZmZmZmZgpjb2x1bW5zPTIgcm93cz0xIGRlcHRoPTgKdHlwZT1UcnVlQ29sb3IKY29sb3JzcGFjZT1zUkdCCmNvbXByZXNzaW9uPU5vbmUgIHF1YWxpdHk9MApwYWdlPTJ4MSswKzAKaXRlcmF0aW9ucz0xIGRlbGF5PTEgdGlja3MtcGVyLXNlY29uZD0yNApyZW5kZXJpbmctaW50ZW50PVBlcmNlcHR1YWwKZ2FtbWE9MC40NTQ1NDUKcmVkLXByaW1hcnk9MC42NCwwLjMzIGdyZWVuLXByaW1hcnk9MC4zLDAuNiBibHVlLXByaW1hcnk9MC4xNSwwLjA2CndoaXRlLXBvaW50PTAuMzEyNywwLjMyOQpkYXRlOmNyZWF0ZT0yMDI2LTExLTEwVDAzOjQ5OjE2KzAwOjAwCmRhdGU6bW9kaWZ5PTIwMjYtMTEtMTBUMDM6NDk6MTYrMDA6MDAKZGF0ZTp0aW1lc3RhbXA9MjAyNi0xMS0xMFQwMzo0OToxNiswMDowMAoMCjoa/wAA/wAAaWQ9SW1hZ2VNYWdpY2sgdmVyc2lvbj0xLjAKY2xhc3M9RGlyZWN0Q2xhc3MgY29sb3JzPTAgYWxwaGEtdHJhaXQ9VW5kZWZpbmVkCm51bWJlci1jaGFubmVscz0zIG51bWJlci1tZXRhLWNoYW5uZWxzPTAgY2hhbm5lbC1tYXNrPTB4MDAwMDAwMDAwN2ZmZmZmZgpjb2x1bW5zPTIgcm93cz0xIGRlcHRoPTgKdHlwZT1UcnVlQ29sb3IKY29sb3JzcGFjZT1zUkdCCmNvbXByZXNzaW9uPU5vbmUgIHF1YWxpdHk9MApwYWdlPTJ4MSswKzAKc2NlbmU9MSAgaXRlcmF0aW9ucz0xIGRlbGF5PTcgdGlja3MtcGVyLXNlY29uZD0xMDAwCnJlbmRlcmluZy1pbnRlbnQ9UGVyY2VwdHVhbApnYW1tYT0wLjQ1NDU0NQpyZWQtcHJpbWFyeT0wLjY0LDAuMzMgZ3JlZW4tcHJpbWFyeT0wLjMsMC42IGJsdWUtcHJpbWFyeT0wLjE1LDAuMDYKd2hpdGUtcG9pbnQ9MC4zMTI3LDAuMzI5CmRhdGU6Y3JlYXRlPTIwMjYtMTEtMTBUMDM6NDk6MTYrMDA6MDAKZGF0ZTptb2RpZnk9MjAyNi0xMS0xMFQwMzo0OToxNiswMDowMApkYXRlOnRpbWVzdGFtcD0yMDI2LTExLTEwVDAzOjQ5OjE2KzAwOjAwCgwKOhoAAP8AAP8=", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ["control.miff", "srgb(255,0,0)|srgb(0,0,255)|"],
        ["control.miff[1]", "srgb(0,0,255)|"],
        ["control.miff[0]", "srgb(255,0,0)|"],
        ["control.miff[1,0]", "srgb(0,0,255)|srgb(255,0,0)|"]
    ])(`${mode}: reads %s in frame order`, async (input, expected) => {
        const files = new Map([["control.miff", sequence]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/control.miff", sequence);
        const args = [input, "-format", "%[pixel:p{0,0}]|", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
            .toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
