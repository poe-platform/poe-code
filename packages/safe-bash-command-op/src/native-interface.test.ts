import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, type OpCommandContext } from "./cli.js";
import { opCommandCatalog, opGlobalFlags } from "./catalog.js";

type NativeKind = "string" | "boolean" | "optional" | "array" | "csv";
type NativeFlags = Readonly<Record<string, readonly [NativeKind, string?]>>;
interface NativeLeaf { path: string; aliases: readonly string[]; flags: NativeFlags }

const nativeOracle = {
  version: "2.39.0",
  binarySha256: "f48b97df4dfdccc67483587b40a596f70881eac05a576de7b7775d267375757a",
  evidence: "out/op-oracle/evidence/native-command-tree.json",
};

const nativeLeaves: readonly NativeLeaf[] = [
  {"path":"completion","aliases":[],"flags":{}},
  {"path":"inject","aliases":[],"flags":{"file-mode":["string"],"force":["boolean","f"],"in-file":["string","i"],"out-file":["string","o"]}},
  {"path":"read","aliases":[],"flags":{"file-mode":["string"],"force":["boolean","f"],"no-newline":["boolean","n"],"out-file":["string","o"]}},
  {"path":"run","aliases":[],"flags":{"env-file":["array"],"no-masking":["boolean"]}},
  {"path":"signin","aliases":[],"flags":{"force":["boolean","f"],"raw":["boolean"]}},
  {"path":"signout","aliases":[],"flags":{"all":["boolean"],"forget":["boolean"]}},
  {"path":"update","aliases":[],"flags":{"channel":["string"],"directory":["string"]}},
  {"path":"whoami","aliases":[],"flags":{}},
  {"path":"account add","aliases":[],"flags":{"address":["string"],"email":["string"],"raw":["boolean"],"shorthand":["string"],"signin":["boolean"]}},
  {"path":"account get","aliases":[],"flags":{}},
  {"path":"account list","aliases":["ls"],"flags":{}},
  {"path":"account forget","aliases":[],"flags":{"all":["boolean"]}},
  {"path":"document create","aliases":[],"flags":{"file-name":["string"],"tags":["csv"],"title":["string"],"vault":["string"]}},
  {"path":"document get","aliases":[],"flags":{"file-mode":["string"],"force":["boolean"],"include-archive":["boolean"],"out-file":["string","o"],"vault":["string"]}},
  {"path":"document edit","aliases":[],"flags":{"file-name":["string"],"tags":["csv"],"title":["string"],"vault":["string"]}},
  {"path":"document delete","aliases":["remove","rm"],"flags":{"archive":["boolean"],"vault":["string"]}},
  {"path":"document list","aliases":["ls"],"flags":{"include-archive":["boolean"],"vault":["string"]}},
  {"path":"events-api create","aliases":[],"flags":{"expires-in":["string"],"features":["csv"]}},
  {"path":"group create","aliases":[],"flags":{"description":["string"]}},
  {"path":"group get","aliases":[],"flags":{}},
  {"path":"group edit","aliases":[],"flags":{"description":["string"],"name":["string"]}},
  {"path":"group delete","aliases":["remove","rm"],"flags":{}},
  {"path":"group list","aliases":["ls"],"flags":{"user":["string"],"vault":["string"]}},
  {"path":"item create","aliases":[],"flags":{"category":["string"],"dry-run":["boolean"],"favorite":["boolean"],"generate-password":["optional"],"reveal":["boolean"],"ssh-generate-key":["string"],"tags":["csv"],"template":["string"],"title":["string"],"url":["string"],"vault":["string"]}},
  {"path":"item get","aliases":[],"flags":{"fields":["csv"],"include-archive":["boolean"],"otp":["boolean"],"reveal":["boolean"],"share-link":["boolean"],"vault":["string"]}},
  {"path":"item edit","aliases":[],"flags":{"dry-run":["boolean"],"favorite":["boolean"],"generate-password":["optional"],"reveal":["boolean"],"tags":["csv"],"template":["string"],"title":["string"],"url":["string"],"vault":["string"]}},
  {"path":"item delete","aliases":["remove","rm"],"flags":{"archive":["boolean"],"vault":["string"]}},
  {"path":"item list","aliases":["ls"],"flags":{"categories":["csv"],"favorite":["boolean"],"include-archive":["boolean"],"long":["boolean"],"tags":["csv"],"vault":["string"]}},
  {"path":"item move","aliases":["mv"],"flags":{"current-vault":["string"],"destination-vault":["string"],"reveal":["boolean"]}},
  {"path":"item share","aliases":[],"flags":{"emails":["csv"],"expires-in":["string"],"vault":["string"],"view-once":["boolean"]}},
  {"path":"plugin list","aliases":["ls"],"flags":{}},
  {"path":"plugin clear","aliases":["reset"],"flags":{"all":["boolean"],"force":["boolean","f"]}},
  {"path":"plugin init","aliases":[],"flags":{}},
  {"path":"plugin inspect","aliases":["info"],"flags":{}},
  {"path":"plugin run","aliases":[],"flags":{}},
  {"path":"service-account create","aliases":[],"flags":{"can-create-vaults":["boolean"],"expires-in":["string"],"raw":["boolean"],"vault":["array"]}},
  {"path":"service-account ratelimit","aliases":["ratelimits"],"flags":{}},
  {"path":"user provision","aliases":[],"flags":{"email":["string"],"language":["string"],"name":["string"]}},
  {"path":"user confirm","aliases":[],"flags":{"all":["boolean"]}},
  {"path":"user get","aliases":[],"flags":{"fingerprint":["boolean"],"me":["boolean"],"public-key":["boolean"]}},
  {"path":"user edit","aliases":[],"flags":{"name":["string"],"travel-mode":["string"]}},
  {"path":"user suspend","aliases":[],"flags":{"deauthorize-devices-after":["string"]}},
  {"path":"user reactivate","aliases":[],"flags":{}},
  {"path":"user delete","aliases":["remove","rm"],"flags":{}},
  {"path":"user list","aliases":["ls"],"flags":{"group":["string"],"vault":["string"]}},
  {"path":"vault create","aliases":[],"flags":{"allow-admins-to-manage":["string"],"description":["string"],"icon":["string"]}},
  {"path":"vault get","aliases":[],"flags":{}},
  {"path":"vault edit","aliases":[],"flags":{"description":["string"],"icon":["string"],"name":["string"],"travel-mode":["string"]}},
  {"path":"vault delete","aliases":["remove","rm"],"flags":{}},
  {"path":"vault list","aliases":["ls"],"flags":{"group":["string"],"permission":["csv"],"user":["string"]}},
  {"path":"connect group grant","aliases":[],"flags":{"all-servers":["boolean"],"group":["string"],"server":["string"]}},
  {"path":"connect group revoke","aliases":[],"flags":{"all-servers":["boolean"],"group":["string"],"server":["string"]}},
  {"path":"connect server create","aliases":[],"flags":{"force":["boolean","f"],"vaults":["csv"]}},
  {"path":"connect server get","aliases":[],"flags":{}},
  {"path":"connect server edit","aliases":[],"flags":{"name":["string"]}},
  {"path":"connect server delete","aliases":["remove","rm"],"flags":{}},
  {"path":"connect server list","aliases":["ls"],"flags":{}},
  {"path":"connect token create","aliases":[],"flags":{"expires-in":["string"],"server":["string"],"vault":["array"]}},
  {"path":"connect token edit","aliases":[],"flags":{"name":["string"],"server":["string"]}},
  {"path":"connect token delete","aliases":["remove","rm"],"flags":{"server":["string"]}},
  {"path":"connect token list","aliases":["ls"],"flags":{"server":["string"]}},
  {"path":"connect vault grant","aliases":[],"flags":{"server":["string"],"vault":["string"]}},
  {"path":"connect vault revoke","aliases":[],"flags":{"server":["string"],"vault":["string"]}},
  {"path":"group user grant","aliases":[],"flags":{"group":["string"],"role":["string"],"user":["string"]}},
  {"path":"group user revoke","aliases":[],"flags":{"group":["string"],"user":["string"]}},
  {"path":"group user list","aliases":["ls"],"flags":{}},
  {"path":"item template get","aliases":[],"flags":{"file-mode":["string"],"force":["boolean","f"],"out-file":["string","o"]}},
  {"path":"item template list","aliases":["ls"],"flags":{}},
  {"path":"plugin credential import","aliases":[],"flags":{}},
  {"path":"user recovery begin","aliases":[],"flags":{}},
  {"path":"vault group grant","aliases":[],"flags":{"group":["string"],"no-input":["boolean"],"permissions":["csv"],"vault":["string"]}},
  {"path":"vault group revoke","aliases":[],"flags":{"group":["string"],"no-input":["boolean"],"permissions":["csv"],"vault":["string"]}},
  {"path":"vault group list","aliases":["ls"],"flags":{}},
  {"path":"vault user grant","aliases":[],"flags":{"no-input":["boolean"],"permissions":["csv"],"user":["string"],"vault":["string"]}},
  {"path":"vault user revoke","aliases":[],"flags":{"no-input":["boolean"],"permissions":["csv"],"user":["string"],"vault":["string"]}},
  {"path":"vault user list","aliases":["ls"],"flags":{}},
];

