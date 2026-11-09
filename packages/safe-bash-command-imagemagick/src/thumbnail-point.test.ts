import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/point-thumbnail/grid.png", import.meta.url));

// ImageMagick 7.1.2-35 Q16-HDRI: grid.png OPTIONS PNG32:out.png,
// then out.png -depth 8 rgba:-. Hash the decoded RGBA, not PNG metadata.
for (const depth of [8, 16]) for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        [["-filter", "point", "-thumbnail", "4x3"], 4, 3, "d3e6e6e42cb11865ee3f9f2ffd6792fb7d741ec2be99177be3cf724d923c793e"],
        [["-filter", "point", "-thumbnail", "16x12"], 16, 12, "4b7385f3ed59ee18f845cd3c93e85c7733cd064bc94c15d15bf0989588dc0627"],
        [["-filter", "point", "-thumbnail", "21x16"], 21, 16, "7cd52b6bb84df72795037ee7dd533201fd48c2aa541ad88151ddbf1478444e11"],
        [["-filter", "point", "-thumbnail", "4x24!"], 4, 24, "9e6cbc6b2dc3cd8c5cc60d5509c5778f09c7f0b366b13c30d81ee30dde9735f0"],
        [["-filter", "point", "-resize", "4x3"], 4, 3, "c5e8e0289436cafb30e82f59fa8a6d5e6d8a713f7f16a5bbc7f3353e51542d6c"],
        [["-filter", "point", "-thumbnail", "31x23!"], 31, 23, "236e7f551186b790a8604eace02b8e1749b059c9be1732d9ccd1736c107f2a02"],
        [["-thumbnail", "4x3"], 4, 3, "47a49b3cf24c4c29264f62103b6ad780b07db6d7ad2a44b4c07a3518cff1f737"]
    ] as const)(`matches native thumbnail reduction: %j (${mode}, ${depth}-bit)`, async (options, width, height, digest) => {
        const decoded = decodeImage(input);
        const source = depth === 8 ? input : encodeImage({ ...decoded,
            data16: Uint16Array.from(decoded.data, value => value * 257) }, { format: "png" }).data;
        const files = new Map<string, Uint8Array>([["grid.png", source]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/grid.png", source);
        const args = ["grid.png", ...options, "PNG32:out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const bytes = mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png");
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(createHash("sha256").update(image.data).digest("hex")).toBe(digest);
    });
}
