import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOpCompletion } from "./completion-resolver.js";
import { createOp } from "./index.js";

const fixtures = [
  {
    "path": "item move",
    "flags": [
      "destination-vault"
    ],
    "rejectEmpty": [
      "destination-vault"
    ]
  },
  {
    "path": "user provision",
    "flags": [
      "email",
      "name"
    ],
    "rejectEmpty": [
      "email",
      "name"
    ]
  },
  {
    "path": "connect group grant",
    "flags": [
      "group"
    ],
    "rejectEmpty": [
      "group"
    ]
  },
  {
    "path": "connect group revoke",
    "flags": [
      "group"
    ],
    "rejectEmpty": [
      "group"
    ]
  },
  {
    "path": "connect token create",
    "flags": [
      "server"
    ],
    "rejectEmpty": []
  },
  {
    "path": "connect vault grant",
    "flags": [
      "server",
      "vault"
    ],
    "rejectEmpty": [
      "server",
      "vault"
    ]
  },
  {
    "path": "connect vault revoke",
    "flags": [
      "server",
      "vault"
    ],
    "rejectEmpty": [
      "server",
      "vault"
    ]
  },
  {
    "path": "group user grant",
    "flags": [
      "group",
      "user"
    ],
    "rejectEmpty": [
      "group",
      "user"
    ]
  },
  {
    "path": "group user revoke",
    "flags": [
      "group",
      "user"
    ],
    "rejectEmpty": [
      "group",
      "user"
    ]
  },
  {
    "path": "vault group grant",
    "flags": [
      "group",
      "permissions",
      "vault"
    ],
    "rejectEmpty": [
      "group",
      "permissions",
      "vault"
    ]
  },
  {
    "path": "vault group revoke",
    "flags": [
      "group",
      "vault"
    ],
    "rejectEmpty": [
      "group",
      "vault"
    ]
  },
  {
    "path": "vault user grant",
    "flags": [
      "permissions",
      "user",
      "vault"
    ],
    "rejectEmpty": [
      "permissions",
      "user",
      "vault"
    ]
  },
  {
    "path": "vault user revoke",
    "flags": [
      "user",
      "vault"
    ],
    "rejectEmpty": [
      "user",
      "vault"
    ]
  }
];

for (const fixture of fixtures) {
  test(`native completion prioritizes missing required flags for ${fixture.path}`, () => {
    const path = fixture.path.split(" ");
    assert.deepEqual(resolveOpCompletion([...path, "--"]).candidates.map(candidate => candidate.value), fixture.flags.map(flag => "--" + flag));
    for (const flag of fixture.flags) {
      const remaining = fixture.flags.filter(name => name !== flag).map(name => "--" + name);
      const value = flag === "permissions" ? "read_items" : "synthetic";
      for (const supplied of [[`--${flag}=${value}`], [`--${flag}`, value], [`--${flag}=${value}`, `--${flag}=${value}`]]) {
        const result = resolveOpCompletion([...path, ...supplied, "--"]);
        assert.equal(result.directive, 4);
        if (remaining.length) assert.deepEqual(result.candidates.map(candidate => candidate.value), remaining);
        else {
          assert.ok(result.candidates.some(candidate => candidate.value === "--help"));
          assert.equal(result.candidates.some(candidate => candidate.value === "--" + flag), false);
        }
      }
      for (const tail of [[`--${flag}`, ""], [`--${flag}=`], [`--${flag}`, "--"]]) {
        assert.deepEqual(resolveOpCompletion([...path, ...tail]), { candidates: [], directive: 0 });
      }
      const empty = resolveOpCompletion([...path, `--${flag}=`, "--"]);
      if (fixture.rejectEmpty.includes(flag)) assert.deepEqual(empty, { candidates: [], directive: 0 });
      else {
        assert.equal(empty.directive, 4);
        assert.ok(empty.candidates.some(candidate => candidate.value === "--help"));
        assert.equal(empty.candidates.some(candidate => candidate.value === "--" + flag), false);
      }
    }
    const supplied = fixture.flags.map(flag => `--${flag}=${flag === "permissions" ? "read_items" : "synthetic"}`);
    assert.ok(resolveOpCompletion([...path, ...supplied, "--"]).candidates.some(candidate => candidate.value === "--help"));
  });
}

test("required completion filters by prefix before falling back to ordinary flags", () => {
  const values = (words: readonly string[]) => resolveOpCompletion(words).candidates.map(candidate => candidate.value);
  assert.deepEqual(values(["user", "provision", "--email=x", "--n"]), ["--name"]);
  assert.deepEqual(values(["user", "provision", "--email=x", "--l"]), ["--language"]);
  assert.deepEqual(values(["item", "move", "--c"]), ["--cache", "--config", "--current-vault"]);
  assert.deepEqual(values(["item", "mv", "--"]), ["--destination-vault"]);
  assert.deepEqual(values(["user", "provision", "--email", "--name", "--"]), ["--name"]);
  assert.deepEqual(resolveOpCompletion(["user", "provision", "--email", "", "--"]), { candidates: [], directive: 0 });
});

test("global cache/config suggestions remain visible unless already supplied", () => {
  for (const path of [[], ["read"], ["item", "get"]]) {
    assert.deepEqual(resolveOpCompletion([...path, "--ca"]).candidates.map(candidate => candidate.value), ["--cache"]);
    assert.deepEqual(resolveOpCompletion([...path, "--co"]).candidates.map(candidate => candidate.value), ["--config"]);
    assert.equal(resolveOpCompletion([...path, "--cache=false", "--ca"]).candidates.length, 0);
    assert.equal(resolveOpCompletion([...path, "--config=synthetic", "--co"]).candidates.length, 0);
  }
});

test("public required-flag metadata callbacks require no policy, backend, or input", async () => {
  const command = createOp({
    backend: { async execute() { assert.fail("unexpected backend"); } },
    authorize() { assert.fail("unexpected authorization"); },
  });
  for (const [args, expected] of [
    [["item", "move", "--"], "--destination-vault\n:4\n"],
    [["user", "provision", "--email=x", "--"], "--name\n:4\n"],
    [["read", "--ca"], "--cache\n:4\n"],
  ] as const) {
    let output = "";
    const result = await command.execute({
      args: ["__completeNoDesc", ...args], env: {}, signal: new AbortController().signal,
      stdin: { [Symbol.asyncIterator]() { assert.fail("unexpected stdin"); } },
      stdout: { async write(bytes) { output += Buffer.from(bytes); } },
      stderr: { async write() { assert.fail("unexpected stderr"); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(output, expected);
  }
});
