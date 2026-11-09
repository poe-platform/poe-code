import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// 7x5 PPM and full RGB result verified with native ImageMagick 7.1.2-35.
const input = Buffer.from("50360a3720350a3235350a16529c056bdf7213b16e3912e8dde002214e89d23a9f23a444e19d673f25191b2b4975af085ec245c56411bb845b40333443608bc41c71d456d5731fc890664a3c3c4a6690c81f73d556d4711cc48b60433433405b84bb1164c545c25e08af75492b1b19253f679de1", "hex");
const expected = Buffer.from("19239c19239c19213a19213a19213a08333a08333a19239c19239c19213a19213a19213a08333a08333a193c5e193c5e19213a19213a19213a19333a19333a193c5e193c5e191f5e191f5e191f3f19333f19333f193c5e193c5e191f5e191f5e191f3f19333f19333f", "hex");

for (const mode of ["command", "buffered", "retained"] as const)
for (const methods of [["Smooth"], ["Open", "Close"]])
it(`opens then closes all Smooth pixels (${mode}, ${methods.join(" + ")})`, async () => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...methods.flatMap(method => ["-morphology", method, "Square:1"]), "/out.ppm"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.ppm")! : await fs.readFile("/out.ppm"));
    expect([output.width, output.height]).toEqual([7, 5]);
    expect([...output.data.filter((_, index) => index % 4 !== 3)]).toEqual([...expected]);
});
