import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const animation = Uint8Array.from(Buffer.from("R0lGODlhCQALAIEAABEhMf8AAADIAAAA3CH/C05FVFNDQVBFMi4wAwEEAAAh/gtzb3VyY2Ugbm90ZQAh+QQFBwAAACwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBACH5BAkTAAAALAAAAAAJAAsAgREhMf8AAADIAAAA3AgmAAMIGABAIMEABwcWHGhw4cGEEBtKhOhQokKEDitevEjRoMWDAQEAOw==", "base64"));

for (const retained of [false, true]) {
    it(`formats timing, disposal and comments per GIF frame (retained=${retained})`, async () => {
        const files = new Map([["anim.gif", animation]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/anim.gif", animation);
        const input = retained ? { filesystem, cwd: "/" } : files;
        for (const [format, stdout] of [["%T/%D;", "7/None;19/Background;"], ["%c;", "source note;;"], ["%w,%h;", "9,11;9,11;"]]) {
            expect(await runConvertCli(["anim.gif", "-format", format!, "info:"], input)).toEqual({ exitCode: 0, stderr: "", stdout });
        }
        expect(await runConvertCli(["anim.gif[1]", "-format", "%T/%D/%c;", "info:-"], input)).toEqual({ exitCode: 0, stderr: "", stdout: "19/Background/;" });
    });
    it(`formats a PNG comment shorthand (retained=${retained})`, async () => {
        const input = retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map<string, Uint8Array>();
        expect(await runConvertCli(["xc:red", "-set", "comment", "caption A", "tagged.png"], input)).toMatchObject({ exitCode: 0, stderr: "" });
        expect(await runConvertCli(["tagged.png", "-format", "%c", "info:-"], input)).toEqual({ exitCode: 0, stderr: "", stdout: "caption A" });
    });
}
