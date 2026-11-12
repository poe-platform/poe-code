import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inks = Buffer.from("0a14283c28496b91526c8033a7722431a912903012492786", "hex");
const pam = Buffer.concat([Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), inks]);

// ImageMagick 7.1.2-35 Q16-HDRI, exported as raw CMYK8.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operation: [], expected: "0a14283c28496b91526c8033a7722431a912903012492786" },
        { operation: ["-scale", "200%"], expected: "0a14283c0a14283c28496b9128496b91526c8033526c80330a14283c0a14283c28496b9128496b91526c8033526c8033a7722431a7722431a9129030a91290301249278612492786a7722431a7722431a9129030a91290301249278612492786" },
        { operation: ["-resize", "2x1!"], expected: "6238474546496861" },
        { operation: ["-liquid-rescale", "2x2!"], expected: "11243e6046647e5ab34d512a462f5368" },
        { operation: ["-thumbnail", "2x1!"] },
        { operation: ["-units", "PixelsPerInch", "-density", "72", "-resample", "144"] },
        { operation: ["-adaptive-resize", "2x1!"] },
    ])(`${mode}: preserves raw CMYK inks through $operation`, async ({ operation, expected }) => {
        const outputs: string[] = [];
        for (const format of ["cmyk", "pam"]) {
            const filesystem = new MemoryFileSystem();
            const files = new Map<string, Buffer>([["/in", format === "cmyk" ? inks : pam]]);
            await filesystem.writeFile("/in", files.get("/in")!);
            const args = ["-size", "3x2", "-depth", "8", `${format}:/in`, ...operation, "-depth", "8", "cmyk:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
            const actual = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            outputs.push(Buffer.from(actual).toString("hex"));
            if (expected !== undefined) expect(outputs.at(-1), format).toBe(expected);
        }
        expect(outputs[0]).toBe(outputs[1]);
    });
}
