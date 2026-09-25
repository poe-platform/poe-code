import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";

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
