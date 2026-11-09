import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick drops the inherited comment for thumbnails, including unchanged dimensions.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAJcEhZcwAAEnQAAA3XAUw2FB8AAAD0elRYdFJhdyBwcm9maWxlIHR5cGUgeG1wAAAYlW1RSY7EIAy8+xXzBFIGG56DAtxa6uM8f8qkNa1eQIIEl2sB+b3d5ScGoKKnV+1ebXiyYcWzHUjxb6dN16jpAOywbMtgRft1/o9e5JlBBEJMe0HO2d5IrloQVc+cSTsbl++B6QRh2nKIOZYe2mLyKym4guu4SLirN9JS2ytGCERZ59MC9Yu4mvKgeSK00fx89USofnGUvLDrvNyEGQkglhU2lkgd2tSkS0zd+ZE2WVCWT9kQCc+yTdd9bY2UgwEKW5pnhmIcqkVYBsF6vc3H2eOp5PlWOlOXPzRYbaddssCMAAAAFXRFWHRjb21tZW50AG9yZGluYXJ5IG5vdGXx06zWAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIyOjQ1OjE4KzAwOjAwGZb4wAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMjo0NToxOCswMDowMGjLQHwAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjI6NDU6MTgrMDA6MDA/3mGjAAAA+ElEQVRo3u3UsRGDMAyF4eMuKbkUFJSMwAoa/W3ECimCiWxZQJ38BY3yImNhf8NzeQ3zOo3/+jwk2bxO47y5Ry7k6ir1TWdZK3WFvgo98+yxlrW1PBvXarLWZj8DOBrrRuM96ze76U62GVh3LetnS03hvZRm/YbVzx4D6PyguJhlL1Y3ToYYs5ZuLNtc6PtdS+7kpSd6X0uuVg/AfYl49HXRuLkm9VWx6+z5VVH9f4sDU5Y9vdYYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAEYgAE/asAbcf6gyQcdYMsAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-thumbnail", "31x23!", 31, 23, undefined],
        ["-thumbnail", "64x48", 64, 48, undefined],
        ["-thumbnail", "128x96>", 64, 48, undefined],
        ["-sample", "16x12", 16, 12, "ordinary note"],
        ["-resize", "16x12", 16, 12, "ordinary note"]
    ] as const)(`handles inherited PNG comments with %s %s (${mode})`, async (operation, geometry, width, height, comment) => {
        const files = new Map([["/grid.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/grid.png", input);
        const args = ["/grid.png", operation, geometry, "PNG32:/out.png"];
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
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await filesystem.readFile("/out.png");
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([width, height]);
        expect(image.properties?.comment).toBe(comment);
        expect(decodeImage(input).properties?.comment).toBe("ordinary note");
    });
}
