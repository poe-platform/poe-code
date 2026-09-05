import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import test, { after, before } from "node:test";
import { bytes, run } from "./helpers.js";
import { transferReport } from "../../../src/commands/dd/report.js";

const oracle = process.env.DD_ORACLE;
const expectedHash = process.env.DD_ORACLE_SHA256;
const absent = oracle === undefined && expectedHash === undefined;
const skip = absent ? "native dd prerequisite absent: set DD_ORACLE and DD_ORACLE_SHA256" : false;
let oracleHash: string;

async function hashOracle(): Promise<string> {
  assert.ok(oracle !== undefined);
  const metadata = lstatSync(oracle);
  assert.ok(metadata.isFile() && metadata.size > 0 && metadata.size <= 2 * 1024 * 1024, "oracle must be a bounded regular executable");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(oracle, { end: metadata.size - 1, highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest("hex");
}

before(async () => {
  if (absent) return;
  assert.ok(oracle && isAbsolute(oracle), "DD_ORACLE must be a nonempty absolute path");
  assert.ok(expectedHash?.length === 64 && [...expectedHash].every(character => "0123456789abcdefABCDEF".includes(character)), "DD_ORACLE_SHA256 must contain 64 hexadecimal digits");
  oracleHash = await hashOracle();
  assert.equal(oracleHash, expectedHash.toLowerCase(), "DD_ORACLE_SHA256 does not match the supplied executable");
  const result = native(["--version"], new Uint8Array());
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(result.stdout).split("\n")[0], "dd (coreutils) 9.7", "DD_ORACLE must report GNU coreutils 9.7");
});

after(async () => {
  if (oracleHash) assert.equal(await hashOracle(), oracleHash, "oracle bytes changed during comparison");
});

test("GNU 9.7 supplied oracle binding is authenticated independently of product output", { skip }, context => {
  context.diagnostic(`oracle=${oracle}; sha256=${oracleHash}; platform=${process.platform}; node=${process.version}; LC_ALL=C`);
});

function native(args: readonly string[], input: Uint8Array) {
  assert.ok(oracle !== undefined);
  const result = spawnSync(oracle, args, { argv0: "dd", env: { LC_ALL: "C" }, input, timeout: 2000, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  assert.equal(result.signal, null);
  return { exitCode: result.status, stdout: new Uint8Array(result.stdout), stderr: result.stderr.toString() };
}

test("GNU 9.7 differential: conversions, record boundaries and binary translation tables", { skip }, async () => {
  const inputs = [bytes("a\nABCdef\nxy"), Uint8Array.from({ length: 256 }, (_, index) => index), bytes("a   bc   xyz ")];
  const conversions = ["", "sync", "swab", "lcase", "ucase", "ascii", "ebcdic", "ibm", "block", "unblock", "sync,block", "sync,unblock", "swab,ucase", "ascii,lcase", "ebcdic,ucase", "ibm,swab,block"];
  for (const conversion of conversions) {
    for (const input of inputs) {
      const args = ["ibs=3", "obs=5", "cbs=4", "status=noxfer", ...(conversion ? [`conv=${conversion}`] : [])];
      assert.deepEqual(await run(args, input), native(args, input), `${conversion}: ${Buffer.from(input).toString("hex")}`);
    }
  }
});

test("GNU 9.7 differential: full numeric and operand selection grammar", { skip }, async () => {
  const cases = [
    ["ibs=2", "obs=3", "count=2"], ["bs=3", "ibs=1", "obs=7"], ["bs=2x2", "count=2B"],
    ["bs=2", "count=3", "iflag=count_bytes"], ["skip=2B", "ibs=3"], ["iseek=1", "ibs=3"],
    ["bs=1K", "count=0"], ["bs=KiB", "count=0"], ["bs=1kB", "count=0"], ["bs=1MB", "count=0"],
    ["bs=2x3x4", "count=0"], ["bs=+2", "count=0"], ["bs= 2", "count=0"], ["count=0x2"],
    ["bs=0"], ["count=-1"], ["count=1.2"], ["count=0x10"], ["bs=1XB"], ["count=1Q"],
    ["count=9223372036854775808"], ["oops"], ["wat=1"], ["conv="], ["conv=unknown"],
    ["iflag="], ["oflag=fullblock"], ["status=unknown"], ["conv=lcase,ucase"], ["conv=excl,nocreat"],
    ["conv=ascii,ebcdic"], ["conv=block,unblock", "cbs=2"], ["conv=block,unblock"],
    ["iflag=seek_bytes", "oflag=count_bytes", "count=0"], ["conv=ascii,block"],
    ["status=none,noxfer"], ["ibs=2", "skip=2", "iflag=skip_bytes"],
    ["bs=1p", "count=0"], ["bs=1t", "count=0"], ["bs=9223372036854775807", "count=0"],
    ["count=1x0x2"], ["bs=1cB", "count=0"],
    ["conv=nocreat"], ["count=é"], ["count=a\nb"], ["count=a'b"], ["--help=x"],
    ["conv=a\nb"], ["conv=a'b"], ["conv=é"], ["iflag=a\\b"],
    ["--", "bs=2"], ["bs=2", "--", "count=1"], ["--", "--help"], ["--"], ["-"], ["bs=2", "--", "--"],
  ];
  for (const operands of cases) {
    const args = ["status=noxfer", ...operands];
    assert.deepEqual(await run(args, bytes("abcdef\n")), native(args, bytes("abcdef\n")), JSON.stringify(args));
  }
});

test("GNU 9.7 differential: every byte of each translation table without record truncation", { skip }, async () => {
  const input = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (const conversion of ["ascii", "ebcdic", "ibm", "ascii,lcase", "ebcdic,ucase", "ibm,swab"]) {
    const args = [`conv=${conversion}`, "ibs=7", "obs=9", "status=noxfer"];
    assert.deepEqual(await run(args, input), native(args, input));
  }
});

test("GNU 9.7 transfer-report byte sizes match; measured elapsed times are not compared", { skip }, () => {
  for (const size of [999, 1000, 1024, 9999, 10239, 999499, 999999]) {
    const result = native(["iflag=fullblock", "bs=4096"], new Uint8Array(size));
    assert.equal(result.exitCode, 0);
    const transfer = result.stderr.split("\n").at(-2)!;
    assert.equal(transferReport(BigInt(size), 1000).split(" copied,")[0], transfer.split(" copied,")[0]);
  }
});
