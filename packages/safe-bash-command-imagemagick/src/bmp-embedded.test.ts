import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete BMPs and native ImageMagick RGBA reference pixels.
const fixtures = [
  {
    "name": "png",
    "base64": "Qk2FAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgABQAAAE8AAAAAAAAAAAAAAAAAAAAAAAAAiVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGM4IcelK/KMiTFAwEwpGwAY5wM+loXwnAAAAABJRU5ErkJggg==",
    "expected": "c81e0aff2d14e6ffc96e1aff633651ff"
  },
  {
    "name": "jpeg",
    "base64": "Qk3EAgAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgABAAAAI4CAAAAAAAAAAAAAAAAAAAAAAAA/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiryKMX1wBGgAkbjaPWiiivqsP/Cj6L8jqq/G/U//Z",
    "expected": "873c5bff5d1231ffab607fff7d3251ff"
  },
  {
    "name": "comp4",
    "base64": "Qk1GAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgABAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA==",
    "expected": null
  },
  {
    "name": "comp5",
    "base64": "Qk1GAAAAAAAAADYAAAAoAAAAAgAAAAIAAAABABgABQAAABAAAAAAAAAAAAAAAAAAAAAAAAAAESIzRFVmAACqu8zd7v8AAA==",
    "expected": null
  }
];

for (const fixture of fixtures) for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`${fixture.expected ? "decodes" : "rejects"} embedded ${fixture.name} (${mode})`, async () => {
        const input = Buffer.from(fixture.base64, "base64"), keep = Buffer.from("keep");
        const files = new Map<string, Uint8Array>([["/in.bmp", input], ["/out.png", keep]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.bmp", input);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.bmp", "/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(fixture.expected ? 0 : 1);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        if (fixture.expected) {
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([2, 2]);
            expect(Buffer.from(decoded.data).toString("hex")).toBe(fixture.expected);
        } else expect(Array.from(output)).toEqual(Array.from(keep));
    });
}
