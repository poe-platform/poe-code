import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { captureCase, sha256, executable, environment } from "../independent-increment/native.mjs";

const directory = "tests/commands/structured-stress/jq-42-author-20260827";
const before = JSON.parse(readFileSync(`${directory}/before.json`, "utf8"));
const cases = [];
for (const vector of before.results) {
  const captured = await captureCase(vector.stages ? { ...vector, stages: vector.stages.map(stage => stage.argv) } : vector);
  for (const field of ["status", "stdoutHex", "stderrHex"]) assert.equal(captured.expected[field], vector.expected[field], `${vector.id} ${field}`);
  cases.push(captured);
}
const regressions = [];
const add = (id, argv, input) => regressions.push({ id, argv, inputHex: Buffer.from(input).toString("hex") });
for (const flags of ["-c", "-ce"]) {
  for (const tail of ["false", "null", "[]", "[\"ok\"]"]) add(`status-${flags}-${tail}`, [flags, "if . == [] then empty elif . == false then false elif . == null then null else join(\"/\") end"], `[{}]\n${tail}`);
}
add("generator-aborts-only-current-input", ["-c", 'join(("/",1/0,"!"))'], '["é","😀"]\n["a","b"]\n');
add("recover-file-line-names", ["-c", 'join("/")', "first.txt", "second.txt"], "");
regressions.at(-1).files = { "first.txt": Buffer.from('[{}]\n["a"]\n').toString("hex"), "second.txt": Buffer.from('[{}]\n["b"]\n').toString("hex") };
add("parse-prefix-unfinished", ["-c", "."], '"é"\n{\n');
add("literal-newlines-and-tab", ["-nc", '"a\nb\tc"'], "");
add("json-control-tab", ["-c", "."], '"a\tb"');
add("json-control-nul", ["-c", "."], '"a\0b"');
add("fromjson-unfinished", ["-c", "fromjson"], '"{"\n"["\n"true"');
add("fromjson-valid-precision", ["-c", "fromjson | [.,tojson]"], JSON.stringify('{"10":9007199254740993,"2":12.3400,"x":1e9999}'));
add("order-through-entries", ["-c", "to_entries | from_entries"], '{"10":9007199254740993,"2":12.3400,"x":1e9999}');
add("object-from-entries", ["-c", "from_entries"], '{"b":{"key":"10","value":12.3400},"a":{"key":"2","value":9007199254740993}}');
add("quantifier-object-empty", ["-c", "[any(empty),all(empty),any(.[];empty),all(.[];empty)]"], '{"10":1,"2":false}');
add("decimal-copy-sort", ["-c", "[.,sort,unique,map(tostring)]"], '[9007199254740993,9007199254740992,12.3400,1e9999]');
add("division-decimal-error", ["-c", ". / 0"], '12.3400\n9007199254740993');
add("sort-number-error", ["-c", "sort"], '12.3400');
for (const [id, hex] of Object.entries({ surrogate: "eda080", overlong: "e08080", oversized: "f4908080", continuation: "80", truncated: "e282", broken: "e241", invalidlead: "c080" })) {
  add(`utf8-${id}`, ["-Rc", "."], Buffer.from(`61${hex}0a62`, "hex"));
  add(`json-utf8-${id}`, ["-c", "."], Buffer.from(`2261${hex}220a226222`, "hex"));
}
add("low-surrogate-pair", ["-c", "."], '"\\udead\\udfff"');
add("valid-surrogate-pair", ["-c", "."], '"\\ud83d\\ude00"');
add("high-surrogate-followed-ascii", ["-c", "."], '"\\ud800a"');
for (const vector of regressions) {
  const captured = await captureCase(vector);
  Object.assign(vector, captured);
}
const document = { capturedAt: new Date().toISOString(), executable, executableSha256: sha256(readFileSync(executable)), version: spawnSync(executable, ["--version"], { encoding: "utf8", env: environment }).stdout.trim(), build: spawnSync(executable, ["--build-configuration"], { encoding: "utf8", env: environment }).stdout.trim(), environment, originalAndWholeCohortsVerified: cases.length, cases, regressions };
const target = `${directory}/native-before.json`;
assert.equal(existsSync(target), false);
const content = JSON.stringify(document, null, 2);
const patch = `*** Begin Patch\n*** Add File: ${target}\n${content.split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
assert.equal(spawnSync("apply_patch", [], { input: patch, encoding: "utf8", maxBuffer: 1024 * 1024 }).status, 0);
console.log({ verified: cases.length, regressions: regressions.length, executable: document.executable, version: document.version, hash: document.executableSha256, evidenceHash: sha256(Buffer.from(content + "\n")) });
