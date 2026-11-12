import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: xc:#257bd680 -modulate VALUE -depth 8 rgba:dest.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { value: "120:75", hex: "02020280" },
        { value: "1.6,0", hex: "02020280" },
        { value: "4:1", hex: "05050580" },
        { value: "4,0", hex: "05050580" },
        { value: "1:4", hex: "00000080" },
        { value: "0.25,0", hex: "00000080" },
        { value: "100", hex: "257bd680" },
        // Ratio geometry sets saturation to 1%, which is visible at higher brightness.
        { value: "100:1", hex: "7d7d7e80" },
        { value: "100,1", hex: "7d7d7e80" },
    ])(`${mode}: modulates $value and replaces existing output`, async ({ value, hex }) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/dest", original]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/dest", original);
        const args = ["xc:#257bd680", "-modulate", value, "-depth", "8", "rgba:/dest"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/dest") : files.get("/dest")!;
        expect(Buffer.from(output).toString("hex")).toBe(hex);
    });
}
