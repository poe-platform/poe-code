import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including unused white/black palette entries.
const fixtures = [
    { name: "mixed", values: "0x81, 0x01, 0x02, 0x00", gray: "00ffffffffffff0000ff00ffffffffffffff", cycled: "ff000000000000ffff00ff00000000000000" },
    { name: "white", values: "0x00, 0x00, 0x00, 0x00", gray: "ff".repeat(18), cycled: "00".repeat(18) },
    { name: "black", values: "0xff, 0xff, 0xff, 0xff", gray: "00".repeat(18), cycled: "ff".repeat(18) },
];
for (const mode of ["sync", "map", "filesystem", "command"]) for (const fixture of fixtures) {
    it.each([
        { operations: [], cycled: false },
        { operations: ["-cycle", "1"], cycled: true },
        { operations: ["-cycle", "-1"], cycled: true },
        { operations: ["-cycle", "2"], cycled: false },
        { operations: ["-cycle", "1", "-cycle", "1"], cycled: false },
    ])(`${mode}: retains the ${fixture.name} XBM palette for $operations`, async ({ operations, cycled }) => {
        const input = new TextEncoder().encode(`#define tile_width 9\n#define tile_height 2\nstatic unsigned char tile_bits[] = { ${fixture.values} };`);
        for (const info of [false, true]) {
            const files = new Map([["/tile.xbm", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/tile.xbm", input);
            const args = ["/tile.xbm", ...operations, ...(info ? ["-format", "%r|%[colorspace]|%z", "info:-"] : ["-depth", "8", "gray:-"])];
            const stdout: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            if (info) expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe("PseudoClass sRGB |sRGB|8");
            else expect(Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout)).toString("hex")).toBe(cycled ? fixture.cycled : fixture.gray);
        }
    });
}
