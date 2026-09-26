import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";

const paths = ["vault user grant", "vault user revoke", "vault group grant", "vault group revoke", "vault list"];
const valid = ["allow_viewing", "allow_editing", "allow_managing", "view_items", "create_items", "view_and_copy_passwords", "edit_items", "archive_items", "delete_items", "view_item_history", "import_items", "export_items", "copy_and_share_items", "print_items", "manage_vault", "read_items", "write_items", "share_items", "READ_ITEMS", " view_items ", "view_items\t", "view_items\n", "READ_ITEMS, CREATE_ITEMS"];
const invalid = ["synthetic-private-value", "move_items", "", ",", "view_items,", "view_items,,create_items", '"view_items"', "view_items,synthetic-private-value", "update_items", "reveal_passwords"];

async function execute(args: readonly string[]) {
  const calls: string[] = [];
  let errors = "";
  const result = await createOpCommand({
    authorize() { calls.push("authorize"); return "allow"; },
    backend: { async execute() { calls.push("backend"); return []; } },
  }).execute({
    args, env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write() { calls.push("stdout"); } },
    stderr: { async write(bytes) { errors += Buffer.from(bytes); } },
  });
  return { ...result, calls, errors };
}

for (const path of paths) {
  const flag = path === "vault list" ? "permission" : "permissions";
  test(`${path} rejects invalid permission values before authorization and acquisition`, async () => {
    for (const value of invalid) {
      for (const flags of [[`--${flag}=${value}`], [`--${flag}`, value], [`--${flag}=view_items`, `--${flag}=${value}`], [`--${flag}=${value}`, `--${flag}=view_items`]]) {
        const run = await execute([...path.split(" "), ...flags]);
        assert.equal(run.exitCode, 1, JSON.stringify({ path, flags, run }));
        assert.deepEqual(run.calls, []);
        assert.equal(run.errors.includes("synthetic-private-value"), false);
        assert.deepEqual(resolveOpCompletion([...path.split(" "), ...flags, "--"]), { candidates: [], directive: 0 });
      }
    }
  });

  test(`${path} accepts documented permissions and native lexical variants without account discovery`, async () => {
    for (const value of valid) {
      const flags = [`--${flag}=${value}`];
      const run = await execute([...path.split(" "), ...flags]);
      assert.equal(run.exitCode, 0, JSON.stringify({ path, value, errors: run.errors }));
      assert.equal(run.calls.filter(call => call === "authorize").length, 1);
      assert.equal(run.calls.filter(call => call === "backend").length, 1);
      assert.equal(resolveOpCompletion([...path.split(" "), ...flags, "--"]).directive, 4);
    }
    assert.equal((await execute([...path.split(" "), `--${flag}=view_items`, `--${flag}=create_items`])).exitCode, 0);
  });
}

test("permission-value validation does not turn completion-required metadata into execution requirements", async () => {
  for (const path of paths) assert.equal((await execute(path.split(" "))).exitCode, 0);
});

test("unrelated CSV flags retain quoted-string parsing", async () => {
  assert.equal((await execute(["item", "list", '--tags="synthetic,tag"'])).exitCode, 0);
});
