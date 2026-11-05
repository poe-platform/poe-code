import { createRustWasmBash } from "@poe-code/safe-bash-rust";

export default {
  async test() {
    const shell = await createRustWasmBash({ cwd: "/", files: { "/items": "z\na\na\n" }, symlinks: { "/alias": "/items" } });
    try {
      const first = await shell.fs.stat("/items"), alias = await shell.fs.stat("/alias");
      if (typeof first.identityScope !== "symbol" || first.identityScope !== alias.identityScope || first.ino !== alias.ino)
        throw new Error("alias lost the file identity");
      shell.register({ name: "records", async execute(ctx) {
        const bytes = await ctx.fs.readFile("/items");
        await ctx.stdout.write(bytes);
        return { exitCode: 0 };
      } });
      const input = (async function* () { yield new TextEncoder().encode("b\n"); })();
      const result = await shell.exec("{ records; cat; } | sort | uniq", { stdin: input });
      if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "a\nb\nz\n") throw new Error(JSON.stringify(result));
    } finally { await shell.dispose(); }
  }
};
