import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Volume, createFsFromVolume } from "memfs";
import fastGlob from "fast-glob";
import ownFiles from "../dist/plugin-files.js";
import referenceFiles from "../../poe-agent/dist/plugins/poe-agent-plugin-files.js";
import { globFiles } from "../dist/file-glob.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
const context = { signal: new AbortController().signal };
const call = (plugin, name, args) =>
  plugin.tools.find((tool) => tool.name === name).call(args, context);

test("seeded UTF16 line windows agree with exact original file reads", async () => {
  let seed = 0x5eed2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  for (let sample = 0; sample < 128; sample++) {
    const text = Array.from(
      { length: random() % 48 },
      () => ["line\n", "🌍\r\n", "\ud800", "\udc00", "\r", "\n"][random() % 6]
    ).join("");
    const fs = createFsFromVolume(Volume.fromJSON({ "/project/a.txt": text })).promises;
    const args = {
      path: "a.txt",
      offset: random() % 48,
      ...(sample % 3 ? { limit: random() % 48 } : {})
    };
    assert.deepEqual(
      await call(ownFiles({ cwd: "/project", fs }), "read_file", args),
      await call(referenceFiles({ cwd: "/project", fs }), "read_file", args)
    );
  }
});

test("seeded edits preserve replacement-pattern and nonoverlap semantics", () => {
  let seed = 0xabad2026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 8;
  };
  const alphabet = ["a", "b", "🌍", "\ud800", "\udc00", "\n"];
  for (let sample = 0; sample < 512; sample++) {
    const content = Array.from({ length: 32 }, () => alphabet[random() % alphabet.length]).join("");
    const search = content.slice(random() % 16, 16 + (random() % 8)) || "a";
    const replacement = ["$&", "$$", "$`", "$'", "$1", "🌍\ud800", ""][sample % 7];
    for (const all of [false, true])
      assert.equal(
        native.agentReplaceText(content, search, replacement, all),
        all ? content.split(search).join(replacement) : content.replace(search, replacement)
      );
    assert.equal(native.agentCountOccurrences(content, search), content.split(search).length - 1);
  }
});

test("memfs glob traversal cross-checks full fast-glob matches including static prefixes", async () => {
  const volume = Volume.fromJSON({
    "/project/a.ts": "",
    "/project/b.js": "",
    "/project/.hidden/c.ts": "",
    "/project/src/a.ts": "",
    "/project/src/b.js": "",
    "/project/src/abba.ts": "",
    "/project/test/sub/a.ts": "",
    "/project/x01.txt": "",
    "/project/x02.txt": "",
    "/project/x03.txt": "",
    "/project/file?.txt": "",
    "/project/src/c.tsx": "",
    "/outside/o.ts": "",
    "/project/1.txt": "",
    "/project/a.txt": "",
    "/project/{a}": "",
    "/project/{xa}": "",
    "/project/[ab]": "",
    "/project/foo.ts": "",
    "/project/foo.d.ts": "",
    "/project/foo(bar)": "",
    "/project/{abc": "",
    "/project/@(a|b": ""
  });
  const fs = createFsFromVolume(volume);
  for (const pattern of [
    "**/*.ts",
    "*.ts",
    "src/*",
    "src/{a,b}.[tj]s",
    "@(src|test)/**/+(a|b).ts",
    "*.{ts,js}",
    "x{01..03}.txt",
    "file\\?.txt",
    "../outside/*.ts",
    "/project/src/*.ts",
    "!**/*.ts",
    "**/!(a|b).ts",
    "**/[!a]*",
    "**/[^a]*",
    "**/[[:digit:]].txt",
    "**/[[:alpha:]].txt",
    "{a}",
    "{x{a,b}}",
    "[ab]",
    "./*.ts",
    "**/!(*.d).ts",
    "**/!(foo).ts",
    "(src|test)/**/*.ts",
    "foo(bar)",
    "{abc",
    "@(a|b"
  ]) {
    const expected = fastGlob
      .sync(pattern, {
        cwd: "/project",
        absolute: true,
        dot: true,
        onlyFiles: true,
        unique: true,
        fs
      })
      .sort();
    const actual = (await globFiles({ pattern, cwd: "/project", fs: fs.promises })).sort();
    assert.deepEqual(actual, expected, pattern);
  }
});

test("static absent paths and cyclic symlink traversal terminate while noncyclic aliases remain visible", async () => {
  const volume = Volume.fromJSON({ "/project/src/a.ts": "" });
  volume.symlinkSync("/project", "/project/src/cycle");
  volume.symlinkSync("/project/src", "/project/alias");
  const fs = createFsFromVolume(volume).promises;
  assert.deepEqual(await globFiles({ pattern: "missing/**/*.ts", cwd: "/project", fs }), []);
  assert.deepEqual((await globFiles({ pattern: "**/*.ts", cwd: "/project", fs })).sort(), [
    "/project/alias/a.ts",
    "/project/src/a.ts"
  ]);
});

test("file argument getters and persistence effects remain ordered", async () => {
  const outcomes = [];
  for (const factory of [referenceFiles, ownFiles]) {
    const reads = [];
    const base = createFsFromVolume(Volume.fromJSON({ "/project/a.txt": "aa\naa\n" })).promises;
    const fs = new Proxy(base, {
      get(target, key) {
        const value = target[key];
        if (typeof value !== "function") return value;
        return (...args) => {
          reads.push([key, ...args]);
          return value.apply(target, args);
        };
      }
    });
    const args = Object.fromEntries(
      Object.entries({
        command: "str_replace",
        path: "a.txt",
        old_str: "aa",
        new_str: "$&",
        replace_all: true
      }).map(([key, value]) => [key, { value }])
    );
    const request = {};
    for (const [key, entry] of Object.entries(args))
      Object.defineProperty(request, key, {
        get() {
          reads.push(key);
          return entry.value;
        }
      });
    const result = await call(factory({ cwd: "/project", fs }), "edit_file", request);
    // Atomic temp names differ; retain filesystem operation order and file content.
    outcomes.push({
      result,
      content: await base.readFile("/project/a.txt", "utf8"),
      reads: reads.map((value) => (Array.isArray(value) ? value[0] : value))
    });
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});

test("bulk glob matching preserves the official file-selection flags", () => {
  const paths = Array.from(
    { length: 128 },
    (_, index) =>
      `${["src", "test", ".hidden", "deep/sub"][index % 4]}/${["a", "b", "foo", "bar"][index % 4]}${index}.${index % 3 ? "ts" : "js"}`
  );
  const files = Object.fromEntries(paths.map((path) => ["/project/" + path, ""]));
  const fs = createFsFromVolume(Volume.fromJSON(files));
  for (const pattern of ["**/*.ts", "{src,test}/*", "**/!(foo*).ts", "**/[ab]*.js"]) {
    const expected = new Set(
      fastGlob.sync(pattern, { cwd: "/project", dot: true, onlyFiles: true, fs })
    );
    const glob = new native.NativeAgentGlob(pattern);
    assert.deepEqual(
      glob.matchPaths(paths),
      paths.map((path) => expected.has(path)),
      pattern
    );
  }
});
