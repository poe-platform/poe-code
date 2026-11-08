export async function safety(helpers) {
  const { api, column, corpus, check, direct, shell, memory, source, gate, tick, bounded, retain, hex, assert } = helpers;
  const recipes = new Map(corpus.safetyRecipes.map((recipe) => [recipe.id, recipe]));
  for (const id of ["S29", "S30", "S31", "S32", "S33", "S34"]) {
    const recipe = recipes.get(id);
    for (const [index, variant] of recipe.variants.entries()) await check(id, `literal-${index + 1}`, async (record) => {
      const passing = (id === "S29" && index === 0) || (id === "S30" && index === 0) || (id === "S31" && index === 0) || (id === "S33" && index === 0) || (id === "S34" && index === 3);
      let pulls = 0;
      const chunks = variant.chunksHex?.map((value) => Buffer.from(value, "hex"));
      const input = variant.sourceRecipe ? source([...Array.from({ length: variant.sourceRecipe.emptyChunks }, () => Buffer.alloc(0)), Buffer.from(variant.sourceRecipe.thenUtf8)]) : undefined;
      const poison = { [Symbol.asyncIterator]() { pulls++; throw new Error("validation must precede input admission"); } };
      const config = { argv: variant.argv ?? recipe.argv, stdinUtf8: variant.stdinUtf8, files: recipe.files, chunks, source: id === "S34" && !passing ? poison : input, limits: variant.limits };
      const result = await direct(config);
      retain(record, result);
      record.literalRecipeVariant = variant;
      if (id === "S33" && index === 3) {
        record.qualification = "Unchanged maxWidth=1,000,000,000 recipe exceeds the documented 67,108,864 configuration ceiling; bounded factory refusal, not proof of allocating safely at an admitted billion-wide setting.";
        assert(result.rejection !== null);
      } else {
        assert.equal(result.rejection, null);
        assert.equal(result.status, passing ? 0 : 1);
      }
      if (id === "S34" && !passing) assert.equal(pulls, 0);
      if (id === "S33") assert(result.stdoutHex.length / 2 <= variant.limits.maxOutputBytes);
      if (passing && id === "S29") assert.equal(result.stdoutHex, hex(Buffer.from("a  b\nc  d\n")));
      if (passing && id === "S31") assert.equal(result.stdoutHex, hex(Buffer.from("é  x\n")));
      if (passing && id === "S33") assert.equal(result.stdoutHex, hex(Buffer.from("a  b\nc  d\n")));
    });
  }

  await check("S33", "admitted-padding-before-repeat", async (record) => {
    const original = String.prototype.repeat;
    const calls = [];
    String.prototype.repeat = function (count) { calls.push({ character: String(this), count }); return original.call(this, count); };
    try {
      const long = Array.from({ length: 512 }, () => "x").join("");
      const result = await direct({ argv: ["-t", "-s", ":"], stdinUtf8: `${long}:a\nb:c\n`, limits: { maxOutputBytes: 530 } });
      retain(record, result); record.repeatCalls = calls;
      assert.equal(result.status, 1);
      assert(result.stdoutHex.length / 2 <= 530);
      assert(!calls.some((call) => call.count >= 511), "Oversized padding was allocated before output admission");
    } finally { String.prototype.repeat = original; }
  });

  for (const variant of recipes.get("S35").variants) await check("S35", variant.abortAt, async (record) => {
    const controller = new AbortController();
    const reason = variant.reason.type === "primitive-string" ? variant.reason.value : { ...variant.reason };
    const fs = await memory({ "one.txt": "a b\n", "two.txt": "c d\n" });
    const entered = gate(), read = gate(), returned = gate(), written = gate();
    const events = []; let pulls = 0, returns = 0;
    const stream = { [Symbol.asyncIterator]() { events.push("acquire"); return {
      async next() { pulls++; if (pulls === 1) return { done: false, value: Buffer.from("a b\n") }; entered.resolve(); return read.promise; },
      async return() { returns++; events.push("return"); returned.resolve(); return { done: true }; },
    }; } };
    const wrapped = new Proxy(fs, { get(target, key) { if (key === "readStream" && variant.abortAt === "after-first-chunk-before-next-resolves") return (path, options) => { events.push({ path, signalSupplied: Boolean(options?.signal) }); return stream; }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    const sink = variant.abortAt === "during-awaited-sink-write" ? { async write() { entered.resolve(); return written.promise; } } : undefined;
    if (variant.abortAt === "before-exec") controller.abort(reason);
    const operation = shell({ argv: recipes.get("S35").argv, files: recipes.get("S35").files, fs: wrapped, signal: controller.signal, stdout: sink });
    try {
      if (variant.abortAt !== "before-exec") { await bounded(entered.promise, variant.abortAt); controller.abort(reason); }
      const result = await bounded(operation, "actual Shell abort"); retain(record, result);
      record.events = events; record.pulls = pulls; record.returns = returns;
      assert.equal(result.rejectionValue, reason);
      if (variant.abortAt === "after-first-chunk-before-next-resolves") { assert.equal(returns, 1); assert(!events.some((event) => event?.path === "/two.txt")); }
    } finally { read.reject(new Error("late read rejection after abort")); written.reject(new Error("late write rejection after abort")); await operation; await tick(); }
  });

  for (const variant of recipes.get("S36").variants) await check("S36", variant.sink, async (record) => {
    const entered = gate(), release = gate();
    const controller = new AbortController();
    const sentinel = new Error("sink rejection sentinel");
    const abortReason = { code: "ENOENT", marker: "sink-abort" };
    let writes = 0, outstanding = 0, maximumOutstanding = 0, settled = false;
    const output = [];
    const sink = { async write(bytes) {
      writes++; outstanding++; maximumOutstanding = Math.max(maximumOutstanding, outstanding);
      try { if (writes === 1) { entered.resolve(); await release.promise; } output.push(new Uint8Array(bytes)); }
      finally { outstanding--; }
    } };
    const operation = direct({ stdinUtf8: recipes.get("S36").stdinUtf8, stdout: sink, signal: controller.signal }).then((result) => { settled = true; return result; });
    try {
      await bounded(entered.promise, "first sink write"); await tick(); await tick();
      assert.equal(writes, 1); assert.equal(settled, false);
      if (variant.sink === "retain-first-write-until-explicit-release") release.resolve();
      else if (variant.sink === "first-write-rejects-sentinel") release.reject(sentinel);
      else { controller.abort(abortReason); release.reject(sentinel); }
      const result = await bounded(operation, "sink settlement"); retain(record, result);
      record.sink = { writes, maximumOutstanding, stdoutHex: hex(Buffer.concat(output)) };
      assert.equal(maximumOutstanding, 1);
      if (variant.sink === "retain-first-write-until-explicit-release") { assert.equal(result.status, 0); assert.equal(record.sink.stdoutHex, hex(Buffer.from("a   b\ncc  d\n"))); }
      else { assert.notEqual(result.status, 0); if (variant.sink === "abort-then-reject-pending-write-sentinel") assert.equal(result.rejectionValue, abortReason); }
    } finally { release.resolve(); await operation; }
  });

  for (const [index, variant] of recipes.get("S37").variants.entries()) await check("S37", `reuse-${index + 1}`, async (record) => {
    const fragments = variant.chunksHex.map((value) => Buffer.from(value, "hex"));
    const capacity = Math.max(...fragments.map((fragment) => fragment.length));
    const storage = variant.backing === "Uint8Array" ? new Uint8Array(capacity) : Buffer.alloc(capacity + 4).subarray(2, capacity + 2);
    let position = 0, returns = 0;
    const producer = { [Symbol.asyncIterator]() { return {
      async next() { storage.fill(0x58); if (position === fragments.length) return { done: true }; const fragment = fragments[position++]; storage.set(fragment); return { done: false, value: storage.subarray(0, fragment.length) }; },
      async return() { returns++; storage.fill(0x58); return { done: true }; },
    }; } };
    const result = await direct({ source: producer }); retain(record, result);
    record.pulls = position; record.returns = returns;
    assert.equal(result.status, 0);
    assert.equal(result.stdoutHex, hex(Buffer.from(recipes.get("S37").independentExpectedStdoutUtf8)));
  });

  for (const [index, variant] of recipes.get("S38").variants.entries()) await check("S38", variant.returnBehavior, async (record) => {
    const returned = gate(), release = gate(); const controller = new AbortController();
    const sentinel = new Error("cooperative return rejection"), abortReason = { marker: "return-abort" };
    let returns = 0, cleanup, settled = false;
    const producer = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a b\n") }; }, async return() { returns++; returned.resolve(); await release.promise; return { done: true }; } }; } };
    const operation = direct({ source: producer, limits: { maxInputBytes: 1 }, signal: controller.signal, onRegister(hook) { cleanup = hook; } }).then((value) => { settled = true; return value; });
    let first, second;
    try {
      await bounded(returned.promise, "cooperative return admission");
      first = cleanup(); second = cleanup(); void first.catch(() => {}); void second.catch(() => {});
      assert.equal(first, second); await tick(); assert.equal(settled, false);
      if (index === 2) controller.abort(abortReason);
      if (index === 0) release.resolve(); else release.reject(sentinel);
      const result = await bounded(operation, "cooperative direct finally"); retain(record, result);
      const hookResults = await Promise.allSettled([first, second]);
      record.returns = returns; record.overlapSharedPromise = first === second;
      record.hookResults = hookResults.map((value) => ({ status: value.status, reason: value.status === "rejected" ? String(value.reason) : null }));
      assert.equal(returns, 1);
      if (index === 0) assert(hookResults.every((value) => value.status === "fulfilled"));
      else assert(hookResults.every((value) => value.status === "rejected" && value.reason === sentinel));
      if (index === 2) assert.equal(result.rejectionValue, abortReason);
    } finally { release.resolve(); await operation; await Promise.allSettled([first, second]); }
  });

  await check("S38", "actual-owned-vfs-cleanup-failure-precedence", async (record) => {
    const fs = await memory({ "one.txt": "a b\n" });
    const returned = gate(), release = gate(); const sentinel = new Error("owned VFS return failed");
    let returns = 0, settled = false;
    const wrapped = new Proxy(fs, { get(target, key) { if (key === "readStream") return () => ({ [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a b\n") }; }, async return() { returns++; returned.resolve(); await release.promise; return { done: true }; } }; } }); const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    const operation = shell({ fs: wrapped, argv: ["-t", "one.txt"], limits: { maxInputBytes: 1 } }).then((value) => { settled = true; return value; });
    try {
      await bounded(returned.promise, "owned VFS return"); await tick(); assert.equal(settled, false);
      release.reject(sentinel); const result = await bounded(operation, "owned cleanup error settlement"); retain(record, result);
      record.returns = returns; assert.equal(returns, 1); assert.equal(result.rejectionValue, sentinel);
    } finally { release.resolve(); await operation; }
  });

  await check("S38", "known-root-hidden-external-stdin-return-boundary", async (record) => {
    const fs = await memory(); const host = new api.Shell({ fs }); host.use(column.columnCommands({ limits: { maxInputBytes: 1 } }));
    const entered = gate(), release = gate(); let returns = 0, execSettled = false, disposeSettled = false;
    const external = { [Symbol.asyncIterator]() { return { async next() { return { done: false, value: Buffer.from("a b\n") }; }, async return() { returns++; entered.resolve(); await release.promise; return { done: true }; } }; } };
    const operation = host.exec("column -t", { stdin: external }).then((value) => { execSettled = true; return { value }; }, (error) => { execSettled = true; return { error }; });
    let disposal;
    try {
      await bounded(entered.promise, "external borrowed source return");
      await tick(); await tick();
      disposal = host.dispose().then(() => { disposeSettled = true; });
      await tick(); await tick();
      record.observations.push({ returns, execSettledBeforeReturnRelease: execSettled, disposeSettledBeforeReturnRelease: disposeSettled, hiddenReturnGateReleased: false, owner: "Root ShellInput/Shell source ownership; column receives no return method" });
      assert.equal(execSettled, false, "Root boundary: Shell.exec settled before hidden external stdin.return completed");
      assert.equal(disposeSettled, false, "Root boundary: Shell.dispose settled before hidden external stdin.return completed");
    } finally { release.resolve(); const outcome = await operation; record.finalExitCode = outcome.value?.exitCode ?? null; record.finalError = outcome.error ? String(outcome.error) : null; await disposal; await host.dispose(); record.harnessGateReleasedAfterObservation = true; }
  });

  await check("S39", "pending-stat-is-opaque-no-late-acquisition", async (record) => {
    const fs = await memory({ "first.txt": "a b\n", "second.txt": "c d\n" });
    const entered = gate(), release = gate(); const controller = new AbortController(), reason = { marker: "pending-open" };
    let streams = 0; const events = [];
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "stat") return async (path, options) => { events.push({ stat: path, hasSignal: Boolean(options?.signal) }); entered.resolve(); await release.promise; return target.stat(path); };
      if (key === "readStream") return (...args) => { streams++; return target.readStream(...args); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = shell({ fs: wrapped, argv: recipes.get("S39").argv, signal: controller.signal });
    try {
      await bounded(entered.promise, "pending stat"); controller.abort(reason);
      const result = await bounded(operation, "opaque stat must not become cleanup barrier"); retain(record, result);
      assert.equal(result.rejectionValue, reason); release.resolve(); await tick(); await tick();
      record.events = events; record.streamsAfterLateStat = streams; assert.equal(streams, 0);
      record.qualification = "FileSystem.readStream acquisition is synchronous; an opaque stat promise is not an owned cooperative lease. This exact boundary complements, rather than weakens, the admitted-source barrier case.";
    } finally { release.resolve(); await operation; }
  });

  await check("S39", "registered-before-acquisition-owned-drain-and-dispose", async (record) => {
    const fs = await memory({ "first.txt": "a b\n", "second.txt": "c d\n" });
    const readEntered = gate(), pendingRead = gate(), returnEntered = gate(), releaseReturn = gate();
    const events = []; let returns = 0;
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "readStream") return (path, options) => { events.push({ acquired: path, signalSupplied: Boolean(options?.signal) }); return { [Symbol.asyncIterator]() { return { async next() { readEntered.resolve(); return pendingRead.promise; }, async return() { returns++; returnEntered.resolve(); await releaseReturn.promise; events.push("retired"); return { done: true }; } }; } }; };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const host = new api.Shell({ fs: wrapped });
    const definition = column.createColumnCommand();
    host.register({ name: "column", execute(context) {
      const original = context.registerCleanup;
      const adapted = new Proxy({}, { get(_target, key) { if (key === "registerCleanup") return (hook) => { events.push("registered"); original(hook); }; return Reflect.get(context, key, context); } });
      return definition.execute(adapted);
    } });
    const controller = new AbortController(), reason = { marker: "owned-close" };
    let execSettled = false, disposeSettled = false;
    const operation = host.exec("column -t first.txt second.txt", { signal: controller.signal }).then((value) => { execSettled = true; return { value }; }, (error) => { execSettled = true; return { error }; });
    let disposal;
    try {
      await bounded(readEntered.promise, "owned input read"); controller.abort(reason);
      disposal = host.dispose().then(() => { disposeSettled = true; });
      await bounded(returnEntered.promise, "owned return after abort"); await tick();
      record.beforeRelease = { execSettled, disposeSettled, returns, events: [...events] };
      assert.equal(execSettled, false); assert.equal(disposeSettled, false); assert.equal(events[0], "registered");
      releaseReturn.resolve(); const result = await bounded(operation, "owned exec drain"); await bounded(disposal, "owned disposal drain");
      assert.equal(result.error, reason); assert.equal(returns, 1); assert.equal(events.filter((event) => event?.acquired).length, 1);
      record.afterRelease = { execSettled, disposeSettled, returns, events };
    } finally { releaseReturn.resolve(); pendingRead.reject(new Error("late opaque read rejection")); await operation; await disposal; await host.dispose(); await tick(); }
  });

  await check("S40", "actual-complex-pipeline-vfs-byte-effects", async (record) => {
    const recipe = recipes.get("S40"); const fs = await memory();
    const result = await shell({ fs, command: "emit | column -t -s : -o '|' | copy > /out; copy < /out", setup(host) {
      host.register({ name: "emit", async execute(context) { for (const text of ["a:", "b\nlo", "ng:c\n"]) await context.stdout.write(Buffer.from(text)); return { exitCode: 0 }; } });
      host.register({ name: "copy", async execute(context) { for await (const chunk of context.stdin) await context.stdout.write(chunk); return { exitCode: 0 }; } });
    } });
    retain(record, result); record.outputFileHex = hex(await fs.readFile("/out"));
    assert.equal(result.status, 0); assert.equal(result.stdoutHex, hex(Buffer.from(recipe.independentExpectedStdoutUtf8))); assert.equal(record.outputFileHex, result.stdoutHex);
  });
  await check("S40", "actual-literal-nested-invoke-and-env", async (record) => {
    const recipe = recipes.get("S40"); const seen = [];
    const result = await shell({ stdinUtf8: recipe.inputUtf8, env: { PARENT: "kept" }, command: "nested", setup(host) {
      host.use(async (context, next) => { seen.push({ command: context.command, stdinIsDefault: context.stdinIsDefault, environment: { ...context.env } }); return await next(); });
      host.register({ name: "nested", execute(context) { return context.invoke("column", recipe.literalArgv, { stdin: context.stdin, stdinIsDefault: context.stdinIsDefault, replaceEnv: true, env: { ONLY: "child" } }); } });
    } });
    retain(record, result); record.middleware = seen;
    assert.equal(result.status, 0); assert.equal(result.stdoutHex, hex(Buffer.from(recipe.independentExpectedStdoutUtf8)));
    const child = seen.find((value) => value.command === "column"); assert.deepEqual(child.environment, { ONLY: "child" }); assert.equal(child.stdinIsDefault, false);
  });
  await check("S40", "standalone-plugin-collision-replace", async (record) => {
    const original = { name: "column", async execute() { return { exitCode: 9 }; } };
    const fs = await memory(); const collision = new api.Shell({ fs }); collision.register(original); collision.use(column.columnCommands());
    try { await assert.rejects(collision.exec("column")); assert.equal(collision.commands.get("column").execute, original.execute); } finally { await collision.dispose(); }
    const replaced = new api.Shell({ fs }); replaced.register(original); replaced.use(column.columnCommands({ replace: true }));
    try { const result = await replaced.exec("column -t", { stdin: "a b\n" }); record.observations.push({ status: result.exitCode, stdoutHex: hex(result.stdoutBytes), commands: replaced.commands.list().map((entry) => entry.name) }); assert.equal(result.exitCode, 0); assert.deepEqual(replaced.commands.list().map((entry) => entry.name), ["column"]); } finally { await replaced.dispose(); }
  });

  await check("X01", "nonenumerable-frozen-context-keeps-caller-structure", async (record) => {
    const result = await direct({ stdinUtf8: "a b\n", context(context) {
      const frozen = Object.create(null);
      for (const key of Reflect.ownKeys(context)) Object.defineProperty(frozen, key, { value: context[key], enumerable: false, writable: false, configurable: false });
      return Object.freeze(frozen);
    } });
    retain(record, result); record.basis = "Additional concrete context-adapter regression; original forty recipe inputs/expectations remain unchanged.";
    assert.equal(result.status, 0); assert.equal(result.stdoutHex, hex(Buffer.from("a  b\n")));
  });
  await check("X02", "emoji-without-forbidden-zwj", async (record) => {
    const result = await shell({ stdinUtf8: "😀 x\na y\n" }); retain(record, result);
    assert.equal(result.status, 0); assert.equal(result.stdoutHex, hex(Buffer.from("😀  x\na   y\n")));
  });
  await check("X03", "late-fallback-readFile-rejection", async (record) => {
    const fs = await memory({ "one.txt": "a b\n" }); const entered = gate(), release = gate();
    const controller = new AbortController(), reason = { code: "EIO", marker: "fallback-abort" }; let sawSignal = false;
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "readStream") return undefined;
      if (key === "readFile") return async (_path, options) => { sawSignal = Boolean(options?.signal); entered.resolve(); return release.promise; };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const operation = shell({ fs: wrapped, argv: ["-t", "one.txt"], signal: controller.signal });
    try { await bounded(entered.promise, "fallback readFile"); controller.abort(reason); const result = await bounded(operation, "opaque fallback abort"); retain(record, result); assert.equal(result.rejectionValue, reason); assert.equal(sawSignal, true); }
    finally { release.reject(new Error("late fallback failure")); await operation; await tick(); }
  });
  await check("X04", "iterator-read-failure-has-no-layout-publication", async (record) => {
    const fs = await memory({ "first.txt": "a b\n", "second.txt": "c d\n" }); let pulls = 0, returns = 0, acquisitions = 0;
    const wrapped = new Proxy(fs, { get(target, key) {
      if (key === "readStream") return () => { acquisitions++; return { [Symbol.asyncIterator]() { return { async next() { if (++pulls === 1) return { done: false, value: Buffer.from("a b\n") }; throw new api.FsError("EIO", { path: "/first.txt" }); }, async return() { returns++; return { done: true }; } }; } }; };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await shell({ fs: wrapped, files: { "first.txt": "a b\n", "second.txt": "c d\n" }, argv: ["-t", "first.txt", "second.txt"] }); retain(record, result);
    record.lifecycle = { pulls, returns, acquisitions }; assert.equal(result.status, 1); assert.equal(result.stdoutHex, ""); assert.equal(returns, 1); assert.equal(acquisitions, 1);
    assert(Buffer.from(result.stderrHex, "hex").toString().includes("/first.txt"));
  });
}
