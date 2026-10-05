import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { filesystem, run } from "./helpers.test-support.js";

for (const format of ["-q", "-u"]) test(`recursive diff releases completed pair inspection receipts: ${format}`, async t => {
  const fs = await filesystem({ "left/seed": "same\n", "right/seed": "same\n" });
  for (let index = 0; index < 128; index++) {
    await fs.writeFile(`/work/left/item-${index}`, new TextEncoder().encode("same\n"));
    await fs.writeFile(`/work/right/item-${index}`, new TextEncoder().encode("same\n"));
  }
  const step = Budget.prototype.step;
  let peak = 0;
  t.mock.method(Budget.prototype, "step", function(this: Budget, amount?: number) {
    peak = Math.max(peak, this.inspected.size);
    step.call(this, amount);
  });
  const result = await run("diff", ["-r", format, "left", "right"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  // root, cwd, two operand directories and two current files; independent of width.
  assert.ok(peak <= 6, `retained ${peak} inspection receipts for a flat pair`);
});

test("diff releases exclusion source receipts between files", async t => {
  const fs = await filesystem({ "left/item": "same\n", "right/item": "same\n", "patterns/seed": "unused\n" });
  const args: string[] = [];
  for (let index = 0; index < 128; index++) {
    await fs.writeFile(`/work/patterns/item-${index}`, new TextEncoder().encode("unused\n"));
    args.push("-X", `patterns/item-${index}`);
  }
  let peak = 0;
  const step = Budget.prototype.step;
  t.mock.method(Budget.prototype, "step", function(this: Budget, amount?: number) {
    peak = Math.max(peak, this.inspected.size);
    step.call(this, amount);
  });
  const result = await run("diff", [...args, "-r", "left", "right"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(peak <= 6, `retained ${peak} exclusion or operand inspection receipts`);
});

for (const source of ["operand", "exclusion"]) for (const format of ["-q", "-u"]) {
  test(`diff retains current receipt race protection after releasing ${source} receipts: ${format}`, async () => {
    const fs = await filesystem({ "left/a": "same\n", "right/a": "same\n", "left/b": "same\n", "right/b": "same\n",
      "patterns/a": "unused\n", "patterns/b": "unused\n" });
    const path = source === "operand" ? "/work/left/b" : "/work/patterns/b";
    const open = fs.openReadFile.bind(fs);
    let changed = false, opened = 0, closed = 0;
    const observed = new Proxy(fs, { get(target, key) {
      if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
      if (args[0] === path) { await fs.writeFile(path, new TextEncoder().encode("changed\n")); changed = true; }
      const handle = await open(...args); opened++;
      return new Proxy(handle, { get(target, key) {
        if (key === "close") return async () => { closed++; await target.close(); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await run("diff", ["-X", "patterns/a", "-X", "patterns/b", "-r", format, "left", "right"], { fs: observed });
    assert.equal(changed, true, result.stderr);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /diff input changed while opening/u);
    assert.equal(result.stdout, "");
    assert.equal(opened, closed);
  });
}
