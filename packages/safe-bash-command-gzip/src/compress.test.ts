import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createGzipCommand } from "./index.js";
import { chunks, run } from "./test-helpers.js";

// /usr/bin/compress -c, with the payload below on stdin; includes a 9-to-10-bit transition.
const payload = Buffer.from("Unix compress stream\n".repeat(200));
const compressed = Buffer.from("H52QVdykwQNizJs2cOSUmTMHxBw6CsO0URBwYMGDCRc2fBhxYkWCBhEqZOgQYhmJFAWCxDhyo0mUHy+K1FiyY0qLITOS5HjSo0qZOl3ajJmzZc2eN1fO3PnSJ06WNHnC/Fk0atOkQI1Kdao06NGpT5cKRUoUKtOhVM2OBdtV69WyYr9yzWoVbVivW7FWPUs2bdy8cPG+9SvYbtu6fe+6NUyXL9vGa+fujaxXrdzKfwcrRvx48uXAixMfdizZMmDCoTub1jyaMmjOpTMz9nx6M2nMhUVD/owaNu7UsXOrlq2bNuvdtVvztu269+3Xz503Z75ceXLkx43PXr2d+HDhwYH/9g19uvXs3Iun/y6+fHXs3cGPj079unb13sOTl/7+Pvv99aGX33zmwYeffO7Zt55+9J0XX3v8KThgggIiGGGFEAb4IIAOHphhh/81aGCIBfrHYIkLEthfihRuKKKJKkpooYYecjjiiStOeKGLKOpII4k5zggijjJ+eGOMGNoIY4s1vsjijk32KOSRTAJZpJJP/khkkk76OCSSPAZp5JJQWsmllGNm+WWVW4Z5ZZdTkqklmFGKiaWXVJbZZp1vonlnnGrmOSebdJrp5pl2wpkmnnKuqWehexrKJ6J9Juqnor4B", "base64");

for (const args of [["-dc"], ["-fdc"], ["-t"]]) {
  test(`gzip decodes Unix compress ${args} across byte boundaries`, async () => {
    const result = await run("gzip", args, chunks(...Array.from(compressed, byte => Uint8Array.of(byte))));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, args[0] === "-t" ? Buffer.alloc(0) : payload);
  });
  test(`Unix compress observes decoded byte budget ${args}`, async () => {
    let written = 0;
    let error = "";
    const result = await createGzipCommand({ maxDecodedBytes: payload.length - 1 }).execute({
      command: "gzip", args, stdin: chunks(compressed), cwd: "/", env: {},
      fs: (await run("gzip")).fs, signal: new AbortController().signal,
      stdout: { async write(bytes) { written += bytes.length; } },
      stderr: { async write(bytes) { error += new TextDecoder().decode(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.ok(written < payload.length);
    assert.match(error, /decoded byte limit/u);
  });
}

test("forced gzip rejects malformed recognized Unix compress streams", async () => {
  for (const bytes of ["1f9d", "1f9d91", "1f9d900101", "1f9d9000fe03"]) {
    const result = await run("gzip", ["-fdc"], chunks(Buffer.from(bytes, "hex")));
    assert.equal(result.exitCode, 1, bytes);
    assert.notEqual(result.stderr, "");
  }
});

test("Unix compress handles dictionary resets and non-block dictionaries", async () => {
  for (const [hex, expected] of [
    ["1f9d90410002000000000000420202", "ABBB"],
    ["1f9d1041000604", "AAAAAA"],
    ["1f9d90", ""],
  ]) {
    const result = await run("gzip", ["-dc"], chunks(Buffer.from(hex!, "hex")));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), expected);
  }
});

test("Unix compress stops at the output budget across output chunks", async () => {
  // Seven literal A codes followed by CLEAR, repeatedly resetting a full group.
  const group = Buffer.from("418204091224481080", "hex");
  const bytes = Buffer.concat([Buffer.from("1f9d90", "hex"), ...Array<Buffer>(10000).fill(group)]);
  const decoded = await run("gzip", ["-dc"], chunks(bytes));
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.deepEqual(decoded.stdout, Buffer.alloc(70000, 65));
  let written = 0;
  let error = "";
  const result = await createGzipCommand({ maxDecodedBytes: 65536 }).execute({
    command: "gzip", args: ["-dc"], stdin: chunks(bytes), cwd: "/", env: {},
    fs: decoded.fs, signal: new AbortController().signal,
    stdout: { async write(chunk) { written += chunk.length; } },
    stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(written, 65536);
  assert.match(error, /decoded byte limit/u);
});

test("gunzip decodes a .Z file and zcat decodes stdin", async () => {
  const fs = (await run("gzip")).fs;
  await fs.writeFile("/input.Z", compressed);
  const result = await run("gunzip", ["/input.Z"], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(Buffer.from(await fs.readFile("/input")), payload);
  const cat = await run("zcat", [], chunks(compressed));
  assert.equal(cat.exitCode, 0, cat.stderr);
  assert.deepEqual(cat.stdout, payload);
});
