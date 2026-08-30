import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { caseHash, coreutilsCases, dialectCases } from "./gnu-cases.js";
import { native } from "./helpers.js";

const gzip = process.env.BYTE_GNU_GZIP;
const coreutils = process.env.BYTE_GNU_COREUTILS_DIR;
assert(gzip && coreutils, "Set BYTE_GNU_GZIP and BYTE_GNU_COREUTILS_DIR to the pinned temporary builds");
const programs = Object.fromEntries(["base64", "base32", "sha256sum", "sha1sum", "md5sum"].map(name => [name, join(coreutils, name)]));
programs.gzip = gzip;
const identities: Record<string, { version: string; sha256: string }> = {};
for (const [name, program] of Object.entries(programs)) {
  const result = await native(program, ["--version"]);
  assert.equal(result.exitCode, 0);
  const version = result.stdout.toString().split("\n")[0]!;
  assert.equal(version, name === "gzip" ? "gzip 1.14" : `${name} (GNU coreutils) 9.7`);
  identities[name] = { version, sha256: createHash("sha256").update(await readFile(program)).digest("hex") };
}
const observations = [];
for (const value of [...dialectCases, ...coreutilsCases()]) {
  const result = await native(programs[value.command], value.args, value.input, value.files ? { files: value.files } : {});
  observations.push({ name: value.name, caseSha256: caseHash(value), exitCode: result.exitCode, stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() });
}
const appleVersion = await native("/usr/bin/gzip", ["--version"]);
assert.equal(Buffer.concat([appleVersion.stdout, appleVersion.stderr]).toString().trim(), "Apple gzip 479");
const apple = [];
for (const value of dialectCases) {
  const result = await native("/usr/bin/gzip", value.args, value.input);
  apple.push({ name: value.name, caseSha256: caseHash(value), exitCode: result.exitCode, stdoutHex: result.stdout.toString("hex"), stderr: result.stderr.toString() });
}
console.log(JSON.stringify({
  captured: "2026-08-26", platform: `${platform()} ${release()} ${arch()}`, node: process.version,
  archives: {
    gzip: { version: "1.14", sha256: "01a7b881bd220bfdf615f97b8718f80bdfd3f6add385b993dcf6efd14e8c0ac6", signer: "155D3FC500C834486D1EEA677FD9FCCB000BEEEE" },
    coreutils: { version: "9.7", sha256: "e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf", signer: "6C37DC12121A5006BC1DB804DF6FD971306037D9" },
  },
  identities, observations, apple: { version: "Apple gzip 479", sha256: createHash("sha256").update(await readFile("/usr/bin/gzip")).digest("hex"), observations: apple },
}, null, 2));
