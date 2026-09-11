import assert from "node:assert/strict";
import test from "node:test";
import { digest, readArchive, resolveTools } from "./committed-archive.mjs";

// Exercise both public constructor names with the actual npm-bundled parser.
// In-memory archive bytes keep these controls independent of package staging.
for (const exportName of ["Parse", "Parser"]) {
  test(`archive admission preserves safety with the ${exportName} tar API`, async () => {
    const { tar } = resolveTools();
    const Parser = tar.Parser ?? tar.Parse;
    const parserApi = { [exportName]: Parser };
    const archive = (path, type = "File") => {
      const payload = Buffer.from("admitted bytes");
      const header = new tar.Header({ path, type, size: type === "File" ? payload.length : 0, linkpath: type === "SymbolicLink" ? "allowed.txt" : "", mode: 0o644 });
      const bytes = Buffer.alloc(2048);
      header.encode(bytes);
      if (type === "File") payload.copy(bytes, 512);
      return bytes;
    };
    const read = (bytes, admit = () => {}, expectedHash = digest(bytes)) => readArchive(parserApi, "/control.tar", expectedHash, admit, {
      lstatSync: () => ({ isFile: () => true, size: bytes.length }),
      readFileSync: () => bytes,
    });
    const bytes = archive("allowed.txt");
    const admitted = [];
    const files = await read(bytes, path => admitted.push(path));
    assert.deepEqual(admitted, ["allowed.txt"]);
    assert.equal(files.get("allowed.txt").toString(), "admitted bytes");
    await assert.rejects(read(bytes, () => assert.fail("must authenticate first"), "0".repeat(64)), /identity changed/);
    await assert.rejects(read(bytes, () => assert.fail("unbound entry")), /unbound entry/);
    await assert.rejects(read(archive("../escape")), /nonliteral input path/);
    await assert.rejects(read(archive("link.txt", "SymbolicLink")), /nonregular archive entry/);
    const duplicate = Buffer.concat([bytes.subarray(0, 1024), bytes]);
    await assert.rejects(read(duplicate), /duplicate or excessive archive entries/);
  });
}
