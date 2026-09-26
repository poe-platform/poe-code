import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";

async function execute(flags: readonly string[]) {
  const calls: string[] = [];
  let error = "";
  const result = await createOpCommand({
    authorize() { calls.push("authorize"); return "allow"; },
    backend: { async execute() { calls.push("backend"); return {}; } },
  }).execute({
    args: ["group", "user", "grant", "--group=synthetic", "--user=synthetic", ...flags],
    env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write() { calls.push("stdout"); } },
    stderr: { async write(data) { error += Buffer.from(data); } },
  });
  return { ...result, calls, error };
}

test("invalid roles fail before authorization, input and backend on every occurrence", async () => {
  for (const value of ["synthetic-private-value", "", " member ", "member\t", "member\n", "member,manager"]) {
    for (const flags of [[`--role=${value}`], ["--role", value], ["--role=member", `--role=${value}`], [`--role=${value}`, "--role=manager"]]) {
      const result = await execute(flags);
      assert.equal(result.exitCode, 1, JSON.stringify({ flags, result }));
      assert.deepEqual(result.calls, []);
      assert.equal(result.error.includes("synthetic-private-value"), false);
    }
  }
});

test("role completion rejects invalid consumed values without suggesting flags", () => {
  for (const value of ["synthetic", "", " member ", "member,manager"]) {
    for (const flags of [[`--role=${value}`], ["--role", value], [`--role=${value}`, "--role=member"]]) {
      assert.deepEqual(resolveOpCompletion(["group", "user", "grant", ...flags, "--"]), { candidates: [], directive: 0 });
    }
  }
});

test("roles accept native case variants and remain optional", async () => {
  for (const value of ["member", "manager", "MEMBER", "MANAGER", "mEmBeR"]) {
    for (const flags of [[`--role=${value}`], ["--role", value]]) {
      const result = await execute(flags);
      assert.equal(result.exitCode, 0, result.error);
      assert.equal(result.calls.filter(call => call === "authorize").length, 1);
      assert.equal(result.calls.filter(call => call === "backend").length, 1);
      const completion = resolveOpCompletion(["group", "user", "grant", ...flags, "--"]);
      assert.equal(completion.directive, 4);
      assert.deepEqual(completion.candidates.map(candidate => candidate.value), ["--group", "--user"]);
    }
  }
  assert.equal((await execute([])).exitCode, 0);
  assert.equal((await execute(["--role=member", "--role=manager"])).exitCode, 0);
});
