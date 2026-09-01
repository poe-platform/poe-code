import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

const contextHeader = "*** target\n--- target\n***************\n";
const normal = "1c1\n< old\n---\n> new\n";
const context = `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n! new\n`;
const unified = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

const formats = { normal, context, unified };
for (const sequence of [
  ["normal", "context"], ["context", "unified"], ["unified", "normal"], ["context", "normal", "unified"],
] as const) {
  const input = sequence.map((format, index) => formats[format].replaceAll("old\n", `value${index}\n`)
    .replaceAll("new\n", `value${index + 1}\n`)).join("");
  for (const target of ["target", "/work/target"]) {
    test(`--atomic mixed ${sequence.join("/")} stages forward, dry-run and reverse for ${target}`, async () => {
      const result = await run("patch", ["--atomic", "--dry-run", target], { files: { target: "value0\n" }, input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(result.fs, "target"), "value0\n");
      const forward = await run("patch", ["--atomic", target], { fs: result.fs, input });
      assert.equal(forward.exitCode, 0, forward.stderr);
      assert.equal(await contents(result.fs, "target"), `value${sequence.length}\n`);
      const reverse = await run("patch", ["--atomic", "-R", target], { fs: result.fs, input });
      assert.equal(reverse.exitCode, 0, reverse.stderr);
      assert.equal(await contents(result.fs, "target"), "value0\n");
    });
  }
  test(`--atomic mixed ${sequence.join("/")} rejects a later asserted format`, async () => {
    const result = await run("patch", ["--atomic", `--${sequence[0]}`, "target"], { files: { target: "value0\n" }, input });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /not requested/u);
    assert.equal(await contents(result.fs, "target"), "value0\n");
  });
  for (const later of ["--- other\n+++ other\n@@ -1 +1 @@\n-old\n", "1c1\n< wrong\n---\n> value\n"]) {
    test(`--atomic mixed ${sequence.join("/")} rejects later ${later.startsWith("1") ? "conflict" : "parse error"} before writing`, async () => {
      const result = await run("patch", ["--atomic", "target"], { files: { target: "value0\n", other: "old\n" }, input: input + later });
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.equal(await contents(result.fs, "target"), "value0\n");
      assert.equal(await contents(result.fs, "other"), "old\n");
    });
  }
}

test("mixed sections honor the single authorized target rather than header labels", async () => {
  const input = context.replaceAll("target", "/ignored/first")
    + unified.replaceAll("target", "/ignored/second").replace("-old", "-new").replace("+new", "+final");
  const result = await run("patch", ["/work/target"], { files: { target: "old\n", other: "untouched\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "final\n");
  assert.equal(await contents(result.fs, "other"), "untouched\n");
});

test("unified hunk body owns header-looking lines before a normal section", async () => {
  const input = "--- target\n+++ target\n@@ -1,2 +1,2 @@\n--- old-label\n+++ new-label\n 1c1\n"
    + "2c2\n< 1c1\n---\n> final\n";
  const result = await run("patch", ["target"], { files: { target: "-- old-label\n1c1\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "++ new-label\nfinal\n");
});

for (const options of [{ maxFiles: 1 }, { maxHunks: 1 }, { maxWork: 30 }]) {
  test(`mixed sections share budgets ${JSON.stringify(options)}`, async () => {
    const result = await run("patch", ["target"], { files: { target: "old\n" }, options,
      input: context + unified.replace("-old", "-new").replace("+new", "+final") });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("mixed parse cancellation propagates its reason without mutations", async () => {
  const memory = await filesystem({ target: "old\n" });
  const mutations: PropertyKey[] = [];
  const fs = new Proxy(memory, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        if (["writeFile", "rm", "rename", "mkdir"].includes(String(key))) mutations.push(key);
        return Reflect.apply(member, target, args);
      };
    },
  });
  const controller = new AbortController();
  const reason = new Error("cancel mixed parsing");
  const timer = setImmediate(() => controller.abort(reason));
  try {
    await assert.rejects(run("patch", ["target"], { fs, signal: controller.signal,
      input: (context + unified.replace("-old", "-new").replace("+new", "+old")).repeat(800) }), error => error === reason);
    assert.deepEqual(mutations, []);
    assert.equal(await contents(memory, "target"), "old\n");
  } finally { clearImmediate(timer); }
});

for (const [format, input] of [["normal", normal], ["context", context], ["unified", unified]] as const) {
  for (const fileCR of [false, true]) for (const transport of [false, true]) {
    test(`${format} preserves file CR=${fileCR} with transport CR=${transport}`, async () => {
      const data = fileCR ? input.replace("old\n", "old\r\n").replace("new\n", "new\r\n") : input;
      const result = await run("patch", ["target"], {
        files: { target: fileCR ? "old\r\n" : "old\n" }, input: transport ? data.replaceAll("\n", "\r\n") : data,
      });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(result.fs, "target"), fileCR ? "new\r\n" : "new\n");
    });
  }
  test(`${format} CRLF transport normalizes before bounded mail signature parsing`, async () => {
    const inputMail = `Subject: edit\n\n${input}-- \n2.8\n`.replaceAll("\n", "\r\n");
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input: inputMail });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "new\n");
  });
}

test("LF framing preserves literal CR and nested header-looking file payload", async () => {
  const input = "--- target\n+++ target\n@@ -1 +1,3 @@\n-old\n+--- nested\r\n++++ nested\r\n+@@ -1 +1 @@\r\n";
  const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "--- nested\r\n+++ nested\r\n@@ -1 +1 @@\r\n");
});

test("inconsistent transport is not globally stripped or published", async () => {
  const input = context.replaceAll("\n", "\r\n").replace("! old\r\n", "! old\n");
  const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const [name, before, input, after] of [
  ["normal new blank", "old\n", "1c1\n< old\n---\n>\n", "\n"],
  ["normal old blank", "\n", "1c1\n<\n---\n> new\n", "new\n"],
  ["context changed blank", "old\n", `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n`, "\n"],
  ["context bare shared blank", "\nold\n", `${contextHeader}*** 1,2 ****\n\n! old\n--- 1,2 ----\n\n! new\n`, "\nnew\n"],
  ["context inserted blank", "", `${contextHeader}*** 0 ****\n--- 1 ----\n+\n`, "\n"],
  ["context removed blank", "\n", `${contextHeader}*** 1 ****\n-\n--- 0 ----\n`, ""],
] as const) {
  test(`suppressed ${name}: forward and reverse exact bytes`, async () => {
    const result = await run("patch", ["target"], { files: { target: before }, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), after);
    const reversed = await run("patch", ["-R", "target"], { fs: result.fs, input });
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(result.fs, "target"), before);
  });
}

for (const input of [
  "1c1\n< old\n---\n>\n\\ No newline at end of file\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1 ----\n!\n\\ No newline at end of file\n`,
  "1c1,2\n< old\n---\n>\n",
  `${contextHeader}*** 1 ****\n! old\n--- 1,2 ----\n!\n`,
]) {
  test(`suppressed blank still rejects incomplete/count error ${JSON.stringify(input)}`, async () => {
    const result = await run("patch", ["target"], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}
