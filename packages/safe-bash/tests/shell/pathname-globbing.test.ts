import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

for (const [sort, expected] of [
  ["", ["a.log", "b space.log", "c.log"]],
  ["-name", ["c.log", "b space.log", "a.log"]],
  ["size", ["b space.log", "c.log", "a.log"]],
  ["-size", ["a.log", "c.log", "b space.log"]],
  ["+size", ["b space.log", "c.log", "a.log"]],
  ["-", ["c.log", "b space.log", "a.log"]],
  ["-invalid", ["a.log", "b space.log", "c.log"]],
] as const) {
  for (const pattern of ["*.log", "./*.log", "**/*.log"]) {
    test(`GLOBSORT=${sort} orders ${pattern} script arguments`, async () => {
      const { fs, shell } = setup({ env: { LC_ALL: "C" } });
      await fs.writeFile("/a.log", new TextEncoder().encode("1234"));
      await fs.writeFile("/b space.log", new TextEncoder().encode("3"));
      await fs.writeFile("/c.log", new TextEncoder().encode("12"));
      try {
        const result = await shell.exec(`${pattern.includes("**") ? "shopt -s globstar; " : ""}GLOBSORT='${sort}'; set -- ${pattern}; args "$@"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(JSON.parse(result.stdout), expected.map(name => pattern.startsWith("./") ? `./${name}` : name));
      } finally { await shell.dispose(); }
    });
  }
}

test("GLOBSORT size follows symlinks and breaks ties by name", async () => {
  const { fs, shell } = setup({ env: { LC_ALL: "C" } });
  await fs.writeFile("/a.log", new TextEncoder().encode("1234"));
  await fs.writeFile("/b space.log", new TextEncoder().encode("3"));
  await fs.writeFile("/c.log", new TextEncoder().encode("12"));
  await fs.writeFile("/d.log", new TextEncoder().encode("12"));
  await fs.symlink("a.log", "/e.log");
  await fs.symlink("missing", "/f.log");
  try {
    const expected = ["f.log", "b space.log", "c.log", "d.log", "a.log", "e.log"];
    for (const sort of ["size", "-size"]) {
      const result = await shell.exec(`GLOBSORT=${sort}; args *.log`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), sort === "size" ? expected : [...expected].reverse());
    }
  } finally { await shell.dispose(); }
});

test("GLOBSORT changes take effect for repeated function glob words", async () => {
  const { fs, shell } = setup();
  await fs.writeFile("/a.log", new TextEncoder().encode("12"));
  await fs.writeFile("/b.log", new TextEncoder().encode("1"));
  try {
    const result = await shell.exec('f() { args *.log; }; f; GLOBSORT=size; f; unset GLOBSORT; f');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, '["a.log","b.log"]["b.log","a.log"]["a.log","b.log"]');
  } finally { await shell.dispose(); }
});

for (const options of ["", "shopt -s nocaseglob; ", "shopt -s globstar; "]) {
  test(`pathname expansion preserves literal directory separators (${options || "default"})`, async () => {
    const { fs, shell } = setup({ cwd: "/group", env: { LC_ALL: "C" } });
    await fs.mkdir("/group/sub", { recursive: true });
    await fs.writeFile("/group/item one", new Uint8Array());
    await fs.writeFile("/group/sub/item two", new Uint8Array());
    try {
      const absolute = await shell.exec(`${options}args ///g*//item*`);
      assert.equal(absolute.exitCode, 0);
      assert.equal(absolute.stderr, "");
      assert.deepEqual(JSON.parse(absolute.stdout), ["///group/item one"]);
      const result = await shell.exec(`${options}cd /; dir=group/; args "$dir"/item* group///item* group//sub///item* ///group//item* .//group///item*; dir=group; args "$dir"/item* g*//item* group//s*///item* g*//sub///item* group///missing*`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, JSON.stringify([
        "group//item one", "group///item one", "group//sub///item two",
        "///group//item one", ".//group///item one",
      ]) + JSON.stringify([
        "group/item one", "group/item one", "group//sub/item two",
        "group/sub/item two", "group///missing*",
      ]));
    } finally { await shell.dispose(); }
  });
}

for (const globstar of [false, true]) {
  test(`pathname expansion preserves dangling links (globstar=${globstar})`, async () => {
    const { fs, shell } = setup();
    await fs.symlink("/missing", "/broken_link");
    await fs.mkdir("/directory");
    await fs.symlink("/directory", "/dir_link");
    try {
      const prefix = globstar ? "shopt -s globstar; " : "";
      const pattern = globstar ? "**/" : "";
      const result = await shell.exec(`${prefix}args ${pattern}broken* ${pattern}broken*/ ${pattern}dir*/`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), ["broken_link", `${pattern}broken*/`, "dir_link/", "directory/"]);
    } finally { await shell.dispose(); }
  });

  for (const prefix of ["./", "../", "./../"]) {
    test(`nocaseglob preserves ${prefix} (globstar=${globstar})`, async () => {
      const { fs, shell } = setup({ cwd: "/work" });
      await fs.mkdir("/work/sub", { recursive: true });
      await fs.mkdir("/sub");
      await fs.writeFile("/work/sub/Hello.TXT", new Uint8Array());
      await fs.writeFile("/sub/Hello.TXT", new Uint8Array());
      try {
        const pattern = `${prefix}${globstar ? "**/" : "SUB/"}*.txt`;
        const result = await shell.exec(`shopt -s nocaseglob ${globstar ? "globstar" : ""}; args ${pattern}`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        const expected = [`${prefix}sub/Hello.TXT`];
        if (globstar && prefix !== "./") expected.push(`${prefix}work/sub/Hello.TXT`);
        assert.deepEqual(JSON.parse(result.stdout), expected);
      } finally { await shell.dispose(); }
    });
  }

  for (const wildcard of ["*", "?ile", "[f]ile"]) {
    test(`escaped backslash before ${wildcard} (globstar=${globstar})`, async () => {
      const { fs, shell } = setup();
      await fs.writeFile("/bs\\file", new Uint8Array());
      try {
        const prefix = globstar ? "**/" : "";
        const result = await shell.exec(`${globstar ? "shopt -s globstar; " : ""}args ${prefix}bs\\\\${wildcard} ${prefix}'bs\\'${wildcard} '${prefix}bs\\${wildcard}' ${prefix}bs\\\\\\*`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.deepEqual(JSON.parse(result.stdout), ["bs\\file", "bs\\file", `${prefix}bs\\${wildcard}`, `${prefix}bs\\*`]);
      } finally { await shell.dispose(); }
    });
  }
}
