import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        { channels: "", expected: "O1anR3FqtUdUesJHfmPNR2Z0pUdBWrRHdG3AR1hQzEeAZqRHaXayR0dev0d2cMtHXFSiR4JpsUdseb5HTGHKR3lzoEdgWK9HhGy9R297yUdQZJ9He3WuR2Ncu0c7b8hHcVLTR1RorUd+eLpHZmDGR0Fx0kd0VqtHWGq5R4B6xUdpY9H0R3Sq9HZauPRcbcT0glDQ9GxmqPRMdrb0eV7D9GBwzvSEVKf0b2m19FB5wvR7Yc30Y3Ol9DtYtPRxbMD0VHvM9H5kpPRmdbL0QVy/9HRvy/RYUqL0gGix9Gl4vvRHYMr0dnGg9FxWr/SCar30bHrJ9Exjn/R5dK70YFq79A==" },
        { channels: "RGB", expected: "Um1kC4iBeAtsj4sLk3meC32KYgtZcXYLi4OJC3BnnAuVfGALgIx0C151hwuNhpoLdGteC5d/cguDjoULZHiYC4+IXAt3b3ALmYKDC4aQlgtoe1oLkYtuC3pzgQtShZULiGmoC2x+bAuTjX8LfXaTC1mHpguLbWoLcIF9C5WPkQuAeaTmXopo5o1xe+Z0g4/ml2ei5oN8ZuZkjHrmj3WN5neGoOaZa2Tmhn945miOi+aReJ7meohi5lJvduaIgonmbJCc5pN7YOZ9i3TmWXOH5ouFmuZwaV7mlX5y5oCNheZedpjmjYdc5nRtcOaXgYPmg4+W5mR5WuaPim7md3GB5g==" },
    ])(`measures only read-mask samples but corrects every pixel via ${mode} ($channels)`, async ({ channels, expected }) => {
        // Native ImageMagick Q16-HDRI reference; white selects the top four rows.
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDu+JGtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAwn6UpEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMMiwCM4AAABrSURBVBjTdc7BCYAwDAXQbxAkmJPk2AE6jQM4rmu4QknvIQcPYiuip8D7fPKHadnmJAoTRaoKkx1WFUkUVhWUOeAc8NJvMw7QFz4L5GV94drCzIHROY4WSiCXgEkvkPOF/vviA5+b6G/9bSf+oICXc0KZiQAAAABJRU5ErkJggg==", "base64");
        const mask = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oLBxcOJV3i19AAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDu+JGtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAwn6UpEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMMiwCM4AAAAOSURBVAjXY/jPAIFQAAAv4AP9iEy6bQAAAABJRU5ErkJggg==", "base64");
        const files = new Map([["input.png", input], ["mask.png", mask]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
        const args = ["input.png", "-read-mask", "mask.png", ...(channels ? ["-channel", channels] : []), "-auto-gamma", "+channel", "+read-mask", "PNG32:out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const actual = decodeImage((mode === "retained" || mode === "public") ? await filesystem.readFile("/out.png") : files.get("out.png")!).data;
        expect(Array.from(actual)).toEqual(Array.from(Buffer.from(expected, "base64")));
    });
}
