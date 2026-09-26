import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, type OpCommandContext, type OpCommandOptions } from "./cli.js";
import type { OpBackendRequest } from "./types.js";
import { opCommandCatalog } from "./catalog.js";

async function execute(args: readonly string[], options: Partial<OpCommandOptions> = {}, input: readonly Uint8Array[] = []) {
  const requests: OpBackendRequest[] = [];
  const effects: string[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args, env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { effects.push("stdin"); yield* input; } },
    stdout: { async write() {} }, stderr: { async write(data) { errors.push(data); } },
  };
  const result = await createOpCommand({
    backend: { async execute(request) { effects.push("backend"); requests.push(request); return request.flags.otp ? "123456" : []; } },
    authorize() { effects.push("authorize"); return "allow"; }, ...options,
  }).execute(context);
  return { ...result, requests, effects, error: Buffer.concat(errors).toString() };
}

test("leaf flags are accepted before and between command words with their values", async () => {
  for (const args of [
    ["--vault", "get", "item", "get", "entry"],
    ["item", "--vault", "get", "get", "entry"],
    ["item", "get", "entry", "--vault", "get"],
  ]) {
    const result = await execute(args);
    assert.equal(result.exitCode, 0, result.error);
    assert.deepEqual(result.requests[0], { resource: "item", action: "get", args: ["entry"], flags: { vault: "get" } });
  }
});

test("final leaf definitions govern repeatable, optional, shorthand and alias flags", async () => {
  const repeated = await execute(["--vault=one,r", "connect", "--vault", "two,w", "token", "create", "token"]);
  assert.equal(repeated.exitCode, 0, repeated.error);
  assert.deepEqual(repeated.requests[0]!.flags.vault, ["one,r", "two,w"]);
  const optional = await execute(["item", "create", "--generate-password", "title=Entry"]);
  assert.equal(optional.exitCode, 0, optional.error);
  assert.equal(optional.requests[0]!.flags["generate-password"], true);
  const optionalValue = await execute(["--generate-password=20", "item", "create", "title=Entry"]);
  assert.equal(optionalValue.exitCode, 0, optionalValue.error);
  assert.equal(optionalValue.requests[0]!.flags["generate-password"], "20");
  const alias = await execute(["--expiry=1h", "item", "share", "entry"]);
  assert.equal(alias.exitCode, 0, alias.error);
  assert.equal(alias.requests[0]!.flags["expires-in"], "1h");
  const shorthand = await execute(["read", "-n", "op://vault/item/field"]);
  assert.equal(shorthand.exitCode, 0, shorthand.error);
  assert.equal(shorthand.requests[0]!.flags["no-newline"], true);
});

test("early flags not belonging to the resolved leaf are rejected before effects", async () => {
  for (const args of [["--vault", "Work", "whoami"], ["--otp", "item", "list"], ["-f", "document", "get", "document"], ["--expiry=1h", "item", "get", "entry"]]) {
    const result = await execute(args);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.effects, []);
  }
});

test("leaf resolution preserves command aliases, literal argv and stable beta boundaries", async () => {
  const alias = await execute(["--vault=Work", "item", "ls"]);
  assert.equal(alias.exitCode, 0, alias.error);
  assert.equal(alias.requests[0]!.action, "list");
  const literal = await execute(["run", "--", "child", "--vault", "item", "get"]);
  assert.equal(literal.exitCode, 0, literal.error);
  assert.deepEqual(literal.requests[0]!.args, ["child", "--vault", "item", "get"]);
  const stable = await execute(["--environment=env", "run", "--", "child"]);
  assert.equal(stable.exitCode, 1);
  assert.deepEqual(stable.effects, []);
  const beta = await execute(["--environment=env", "run", "--", "child"], { channel: "beta" });
  assert.equal(beta.exitCode, 0, beta.error);
  assert.deepEqual(beta.requests[0]!.flags.environment, ["env"]);
});

test("native invalid operand counts fail before stdin, authorization or custom backends", async () => {
  for (const args of [["vault", "list", "extra"], ["item", "get", "one", "two"], ["whoami", "extra"], ["item", "template", "list", "extra"], ["read"], ["document", "get"]]) {
    const result = await execute(args);
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.deepEqual(result.effects, []);
  }
});

