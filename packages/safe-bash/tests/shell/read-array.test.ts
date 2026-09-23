import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { basicCommands } from "../../src/commands/basic.js";
import { setup } from "./helpers.js";
import { agentCommands, createMemoryFileSystem, Shell } from "../../src/core.js";

for (const option of ["-u 0", "-u0", "-u +00", "-p SYNTHETIC_PROMPT", "-pSYNTHETIC_PROMPT", "-p ''", "-s", "-rsu0", "-n9 -s -p prompt -u0"]) {
  test(`default read nonterminal option consumes one record: ${option}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(`read ${option} first; code=$?; read -r rest; args "$first" "$rest"; exit "$code"`, { stdin: "abcd\nTAIL\n" });
      assert.equal(result.stdout, '["abcd","TAIL"]');
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
      const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", `read ${option} first; code=$?; read -r rest; printf '["%s","%s"]' "$first" "$rest"; exit "$code"`], { input: "abcd\nTAIL\n", encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" }, timeout: 1000 });
      assert.equal(native.error, undefined);
      assert.equal(result.stdout, native.stdout);
      assert.equal(result.stderr, native.stderr);
      assert.equal(result.exitCode, native.status);
    } finally { await shell.dispose(); }
  });
}

test("default read nonterminal options assign partial input and report EOF", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('read -su0 -p prompt value; args "$?" "$value"', { stdin: "partial" });
    assert.equal(result.stdout, '["1","partial"]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("default read nonterminal options preserve input on malformed or unsupported options", async () => {
  for (const option of ["-u", "-p", "-u1", "-unope", "-u0 -Z"]) {
    const { shell } = setup();
    try {
      const result = await shell.exec(`value=old; read ${option}; args "$?" "$value"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, '["2","old"]untouched', option);
      assert.equal(result.stderr, "read: invalid variable name or unsupported option\n", option);
    } finally { await shell.dispose(); }
  }
});

test("agentCommands default read assigns array fields in a VFS script", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/read.sh", new TextEncoder().encode('read -a a; printf "<%s>" "${a[@]}"'));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("bash /read.sh", { stdin: "a b:c\n" });
    assert.equal(result.stdout, "<a><b:c>");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [label, source, stdin, stdout] of [
  ["reported default profile", 'read -a a; printf "<%s>" "${a[@]}"', "a b:c\n", "<a><b:c>"],
  ["attached option and ignored operands", 'ignored=old; read -raitems ignored; args "${items[@]}" "$ignored" "$?"', "a\\ b c\n", JSON.stringify(["a\\", "b", "c", "old", "0"])],
  ["escaped separators and empty fields", 'IFS=, read -a items; args "${items[@]}"', "a\\,b,,c,\n", '["a,b","","c"]'],
  ["replaces previous members", 'items=(old stale); read -a items; args "${items[@]}"', "new\n", '["new"]'],
  ["clears at EOF", 'items=(old stale); read -a items; args "$?" "${items[@]}"', "", '["1"]'],
  ["assigns partial EOF record", 'read -a items; args "$?" "${items[@]}"', "a b", '["1","a","b"]'],
  ["restores local binding", 'items=(outer saved); f() { local -a items; read -a items; args "${items[@]}"; }; f; args "${items[@]}"', "a b\n", '["a","b"]["outer","saved"]'],
  ["leaves unread tail", 'read -a items; args "${items[@]}"; pass', "a b\nTAIL", '["a","b"]TAIL'],
  ["ignores invalid extra operand", 'read -a items invalid-name; args "${items[@]}"', "a b\n", '["a","b"]'],
  ["empty IFS retains whole record", 'IFS= read -a items; args "${items[@]}"', " a b \n", '[" a b "]'],
] as const) {
  test(`default read array: ${label}`, async () => {
    const { shell } = setup();
    for (const command of basicCommands()) shell.register(command);
    try {
      const result = await shell.exec(source, { stdin });
      assert.equal(result.stdout, stdout);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("default read array preserves readonly members after consuming the record", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('readonly -a items=(old); read -a items; args "$?" "${items[@]}"; pass', { stdin: "new\nTAIL" });
    assert.equal(result.stdout, '["1","old"]TAIL');
    assert.match(result.stderr, /items: readonly variable/u);
  } finally { await shell.dispose(); }
});

test("default read array rejects malformed options without consuming input", async () => {
  for (const option of ["-a", "-a invalid-name"]) {
    const { shell } = setup();
    try {
      const result = await shell.exec(`read ${option}; args "$?"; pass`, { stdin: "untouched" });
      assert.equal(result.stdout, '["2"]untouched');
      assert.match(result.stderr, /read:/u);
    } finally { await shell.dispose(); }
  }
});

test("default read array enforces indexed field admission", async () => {
  const { shell } = setup({ limits: { maxExpansionFields: 8 } });
  try {
    const result = await shell.exec("read -a items", { stdin: "x ".repeat(32) + "\n" });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /indexed array: private Map slot limit exceeded/u);
  } finally { await shell.dispose(); }
});
