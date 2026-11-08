import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { encode } from "./common.mjs";

export async function transportControls(baselineRoot) {
  const library = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href);
  const rows = [];
  for (const [name, input] of [["invalid-utf8", Buffer.from([128, 255])], ["utf8", Buffer.from("é😀")], ["nul-ascii", Buffer.from([0, 65, 10])]]) {
    for (const script of ["cat", "cat | base64", "cat > output"]) {
      const fs = new library.InMemoryFs();
      const shell = new library.Bash({ fs, cwd: "/" });
      const result = await shell.exec(script, { stdin: input.toString("latin1"), stdinKind: "bytes", rawScript: true });
      const bytes = Buffer.from(library.latin1FromBytes(library.stdoutAsBytes(result)), "latin1");
      const expected = script === "cat" ? input : script === "cat | base64" ? Buffer.from(input.toString("base64") + "\n") : Buffer.alloc(0);
      rows.push({ name, script, input: encode(input), expected: encode(expected), stdout: encode(bytes),
        publicStdoutCodepoints: [...result.stdout].map(character => character.codePointAt(0)), stdoutKind: result.stdoutKind ?? null, stdoutEncoding: result.stdoutEncoding ?? null,
        exitCode: result.exitCode, stderr: result.stderr, pass: bytes.equals(expected) && result.exitCode === 0 && result.stderr === "",
        ...(script === "cat > output" ? { output: encode(await fs.readFileBuffer("/output")), fileBytesMatch: Buffer.from(await fs.readFileBuffer("/output")).equals(input) } : {}) });
    }
  }
  return { rows, interpretation: "Uninstrumented public API controls. stdinKind=bytes is confirmed by internal base64 and VFS bytes. Public stdoutAsBytes conversion follows exported stdoutKind/stdoutEncoding rather than guessing. A missing byte tag can cause terminal invalid-UTF8 mismatch while internal pipes/files remain correct. Such failures are API-boundary evidence, not proof cat/base64 internally corrupt bytes. No corrective encoding heuristic is applied." };
}
