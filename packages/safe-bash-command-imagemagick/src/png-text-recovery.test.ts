import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// One RGB pixel (112233), valid chunk CRCs, and readable or damaged zTXt comments.
const fixtures = [
  { name: "zbadmethod", comment: undefined, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAFnpUWHRDb21tZW50AAF4nMtIzcnJBwAGLAIVgE8cFAAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==" },
  { name: "zbadstream", comment: undefined, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAD3pUWHRDb21tZW50AABicm9rZW4JY6hwAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" },
  { name: "zshort", comment: undefined, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAE3pUWHRDb21tZW50AAB4nMtIzcnJBwAGaBewjgAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==" },
  { name: "zpreserve", comment: "good", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADHRFWHRDb21tZW50AGdvb2Tjmht3AAAAD3pUWHRDb21tZW50AABicm9rZW4JY6hwAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" },
  { name: "zvalid", comment: "hello", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAFnpUWHRDb21tZW50AAB4nMtIzcnJBwAGLAIVHUD9YgAAAAxJREFUeJxjEFQyBgAArgBnFR6hXwAAAABJRU5ErkJggg==" }
];

for (const mode of ["buffered", "command"] as const) {
  it.each(fixtures)(`recovers unreadable PNG text: $name (${mode})`, async ({ name, comment, base64 }) => {
    const input = Buffer.from(base64, "base64");
    const files = new Map([["/in.png", input], ["/out.png", Buffer.from("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    const warning = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, warning).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.properties?.Comment).toBe(comment);
    if (name === "zvalid") expect(warning).toBe("");
    else expect(warning).toContain("zTXt");
  });
}