test("invalid operands never reach handler overrides and help remains available", async () => {
  let handled = false;
  const invalid = await execute(["read"], { handlers: { read: async () => { handled = true; return { exitCode: 0 }; } } });
  assert.equal(invalid.exitCode, 1);
  assert.equal(handled, false);
  assert.deepEqual(invalid.effects, []);
  const help = await execute(["document", "get", "--help"]);
  assert.equal(help.exitCode, 0, help.error);
  assert.deepEqual(help.effects, []);
});

test("every available leaf flag with an inline value resolves before its command in help probes", async () => {
  for (const command of opCommandCatalog) {
    for (const [name, definition] of Object.entries(command.flags)) {
      const channel = command.availability === "beta" || definition.availability === "beta" ? "beta" : "stable";
      const examples = { "file-mode": "0600", duration: "1h", "go-duration": "1h", csv: "value", "password-recipe": "letters" };
      const token = `--${name}=${definition.kind === "boolean" ? "true" : definition.valueSyntax ? examples[definition.valueSyntax] : definition.allowedValues?.[0] ?? "value"}`;
      const result = await execute([token, ...command.path, "--help"], { channel });
      assert.equal(result.exitCode, 0, `${command.path.join(" ")} ${token}: ${result.error}`);
      assert.deepEqual(result.effects, []);
    }
  }
});

test("native discovery rejects bare leaf booleans and optional flags before the leaf", async () => {
  for (const args of [
    ["--otp", "item", "get", "one", "--help"],
    ["--generate-password", "item", "create", "title=Entry", "--help"],
  ]) {
    const result = await execute(args);
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.deepEqual(result.effects, []);
  }
});

test("inline leaf values and bare global booleans preserve command discovery", async () => {
  for (const args of [
    ["--otp=true", "item", "get", "one"],
    ["--generate-password=20", "item", "create", "title=Entry"],
    ["item", "get", "one", "--otp"],
    ["item", "create", "--generate-password", "title=Entry"],
    ["--debug", "item", "get", "one"],
    ["item", "--cache=false", "get", "one"],
    ["--vault", "Work", "item", "get", "one"],
  ]) {
    const result = await execute(args);
    assert.equal(result.exitCode, 0, `${args.join(" ")}: ${result.error}`);
    assert.equal(result.requests.length, 1);
  }
});

test("implicit item get validates piped input after literal allowance but before a custom backend", async () => {
  const empty = await execute(["item", "get"]);
  assert.equal(empty.exitCode, 1);
  assert.deepEqual(empty.effects, ["authorize", "stdin"]);
  const bytes = new TextEncoder().encode("entry\n");
  const piped = await execute(["item", "get"], {}, [bytes]);
  assert.equal(piped.exitCode, 0, piped.error);
  assert.equal(piped.requests[0]!.input, "entry\n");
  assert.deepEqual(piped.effects, ["authorize", "stdin", "backend"]);
});

test("conditional stdin validation replays original bytes to overridden item get handlers", async () => {
  let handled = false;
  const empty = await execute(["item", "get"], { handlers: { "item get": async () => { handled = true; return { exitCode: 0 }; } } });
  assert.equal(empty.exitCode, 1);
  assert.equal(handled, false);
  assert.deepEqual(empty.effects, ["authorize", "stdin"]);
  const chunks = [new TextEncoder().encode("{\"id\":"), new TextEncoder().encode("\"entry\"}\n")];
  const piped = await execute(["item", "get"], { handlers: { "item get": async (request, context) => {
    assert.deepEqual(request.input, { id: "entry" });
    const received: Uint8Array[] = [];
    for await (const chunk of context.stdin) received.push(chunk);
    assert.deepEqual(Buffer.concat(received), Buffer.concat(chunks));
    return { exitCode: 0 };
  } } }, chunks);
  assert.equal(piped.exitCode, 0, piped.error);
  assert.deepEqual(piped.effects, ["authorize", "stdin"]);
});
