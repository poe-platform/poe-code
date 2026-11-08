import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runIdentifyCli, runIdentifyCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const command of ["convert", "identify"] as const) {
        it.each([
            { color: "red", expected: [0, 1, 0, 0] },
            { color: "white", expected: [0, 1, 1, 1] },
            { color: "black", expected: [0, 0, 0, 0] }
        ])(`${command} reports no black channel for RGB $color via ${mode}`, async ({ color, expected }) => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
            if (command === "identify") {
                expect(await runConvertCli(["-size", "1x1", `xc:${color}`, "/input.png"], input)).toMatchObject({ exitCode: 0, stderr: "" });
            }
            const format = "%[fx:k]|%[fx:r]|%[fx:g]|%[fx:b]";
            const args = command === "convert"
                ? ["-size", "1x1", `xc:${color}`, "-format", format, "info:"]
                : ["-format", format, "/input.png"];
            const result = command === "identify" ? mode === "sync" ? runIdentifyCliSync(args, files) : await runIdentifyCli(args, input)
                : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input);
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout.trim().split("|").map(Number)).toEqual(expected);
            expect([...files.keys()]).toEqual(command === "identify" && mode !== "retained" ? ["/input.png"] : []);
            expect((await filesystem.readdir("/")).map(entry => entry.name)).toEqual(command === "identify" && mode === "retained" ? ["input.png"] : []);
        });
    }
}
