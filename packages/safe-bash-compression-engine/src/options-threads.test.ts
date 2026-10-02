import assert from "node:assert/strict";
import test from "node:test";
import { createOptionsParser, formats, parseOptions } from "./options.js";

test("Zstandard accepts automatic and single thread selection", () => {
  for (const args of [["-T0"], ["-T", "0"], ["--threads=0"], ["--threads", "0"], ["-T1"]]) assert.doesNotThrow(() => parseOptions("zstd", args));
  assert.throws(() => parseOptions("zstd", ["-T2"]));
});

test("xz, zstd, and bzip2 accept -z and --compress while gzip rejects -z", () => {
  const parseXz = createOptionsParser([{ ...formats.xz, format: "xz", names: ["xz", "unxz", "xzcat"] }]);
  for (const args of [["-z", "-k", "bundle.tar"], ["--compress", "-k", "bundle.tar"], ["-d", "-z", "bundle.tar"]]) {
    const xzOpts = parseXz("xz", args);
    assert.equal(xzOpts.decompress, false);
    assert.equal(xzOpts.test, false);
    const zstdOpts = parseOptions("zstd", args);
    assert.equal(zstdOpts.decompress, false);
    const bzip2Opts = parseOptions("bzip2", args);
    assert.equal(bzip2Opts.decompress, false);
  }
  assert.throws(() => parseOptions("gzip", ["-z"]));
});
