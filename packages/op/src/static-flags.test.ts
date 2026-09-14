import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, parseOpFileMode } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";
import { createOp } from "./index.js";

const grammars = [
  { paths: ["user suspend"], flag: "deauthorize-devices-after", valid: ["0", "-1h", "+1h", "1.5s", ".5h", "1.h", "1h30m", "1ns", "1μs", "-9223372036854775808ns", "9223372036854775808ns9223372036854775808ns"], invalid: ["", "1", "1 h", "1H", "1d", "1w", "9223372036854775808ns"] },
  { paths: ["user edit", "vault edit"], flag: "travel-mode", valid: ["on", "off"], invalid: ["ON", "Off", " on ", "true", "", "1"] },
  { paths: ["vault create"], flag: "allow-admins-to-manage", valid: ["true", "false", "TRUE", "FALSE", "True", "False", "t", "f", "T", "F", "1", "0"], invalid: ["tRuE", "fAlSe", " true ", "yes", ""] },
  { paths: ["item create"], flag: "ssh-generate-key", valid: ["ed25519", "Ed25519", "ED25519", "rsa", "RSA", "rsa2048", "RSA3072", "rsa4096", "rsa-2048", "rsa-3072", "RSA-4096", "rSa2048"], invalid: ["rsa1024", "rsa-1024", " rsa ", "rsa 2048", "rsa--2048", "rsa_2048", "ed-25519", "ed25519\n", ""] },
  { paths: ["read", "inject", "document get", "item template get"], flag: "file-mode", valid: ["600", "0600", "000", "07777", "010000", "0000000600", "37777777777"], invalid: ["0", "1", "0o600", "0x180", "384", "-1", "+600", " 600 ", "", "40000000000"] },
];

async function execute(path: string, flag: string, values: readonly string[]) {
  const calls: string[] = [];
  let received: unknown;
  let error = "";
  const args = path === "read" ? ["op://synthetic/item/password"] : path === "inject" || path === "item create" ? [] : ["synthetic"];
  const result = await createOpCommand({
    authorize(request) { calls.push("authorize"); received = request.flags[flag]; return "allow"; },
    backend: { async execute(request) { calls.push("backend"); assert.equal(request.flags[flag], received); return path === "document get" ? new Uint8Array() : {}; } },
  }).execute({
    args: [...path.split(" "), ...args, ...values], env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write() { calls.push("stdout"); } },
    stderr: { async write(data) { error += Buffer.from(data); } },
  });
  return { ...result, calls, received, error };
}

for (const grammar of grammars) for (const path of grammar.paths) {
  test(`${path} validates --${grammar.flag} before authorization or acquisition`, async () => {
    for (const value of [...grammar.invalid, "synthetic-private"]) {
      for (const flags of [[`--${grammar.flag}=${value}`], [`--${grammar.flag}`, value], [`--${grammar.flag}=${value}`, `--${grammar.flag}=${grammar.valid[0]}`]]) {
        const result = await execute(path, grammar.flag, flags);
        assert.equal(result.exitCode, 1, JSON.stringify({ path, flags, result }));
        assert.deepEqual(result.calls, []);
        assert.equal(result.error.includes("synthetic-private"), false);
      }
    }
  });

  test(`${path} completion rejects consumed invalid --${grammar.flag} values`, () => {
    for (const value of grammar.invalid) for (const flags of [[`--${grammar.flag}=${value}`], [`--${grammar.flag}`, value]]) {
      assert.deepEqual(resolveOpCompletion([...path.split(" "), ...flags, "--"]), { candidates: [], directive: 0 });
    }
  });

  test(`${path} preserves accepted --${grammar.flag} labels and omission`, async () => {
    for (const value of grammar.valid) {
      const result = await execute(path, grammar.flag, [`--${grammar.flag}=${value}`]);
      assert.equal(result.exitCode, 0, result.error);
      assert.equal(result.received, value);
      assert.equal(result.calls.filter(call => call === "backend").length, 1);
      assert.equal(resolveOpCompletion([...path.split(" "), `--${grammar.flag}=${value}`, "--"]).directive, 4);
    }
    assert.equal((await execute(path, grammar.flag, [])).received, undefined);
  });
}

test("file mode helper accepts native octal uint32 range and minimum width", () => {
  assert.equal(parseOpFileMode(undefined), 0o600);
  assert.equal(parseOpFileMode("000"), 0);
  assert.equal(parseOpFileMode("010000"), 0o10000);
  assert.equal(parseOpFileMode("37777777777"), 0xffffffff);
  for (const value of ["0", "77", "40000000000", "08x"]) assert.throws(() => parseOpFileMode(value));
});

test("public read forwards parsed file modes to its host without changing backend flags", async () => {
  for (const [value, mode] of [["000", 0], ["010000", 0o10000], ["37777777777", 0xffffffff]] as const) {
    let written = false;
    let error = "";
    const result = await createOp({ authorize(request) { assert.equal(request.flags["file-mode"], value); return "allow"; }, backend: { async execute() { return "synthetic"; } } }).execute({
      args: ["read", "op://synthetic/item/password", "--out-file=synthetic", `--file-mode=${value}`],
      env: {}, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
      stdout: { async write() { assert.fail("file output must not use stdout"); } },
      stderr: { async write(data) { error += Buffer.from(data); } },
      async writeFile(path, bytes, options) {
        written = true;
        assert.equal(path, "synthetic");
        assert.equal(Buffer.from(bytes).toString(), "synthetic");
        assert.deepEqual(options, { mode, overwrite: false });
      },
    });
    assert.equal(result.exitCode, 0, error);
    assert.equal(written, true);
  }
});
