import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { runVirtual } from "./helpers.js";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem } from "./helpers.js";

const fixtures = [
  [String.raw`BEGIN { s="abc abc"; print gensub(/(a)(bc)/,"\\2-\\1",2,s), s }`, "abc bc-a abc abc\n"],
  [String.raw`BEGIN { print gensub(/a/,"X","g","banana") }`, "bXnXnX\n"],
  [`BEGIN { print (systime() > 0) }`, "1\n"],
  [`BEGIN { print strftime("%Y-%m-%d %H:%M:%S",0,1); print mktime("1970 01 01 00 00 00",1) }`, "1970-01-01 00:00:00\n0\n"],
  [`BEGIN { a["z"]=3; a["a"]=1; a["b"]=2; print asort(a,b), b[1],b[2],b[3],a["z"]; print asorti(a),a[1],a[2],a[3] }`, "3 1 2 3 3\n3 a b z\n"],
  [`BEGIN { print and(7,3),or(4,1),xor(7,3),lshift(1,33),rshift(8589934592,33); printf "%.0f\\n", compl(0) }`, "3 5 4 8589934592 1\n9007199254740991\n"],
  [String.raw`BEGIN { print gensub(/a/,"\\n","g","a"),gensub(/a/,"\\t","g","a") }`, "n t\n"],
  [`BEGIN { print mktime("1970 01 01 00 00 60",1),mktime("invalid",1); a[1]="10";a[2]=2; print asort(a),a[1],a[2] }`, "60 -1\n2 2 10\n"],
] as const;

test("awk bounds shifts at the integer word width", async () => {
  // Older gawk versions perform undefined C shifts here and warn under --lint;
  // current gawk and our bounded implementation return zero. Keep this boundary
  // explicit instead of comparing it with an unqualified system executable.
  const result = await runVirtual("awk", { args: ["BEGIN { print lshift(1,64),rshift(1,64) }"] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "0 0\n");
});

for (const [program, expected] of fixtures) {
  test(`awk builtin ${program}`, async () => {
    const result = await runVirtual("awk", { args: [program] });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), expected);
  });
}

test("AWK builtin fixtures match GNU awk", { skip: spawnSync("gawk", ["--version"]).status !== 0 }, () => {
  for (const [program, expected] of fixtures) {
    const result = spawnSync("gawk", [program], { input: "", encoding: "utf8", env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 1000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected, program);
  }
});

test("mktime honors virtual timezone, DST selection, and normalized calendar fields", async () => {
  const shell = new Shell({ fs: await makeFileSystem(), env: { TZ: "America/New_York" } }).use(textProgramCommands());
  try {
    const result = await shell.exec(`awk 'BEGIN { printf "%.0f %.0f %.0f\\n",mktime("2024 07 01 12 00 00 -1"),mktime("2024 07 01 12 00 00 0"),mktime("2024 07 01 12 00 00 1"); printf "%.0f\\n",mktime("2024 03 10 02 30 00 -1") }'`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1719849600 1719853200 1719849600\n1710055800\n");
  } finally { await shell.dispose(); }
});
