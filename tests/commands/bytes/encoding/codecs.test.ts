import assert from "node:assert/strict";
import test from "node:test";
import { allBytes, run, sliced } from "./helpers.js";

const vectors = [
  ["", "", ""], ["f", "Zg==", "MY======"], ["fo", "Zm8=", "MZXQ===="],
  ["foo", "Zm9v", "MZXW6==="], ["foob", "Zm9vYg==", "MZXW6YQ="],
  ["fooba", "Zm9vYmE=", "MZXW6YTB"], ["foobar", "Zm9vYmFy", "MZXW6YTBOI======"],
] as const;

for (const [name, column] of [["base64", 1], ["base32", 2]] as const) {
  test(`${name}: RFC vectors at every split and padding boundary`, async () => {
    for (const vector of vectors) {
      const raw = Buffer.from(vector[0]);
      const encoded = vector[column];
      for (let width = 1; width <= 9; width++) {
        assert.equal((await run(name, ["-w0"], sliced(raw, width))).stdout, encoded);
        const decoded = await run(name, ["--decode"], sliced(Buffer.from(encoded), width));
        assert.equal(decoded.exitCode, 0, decoded.stderr);
        assert.deepEqual(decoded.bytes, raw);
      }
    }
  });

  test(`${name}: all 256 values roundtrip across sliced chunks`, async () => {
    const encoded = await run(name, [], sliced(allBytes, 7));
    assert.equal(encoded.exitCode, 0);
    assert(encoded.stdout.endsWith("\n"));
    assert(encoded.stdout.trimEnd().split("\n").every(line => line.length <= 76));
    assert.deepEqual((await run(name, ["-d"], sliced(encoded.bytes, 3))).bytes, Buffer.from(allBytes));
    if (name === "base64") assert.equal((await run(name, ["-w0"], allBytes)).stdout, Buffer.from(allBytes).toString("base64"));
  });

  test(`${name}: wrapping, aliases, LF and ignore-garbage`, async () => {
    const encoded = vectors[6][column];
    assert.equal((await run(name, ["--wrap=1"], "foobar")).stdout, [...encoded].join("\n") + "\n");
    assert.equal((await run(name, ["-w", "4"], "foobar")).stdout, encoded.match(/.{1,4}/gu)!.join("\n") + "\n");
    assert.equal((await run(name, ["-di"], ` \t${encoded}\r\n!`)).stdout, "foobar");
    assert.equal((await run(name, ["-d"], `\n${encoded}\n`)).stdout, "foobar");
    assert.equal((await run(name, ["-d"], ` ${encoded}`)).exitCode, 1);
    assert.equal((await run(name, ["--decode", "--ignore-garbage"], `!${encoded}`)).stdout, "foobar");
  });

  test(`${name}: invalid flags and operands fail before reading`, async () => {
    for (const args of [["--unknown"], ["-w"], ["-w-1"], ["-w1.5"], ["-w9007199254740992"], ["-wbad", "-w0"], ["--decode=yes"], ["one", "two"]]) {
      const result = await run(name, args, { async *[Symbol.asyncIterator]() { throw new Error("input read before validation"); } });
      assert.equal(result.exitCode, 2, `${args}: ${result.stderr}`);
      assert.equal(result.stdout, "");
    }
  });

  test(`${name}: malformed blocks fail with GNU-compatible partial output`, async () => {
    const invalid = name === "base64"
      ? ["A", "Zg=", "=g==", "Z===", "Zg=A", "Zg===", "Zh==", "Zm9=", "Zm!v", "Zm9v\r"]
      : ["M", "MY=====", "=Y======", "M=======", "MY=====A", "MY=======", "MZ======", "MZXW7===", "mzxw6===", "MZX!6==="];
    for (const text of invalid) for (const width of [1, 3, 100]) {
      const result = await run(name, ["-d"], sliced(Buffer.from(text), width));
      assert.equal(result.exitCode, 1, text);
      assert.match(result.stderr, /invalid input/u);
    }
    const valid = vectors[3][column];
    const result = await run(name, ["-d"], valid + "!");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "foo");
    assert.equal((await run(name, ["-d"], name === "base64" ? "Zh==" : "MZ======")).stdout, "f");
    const unpadded = await run(name, ["-d"], name === "base64" ? "Zg" : "MY");
    assert.equal(unpadded.exitCode, 0);
    assert.equal(unpadded.stdout, "f");
  });

  test(`${name}: independently padded blocks concatenate`, async () => {
    assert.equal((await run(name, ["-d"], vectors[1][column] + vectors[2][column])).stdout, "ffo");
  });
}
