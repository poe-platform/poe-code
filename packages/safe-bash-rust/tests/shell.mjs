import { createRustWasmBash } from "@poe-code/safe-bash-rust";

async function test() {
  const [shell, other] = await Promise.all([
    createRustWasmBash({ cwd: "/", files: { "/items": "z\na\na\n" }, symlinks: { "/alias": "/items" } }),
    createRustWasmBash({ cwd: "/" }),
  ]);
  try {
    if (shell.instance.exports.memory === other.instance.exports.memory) throw new Error("shared shell memory");
    const stat = await shell.fs.stat("/items"), alias = await shell.fs.stat("/alias");
    if (!stat.identityScope || stat.identityScope !== alias.identityScope || stat.ino !== alias.ino)
      throw new Error("alias lost the file identity");
    shell.register({ name: "records", async execute(ctx) {
      await ctx.stdout.write(await ctx.fs.readFile("/alias"));
      return { exitCode: 0 };
    } });
    const input = (async function* () { yield new TextEncoder().encode("b\n"); })();
    const result = await shell.exec("{ records; cat; } | LC_ALL=C sort | uniq", { stdin: input });
    if (result.exitCode || result.stderr || result.stdout !== "a\nb\nz\n") throw new Error(JSON.stringify(result));
  } finally { await Promise.all([shell.dispose(), other.dispose()]); }
}

export default { test };
