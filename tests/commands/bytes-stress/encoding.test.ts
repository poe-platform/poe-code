import assert from "node:assert/strict";
import test from "node:test";
import { bytes, chunks, native, nativePrograms, run } from "./helpers.js";

const vectors = [
  ["", "", ""], ["f", "Zg==", "MY======"], ["fo", "Zm8=", "MZXQ===="],
  ["foo", "Zm9v", "MZXW6==="], ["foob", "Zm9vYg==", "MZXW6YQ="],
  ["fooba", "Zm9vYmE=", "MZXW6YTB"], ["foobar", "Zm9vYmFy", "MZXW6YTBOI======"],
] as const;

function wrapped(text: string, width: number): string {
  if (!width || !text) return text;
  const lines: string[] = [];
  for (let offset = 0; offset < text.length; offset += width) lines.push(text.slice(offset, offset + width));
  return lines.join("\n") + "\n";
}

for (const [name, column] of [["base64", 1], ["base32", 2]] as const) {
  test(`${name}: independent RFC 4648 literals at every byte split and wrap`, async () => {
    for (const vector of vectors) for (const width of [0, 1, 2, 5, 7, 76]) {
      const actual = await run(name, ["-w", String(width)], chunks(Buffer.from(vector[0]), 1));
      assert.equal(actual.exitCode, 0); assert.equal(actual.stdout.toString(), wrapped(vector[column], width));
      for (let split = 1; split <= Math.max(1, vector[column].length); split++) {
        const decoded = await run(name, ["-d"], chunks(Buffer.from(vector[column]), split));
        assert.equal(decoded.exitCode, 0); assert.equal(decoded.stdout.toString(), vector[0]);
      }
    }
  });

  test(`${name}: Python standard-library binary oracle replaces no GNU evidence`, { skip: !nativePrograms.python }, async () => {
    const encode = name === "base64" ? "import base64,sys;sys.stdout.buffer.write(base64.b64encode(sys.stdin.buffer.read()))" : "import base64,sys;sys.stdout.buffer.write(base64.b32encode(sys.stdin.buffer.read()))";
    const decode = name === "base64" ? "import base64,sys;sys.stdout.buffer.write(base64.b64decode(sys.stdin.buffer.read(),validate=True))" : "import base64,sys;sys.stdout.buffer.write(base64.b32decode(sys.stdin.buffer.read()))";
    for (const length of [0, 1, 4, 5, 31, 57, 58, 255, 4097, 65539]) {
      const data = bytes(length);
      const expected = await native(nativePrograms.python, ["-c", encode], data);
      assert.equal(expected.exitCode, 0, expected.stderr.toString());
      for (const width of [0, 7, 76, 101]) {
        const actual = await run(name, ["-w", String(width)], chunks(data, 13));
        assert.equal(actual.stdout.toString(), wrapped(expected.stdout.toString(), width));
      }
      const decoded = await run(name, ["-d"], chunks(expected.stdout, 3));
      assert.equal(decoded.exitCode, 0); assert.deepEqual(decoded.stdout, data);
      const referenceDecoded = await native(nativePrograms.python, ["-c", decode], expected.stdout);
      assert.equal(referenceDecoded.exitCode, 0); assert.deepEqual(referenceDecoded.stdout, data);
    }
  });

  test(`${name}: malformed quantum mutation matrix preserves GNU 9.7 output prefixes`, async () => {
    const canonical = name === "base64" ? "Zg==" : "MY======";
    const noncanonical = name === "base64" ? "Zh==" : "MZ======";
    const malformed = [[canonical.slice(1), ""], [canonical.slice(0, -1), name === "base64" ? "f" : ""],
      ["=" + canonical.slice(1), ""], [canonical.slice(0, -1) + "A", "f"], [noncanonical, "f"]] as const;
    for (const [value, expected] of malformed) for (const width of [1, 2, 5, 8192]) for (const args of [["-d"], ["-di"]]) {
      const result = await run(name, args, chunks(Buffer.from(value), width));
      assert.equal(result.exitCode, 1, `${name} ${value}`); assert.equal(result.stdout.toString(), expected);
    }
    for (const garbage of [0, 9, 13, 32, 33, 127, 128, 255]) {
      const input = Buffer.concat([Buffer.from(canonical), Buffer.from([garbage]), Buffer.from(canonical)]);
      const strict = await run(name, ["-d"], chunks(input, 1));
      assert.equal(strict.exitCode, 1); assert.equal(strict.stdout.toString(), "f");
      const ignored = await run(name, ["-di"], chunks(input, 2));
      assert.equal(ignored.exitCode, 0); assert.equal(ignored.stdout.toString(), "ff");
    }
  });
}

test("installed BSD base64 validates binary content and its own wrap dialect", { skip: !nativePrograms.base64 }, async context => {
  const probe = await native(nativePrograms.base64, ["--help"]);
  if (!probe.stdout.toString().includes("--break") && !probe.stderr.toString().includes("--break")) { context.skip("installed base64 does not expose the BSD wrap dialect"); return; }
  const data = bytes(65539);
  for (const width of [1, 5, 19, 76]) {
    const expected = await native(nativePrograms.base64, ["-b", String(width)], data);
    const actual = await run("base64", ["-w", String(width)], chunks(data, 127));
    assert.equal(expected.exitCode, 0); assert.deepEqual(actual.stdout, expected.stdout);
  }
  const encoded = await run("base64", ["-w0"], data);
  const decoded = await native(nativePrograms.base64, ["-D"], encoded.stdout);
  assert.equal(decoded.exitCode, 0); assert.deepEqual(decoded.stdout, data);
});

test("xxd tiny-width odd group and displaced address matrix matches installed Vim", { skip: !nativePrograms.xxd }, async () => {
  const data = bytes(513);
  for (const columns of [1, 5, 7, 17]) for (const grouping of [0, 1, 2, 4, 7, 16]) {
    const args = ["-c", String(columns), "-g", String(grouping), "-s3", "-l61", "-o19"];
    const expected = await native(nativePrograms.xxd, args, data);
    const actual = await run("xxd", args, chunks(data, 5));
    assert.equal(expected.exitCode, 0); assert.equal(actual.exitCode, 0); assert.deepEqual(actual.stdout, expected.stdout, args.join(" "));
  }
});

test("od endian and signed byte properties use independent DataView decoding", async () => {
  const input = Buffer.from([0, 127, 128, 255, 1, 2, 3, 4, 254, 255, 255, 255, 5]);
  for (const endian of ["little", "big"]) for (const size of [1, 2, 4, 8]) for (const signed of [false, true]) {
    const padded = Buffer.alloc(Math.ceil(input.length / size) * size); input.copy(padded);
    const values: string[] = [];
    for (let offset = 0; offset < padded.length; offset += size) {
      const view = new DataView(padded.buffer, padded.byteOffset + offset, size);
      const little = endian === "little";
      const value = size === 1 ? signed ? view.getInt8(0) : view.getUint8(0) : size === 2 ? signed ? view.getInt16(0, little) : view.getUint16(0, little) : size === 4 ? signed ? view.getInt32(0, little) : view.getUint32(0, little) : signed ? view.getBigInt64(0, little) : view.getBigUint64(0, little);
      values.push(String(value));
    }
    const result = await run("od", ["-An", "-v", "-w16", `-t${signed ? "d" : "u"}${size}`, `--endian=${endian}`], chunks(input, 3));
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(result.stdout.toString().trim().split(/\s+/u), values);
  }
});
