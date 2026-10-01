import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/commands/index.js";

const bodies = [
  ['group', '{ x=$((x+1)); echo "ran:$x"; echo $v; }'],
  ['if', 'if [ $x -eq 0 ]; then x=$((x+1)); echo "ran:$x"; echo $v; fi'],
  ['case', 'case ok in ok) x=$((x+1)); echo "ran:$x"; echo $v ;; esac'],
  ['eval', `eval 'x=$((x+1)); echo "ran:$x"; echo $v'`],
  ['function', 'f() { x=$((x+1)); echo "ran:$x"; echo $v; }; f arg1'],
] as const;

for (const [source, expected] of [
  ['i=0; sum=0; while ((i<4)); do ((sum+=i, i++)); done', '4:6:0\n'],
  ['i=-2; sum=10; while ((i<=2)); do ((sum-=i, i++)); done', '3:10:0\n'],
  ['i=-1; sum=10; while ((i<=0)); do ((sum=i, i++)); done', '1:0:1\n'],
  ['i=04; sum=007; while ((i<4)); do ((sum+=i, i++)); done', '04:007:0\n'],
] as const) test(`closed-form while arithmetic preserves values and status: ${source}`, async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const result = await shell.exec(`${source}; say "$i:$sum:$?"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

for (const [name, body] of bodies) test(`${name} resumes without replaying or skipping effects`, async context => {
  const { shell } = setup();
  shell.use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(`x=0; v="a b"; ${body}; echo "final:$x"`);
  assert.equal(result.stdout, "ran:1\na b\nfinal:1\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const kind of ["while", "until"] as const) {
  for (const incrementFirst of [false, true]) test(`${kind} preserves each iteration on dynamic fallback (${incrementFirst})`, async context => {
    const { shell } = setup();
    shell.use(standardCommands());
    context.after(() => shell.dispose());
    const condition = kind === "while" ? '[ $i -lt 5 ]' : '[ $i -ge 5 ]';
    const increment = 'i=$((i+1));';
    const result = await shell.exec(`i=0; v=hello; ${kind} ${condition}; do ${incrementFirst ? increment : ''} echo "iter:$i"; if [ $i -eq 3 ]; then v="a b c"; fi; echo $v; ${incrementFirst ? '' : increment} done`);
    const start = incrementFirst ? 1 : 0;
    const expected = Array.from({ length: 5 }, (_, offset) => {
      const i = start + offset;
      return `iter:${i}\n${i < 3 ? 'hello' : 'a b c'}\n`;
    }).join('');
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });

  test(`${kind} in a function yields before exhausting its loop budget`, async context => {
    const { shell } = setup({ limits: { maxLoopIterations: 10000 } });
    shell.use(standardCommands());
    context.after(() => shell.dispose());
    const controller = new AbortController();
    const reason = new Error("timer cancellation");
    const timer = setTimeout(() => controller.abort(reason), 0);
    context.after(() => clearTimeout(timer));
    const condition = kind === "while" ? '((i < 300000))' : '((i >= 300000))';
    await assert.rejects(shell.exec(`f() { i=0; ${kind} ${condition}; do ((i++)); done; }; f arg1`, { signal: controller.signal }), error => error === reason);
  });
}

for (const kind of ["while", "until"] as const) {
  test(`${kind} yields without a caller signal and preserves arithmetic progress`, async context => {
    const { shell } = setup();
    context.after(() => shell.dispose());
    let yielded = false;
    const turn = setImmediate(() => { yielded = true; });
    context.after(() => clearImmediate(turn));
    const condition = kind === "while" ? "i<3000" : "i>=3000";
    const result = await shell.exec(`i=0; total=0; ${kind} ((${condition})); do ((i+=1)); ((total+=i)); done; say "$i:$total"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "3000:4501500\n");
    assert.equal(yielded, true);
  });

  test(`${kind} honors the original 30ms timer during 300000 iterations`, async context => {
    const { shell } = setup();
    shell.use(standardCommands());
    context.after(() => shell.dispose());
    const controller = new AbortController();
    const reason = new Error("timer cancellation");
    const timer = setTimeout(() => controller.abort(reason), 30);
    context.after(() => clearTimeout(timer));
    const condition = kind === "while" ? '((i < 300000))' : '((i >= 300000))';
    await assert.rejects(shell.exec(`i=0; ${kind} ${condition}; do ((i++)); done; echo done:$i`, {
      signal: controller.signal,
    }), error => error === reason);
    assert.equal(controller.signal.aborted, true);
  });
}

test("portable loops honor timer cancellation without Node globals", async context => {
  const { api } = await portableRuntime('export * from "./packages/safe-bash/src/core.ts";');
  for (const kind of ["while", "until"] as const) {
    await context.test(kind, async context => {
      const shell = new api.Shell({ fs: new api.MemoryFileSystem() }).use(api.agentCommands());
      context.after(() => shell.dispose());
      const controller = new AbortController();
      const reason = new Error("portable timer cancellation");
      const timer = setTimeout(() => controller.abort(reason), 30);
      context.after(() => clearTimeout(timer));
      const condition = kind === "while" ? '((i < 300000))' : '((i >= 300000))';
      await assert.rejects(shell.exec(`i=0; ${kind} ${condition}; do ((i++)); done`, {
        signal: controller.signal,
      }), error => error === reason);

      let yielded = false;
      const turn = setImmediate(() => { yielded = true; });
      context.after(() => clearImmediate(turn));
      const finiteCondition = kind === "while" ? "i<3000" : "i>=3000";
      const result = await shell.exec(`i=0; total=0; ${kind} ((${finiteCondition})); do ((i+=1)); ((total+=i)); done; echo "$i:$total"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "3000:4501500\n");
      assert.equal(yielded, true);
    });
  }
});
