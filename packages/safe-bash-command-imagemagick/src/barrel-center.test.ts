import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAIAAACJJmN7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6NTk6NTgrMDA6MDBAybJ6AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwMZQKxgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMGaBKxkAAAA5SURBVCjPY2RgEOFlYuBlYuBleg1jiBIjwsLEz8DERA6iSOdrGEcUxiBKZIBcS5oj4SKjYTu8whYAfS4XOob+v0EAAAAASUVORK5CYII=", "base64"));
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -distort Barrel '0.45 0 0 4 5' out.png.
const native = decodeImage(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAMAAAAxmgQeAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAALuUExURQ0TChoYACQciywe/zUf/z0g/0cf1FIdFV8ZAHEWmYgW7akZPNQgruskI+okD+okFBMiLB0mUSYpkC4rozYspD4ss0ctuVEsRl0qEm0nToIj/58fUscgqugjQusjDhcu9CAx8CgzZzA1CTc2Cj83Ckc3IVA3uVw31Gs2oH801Zoya78wkOYsYusmC+ojD+ojEuojExk5/yI6+io8WDE9ADg/C0BABkdAClFBs1tC/2pC/31COJhDWrxEsOZFbO8+OOw1H+stE+soDuolDRtC/yRE9StFWDJGAzlHD0FIC0hJClFKpFxL/2pN/31PRZdSVLtWuedbkPNa//FX7PBUy/BPre9KkRxL/yVM8yxNWjROADtPA0JQAElRCVJTo11V/2tY/39cSplhWb1oqOpxhfZ1l/V4f/Z7a/p/ZP+EbxxUpSZVqC1VejVWWjxYWENZWEtbZ1RckF9fi25jbIJpyp5xk8N7ee+IcfqRDv+ZQfuki82wtIy/qB1eCSZeJS5eqDZf8z1g9UVi+k1k8FZnUWNrAHJwFoh59KWDgMyRbf6hr/Kv2Jm94z7QmA3jSgDwHxxpESZoCS9ppTdp/z9q/0ds/1Bv9FpzLGd4AXmAVZCL5a+Yx9qqT5S+xyzRlAHlNQDzEAH3DQX3EBt4GSZ2ADB1izh2/0F3/0l5/1N9z1+CJW6KVIGUSpuhSb+z3LTKcQ7hMADxEgL3DQb3EQb2FBmK5SaHvzCGnzqGiEOHh02KcFmPoWaW5Xeg8Y2tPqq+N9nVqXbsgQD2DwT3EBij1yWf/zGc1DycCUeeAVOhBmCotHCx1IO9z53O0L3hONjwsC73QAD3DhrFGiO/NTK8Rz+7sEy9u1rCr2rKMXzUIpPf2a7ootnvZ431kwX2FwP2ERzTDyDTDDHVEULX3VHZ/2LcqnPgBIjkbqHo8MHsRdTyri72QgD2DQX2ExzSFB3TEizVDUDYtVPb/2feZXzhEpXl3rLphd/vf3T1fwL2E4SbApoAAAAHdElNRQfqCwcKAA3iKmKHAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwQMmyegAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMDGUCsYAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MDA6MTMrMDA6MDB3FB0PAAABLElEQVQY02NgYGRiZmFlY+fg5OLm4eXjBwIGAUEhYRFRMXEJSSlpGVk5sJi8gqKSsoqqmrqGppa2jq6evgE/g6GRsYmpmbmFpZW1ja2dvYOjkzODi6ubu4enl7ePr59/QGBQcEhoGEN4RGRUdExsXHxCYlJySmpaekYmQ1Z2Tm5efkFhUXFJaVl5RWVVdQ1DbV19Q2NTc0trW3tHZ1d3T29fP8OEiZMmT5k6bfqMmbNmz5k7b/6ChYsYFi9Zumz5ipWrVq9Zu279ho2bNm/ZwrB12/YdO3ft3rN33/4DBw8d3gIEDEeOHjt+4uSp02fOnjt/4eIWsNily1euXrt+4+at23fu3rsPEXvw8NHjJ0+fPX/x8tXrN28hYu/ef/j46fOXr9++//gJUbYFACs4jTUhg+BYAAAAAElFTkSuQmCC", "base64")));

it.each([false, true].flatMap(retained => ["-distort", "+distort"].map(operator => ({ retained, operator }))))("derives Barrel scale before the explicit center, $operator retained=$retained", async ({ retained, operator }) => {
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    const outputs = [];
    for (const coefficients of ["0.45 0 0 4 5", "0.45 0 0 0.55 4 5"]) {
        const args = ["/input.png", operator, "Barrel", coefficients, "/out.png"];
        let stderr = "";
        const result = retained ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : await runMagickCli(args, backend);
        expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(0);
        outputs.push(decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!));
    }
    expect(outputs[0]!.data).toEqual(outputs[1]!.data);
    for (const output of outputs) {
        expect([output.width, output.height]).toEqual([native.width, native.height]);
        expect(output.data).toEqual(native.data);
    }
});

it.each([false, true])("preserves Barrel's omitted default-center scale, retained=%s", async retained => {
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    const outputs = [];
    for (const coefficients of ["0.45 0 0", "0.45 0 0 0.55"]) {
        const result = await runMagickCli(["/input.png", "-distort", "Barrel", coefficients, "/out.png"], backend);
        expect(result.exitCode, result.stderr).toBe(0);
        outputs.push(decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!));
    }
    expect(outputs[0]!.data).toEqual(outputs[1]!.data);
});