const nativeInheritedFlags: NativeFlags = {
  account: ["string"], cache: ["boolean"], config: ["string"], debug: ["boolean"],
  encoding: ["string"], format: ["string"], help: ["boolean", "h"],
  "iso-timestamps": ["boolean"], "no-color": ["boolean"], session: ["string"],
};

const nativeHiddenFlagAliases: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "item get": { fields: ["field"] },
  "item share": { "expires-in": ["expiry"] },
};

function fixture() {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args: [], env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
  };
  const command = createOpCommand({ version: "0.0.1", backend: { async execute() { throw new Error("schema checks must not reach backend"); } } });
  return { command, context, output, errors };
}

test(`native ${nativeOracle.version} canonical stable leaf manifest matches exactly`, () => {
  assert.equal(nativeOracle.binarySha256.length, 64);
  assert.equal(nativeLeaves.length, 76);
  assert.deepEqual(opCommandCatalog.filter(entry => entry.availability === "stable").map(entry => entry.path.join(" ")).sort(),
    nativeLeaves.map(entry => entry.path).sort());
  assert.deepEqual(opCommandCatalog.filter(entry => entry.availability === "beta").map(entry => entry.path.join(" ")), ["environment read"]);
  assert.deepEqual(opCommandCatalog.filter(entry => entry.availability === "extension").map(entry => entry.path.join(" ")).sort(), [
    "environment snapshot create", "environment snapshot delete", "environment snapshot get",
    "environment snapshot list", "environment snapshot restore",
  ]);
});

