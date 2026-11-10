import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI output for a 3x2 RGBA PAM.
const colored = "0730598220408077abd4fd264f78a1caf31c456e2040807797c0e9123b648db6";
const white = "07305982ffffffffabd4fd264f78a1caf31c456effffffff97c0e9123b648db6";
const cases = [
    { name: "reset after loading", args: ["im.pam", "-background", "#20408077", "+background"], hex: colored },
    { name: "reset before loading", args: ["-background", "red", "+background", "im.pam"], hex: white },
    { name: "explicit background", args: ["im.pam", "-background", "#20408077"], hex: colored },
    { name: "default background", args: ["im.pam"], hex: white },
    { name: "background assigned before read", args: ["-background", "#20408077", "im.pam", "+background"], hex: colored },
    { name: "subsequent input uses reset setting", args: ["im.pam", "-background", "#20408077", "+background", "im.pam"], hex: colored + white },
    { name: "repeated reset keeps assigned color", args: ["im.pam", "-background", "#20408077", "+background", "+background"], hex: colored },
];
for (const mode of ["buffered", "retained", "command"]) {
    it.each(cases)(`${mode}: $name preserves native splice bytes`, async ({ args, hex }) => {
        const input = Buffer.concat([
            Buffer.from("P7\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
            Uint8Array.from({ length: 24 }, (_, i) => (i * 41 + 7) % 256),
        ]);
        const files = new Map([["im.pam", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const argv = [...args, "-splice", "1x0+1+0", "-depth", "8", "rgba:out"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(argv);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
        }
        expect(Buffer.from(mode === "buffered" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(hex);
    });
}
