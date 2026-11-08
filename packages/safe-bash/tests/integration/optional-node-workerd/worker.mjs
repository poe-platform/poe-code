import { Shell, agentCommands } from "@poe-platform/safe-bash";
import { nodeCommands } from "@poe-platform/safe-bash/commands/node";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { run, Budget, makeFsModule, declareHostOperation } from "@poe-platform/safe-js/workerd";

const runtime = { run, makeFsModule, declareHostOperation, createBudget: options => new Budget(options) };
const bytes = text => new TextEncoder().encode(text);
const text = value => new TextDecoder().decode(value);
const quote = source => "'" + source.replaceAll("'", "'\\''") + "'";
const command = source => "node -e " + quote(source);
function check(condition, message) { if (!condition) throw new Error(message); }
function environment(limits = {}, fs = createMemoryFileSystem()) {
  const errors = [];
  const shell = new Shell({ fs, onInternalError: error => errors.push(error) }).use(nodeCommands({ runtime, limits }));
  return { shell, fs, errors };
}
async function success(shell, source, stdout = "") {
  const result = await shell.exec(command(source));
  check(result.exitCode === 0 && result.stdout === stdout && result.stderr === "", JSON.stringify(result));
}

export default {
  async test() {
    const results = [];
    const ordinary = environment();
    try {
      await ordinary.fs.writeFile("/input", bytes("virtual"));
      await success(ordinary.shell, 'const fs = require("node:fs/promises"); const value = await fs.readFile("/input", "utf8"); await fs.writeFile("/output", value + ":written"); console.log(await fs.readFile("/output", "utf8"));', "virtual:written\n");
      check(text(await ordinary.fs.readFile("/output")) === "virtual:written", "VFS write missing");
      for (const source of ['require("node:child_process")', 'require("fs")']) {
        check((await ordinary.shell.exec(command(source))).exitCode === 1, "native module unexpectedly admitted");
      }
      await success(ordinary.shell, "1");
      results.push("public VFS read/write and native-module refusal");
    } finally { await ordinary.shell.dispose(); }

    for (const specimen of [
      { resource: "maxSourceBytes", limits: { maxSourceBytes: 2 }, source: 'console.log("long source")' },
      { resource: "maxOutputBytes", limits: { maxOutputBytes: 2 }, source: 'console.log("long output")' },
      { resource: "maxSteps", limits: { maxSteps: 100 }, source: "while (true) {}", budget: "steps" },
      { resource: "maxCallDepth", limits: { maxCallDepth: 8 }, source: "function recurse() { return recurse(); } recurse();", budget: "callDepth" },
      { resource: "stringLength", limits: { stringLength: 128 }, source: 'const value = "x".repeat(129);', budget: "stringLength" },
      { resource: "arrayLength", limits: { arrayLength: 128 }, source: "const value = new Array(129);", budget: "arrayLength" },
      { resource: "dataSize", limits: { dataSize: 65536 }, source: 'const value = "x".repeat(70000);', budget: "dataSize" },
    ]) {
      const { shell, errors } = environment(specimen.limits);
      try {
        const result = await shell.exec(command(specimen.source));
        check(result.exitCode === 124, `${specimen.resource}: ${JSON.stringify(result)}`);
        if (specimen.budget) check(errors.some(error => error?.code === "budgetExceeded" && error.budget === specimen.budget), `${specimen.resource}: wrong failure ${JSON.stringify(errors)}`);
        else check(result.stderr.includes(specimen.resource), `${specimen.resource}: wrong diagnostic ${result.stderr}`);
        await success(shell, "1");
        results.push({ resource: specimen.resource, status: result.exitCode });
      } finally { await shell.dispose(); }
    }

    for (const reason of [Object.freeze({ cancelled: "owned reason" }), false]) {
      const backing = createMemoryFileSystem();
      await backing.writeFile("/held", bytes("held"));
      let entered;
      const entry = new Promise(resolve => { entered = resolve; });
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      let completed;
      const completion = new Promise(resolve => { completed = resolve; });
      let lateWrites = 0;
      const output = [];
      const fs = new Proxy(backing, { get(target, property) {
        if (property === "readFile") return async (path, options) => {
          if (path === "/held") { entered(); await pending; completed(); return bytes("late host success"); }
          return target.readFile(path, options);
        };
        if (property === "writeFile") return async (path, value, options) => {
          if (path === "/late") lateWrites++;
          return target.writeFile(path, value, options);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const active = environment({}, fs);
      const sibling = environment();
      const controller = new AbortController();
      const execution = active.shell.exec(command('const fs = require("node:fs/promises"); await fs.readFile("/held", "utf8"); await fs.writeFile("/late", "wrong"); console.log("late");'), { signal: controller.signal, stdout: { async write(chunk) { output.push(new Uint8Array(chunk)); } } });
      const observed = execution.then(result => ({ result }), error => ({ error }));
      try {
        await entry;
        await success(sibling.shell, 'console.log("sibling")', "sibling\n");
        controller.abort(reason);
        release();
        await completion;
        const outcome = await observed;
        check("error" in outcome && outcome.error === reason, "cancellation identity changed");
        await new Promise(resolve => setTimeout(resolve, 0));
        await success(active.shell, 'console.log("after")', "after\n");
        check(lateWrites === 0 && output.length === 0, "cancelled guest attempted a later effect");
        let absent = false;
        try { await backing.stat("/late"); } catch (error) { absent = error.code === "ENOENT"; }
        check(absent, "cancelled guest published a later effect");
        results.push({ cancellation: typeof reason, sibling: true, subsequent: true });
      } finally { release(); await Promise.all([active.shell.dispose(), sibling.shell.dispose()]); }
    }

    const defaults = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      for (const name of ["node", "safejs", "op"]) check(!defaults.commands.has(name), `${name} entered the default preset`);
      results.push("optional commands remain absent from defaults");
    } finally { await defaults.dispose(); }
    console.log("OPTIONAL_NODE_WORKERD_PASS " + JSON.stringify({ cases: results.length, results }));
  },
};