test("native inherited flags exclude root-only version", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(opGlobalFlags).map(([name, flag]) => [name, flag.alias ? [flag.kind, flag.alias] : [flag.kind]])), nativeInheritedFlags);
});

test("native local flag kinds and short/hidden aliases match the pinned fixture", () => {
  for (const expected of nativeLeaves) {
    const actual = opCommandCatalog.find(entry => entry.path.join(" ") === expected.path)!;
    assert.deepEqual([...actual.aliases].sort(), [...expected.aliases].sort(), expected.path);
    assert.deepEqual(Object.fromEntries(Object.entries(actual.flags).filter(([, flag]) => flag.availability === undefined).map(([name, flag]) =>
      [name, flag.alias ? [flag.kind, flag.alias] : [flag.kind]])), expected.flags, expected.path);
    assert.deepEqual(Object.fromEntries(Object.entries(actual.flags).filter(([, flag]) => flag.longAliases?.length).map(([name, flag]) => [name, flag.longAliases])),
      nativeHiddenFlagAliases[expected.path] ?? {}, expected.path);
  }
});

test("every pinned native leaf and command alias accepts its local and inherited flags", async () => {
  const run = fixture();
  for (const expected of nativeLeaves) {
    const path = expected.path.split(" ");
    for (const name of [path.at(-1)!, ...expected.aliases]) {
      run.context.args = [...path.slice(0, -1), name, "--help"];
      assert.equal((await run.command.execute(run.context)).exitCode, 0, expected.path + " alias " + name);
    }
    for (const [name, [kind, alias]] of Object.entries({ ...nativeInheritedFlags, ...expected.flags })) {
      const definition = opCommandCatalog.find(command => command.path.join(" ") === expected.path)!.flags[name];
      const examples = { "file-mode": "0600", duration: "1h", "go-duration": "1h", csv: "example", "password-recipe": "letters" };
      const value = name === "format" ? "json" : name === "encoding" ? "UTF-8" : definition?.allowedValues?.[0] ?? (definition?.valueSyntax ? examples[definition.valueSyntax] : "example");
      const argument = kind === "boolean" ? `--${name}=${name === "help" ? "true" : "false"}` : `--${name}=${value}`;
      run.context.args = [...path, "--help", argument];
      assert.equal((await run.command.execute(run.context)).exitCode, 0, expected.path + " " + argument);
      if (alias && name !== "help") {
        run.context.args = [...path, "--help", `-${alias}`, ...(kind === "boolean" ? [] : [value])];
        assert.equal((await run.command.execute(run.context)).exitCode, 0, expected.path + " -" + alias);
      }
    }
  }
});

test("native root version emits a scalar and is rejected on every child leaf", async () => {
  const run = fixture();
  for (const flag of ["--version", "-v"]) {
    run.output.length = 0;
    run.context.args = [flag];
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.equal(Buffer.concat(run.output).toString(), "0.0.1\n");
    for (const expected of nativeLeaves) {
      run.context.args = [...expected.path.split(" "), flag, "--help"];
      assert.equal((await run.command.execute(run.context)).exitCode, 1, expected.path + " " + flag);
    }
  }
});
