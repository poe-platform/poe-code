import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { FsError, type ByteSource, type CommandDefinition, type FileSystem, type VirtualShellPlugin } from "../../src/contracts/index.js";
import { createStandardCommands, standardCommands } from "../../src/commands/index.js";
import { createAgentCommands, agentCommands } from "../../src/plugins/index.js";
import { createBrowserCommands, browserCommands } from "../../src/browser.js";
import { streamCommands } from "../../src/commands/streams.js";

const routes: { name: string; create(maxTeeTargets?: number): readonly CommandDefinition[] | VirtualShellPlugin }[] = [
  { name: "stream factory", create: limit => streamCommands(limit) },
  { name: "standard factory", create: limit => createStandardCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
  { name: "standard plugin", create: limit => standardCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
  { name: "agent factory", create: limit => createAgentCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
  { name: "agent plugin", create: limit => agentCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
  { name: "browser factory", create: limit => createBrowserCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
  { name: "browser plugin", create: limit => browserCommands(limit === undefined ? {} : { maxTeeTargets: limit }) },
];

function install(shell: Shell, route: typeof routes[number], limit?: number): void {
  const registration = route.create(limit);
  if ("setup" in registration) shell.use(registration);
  else for (const command of registration) shell.commands.register(command);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(paths: readonly string[], options: {
  append?: boolean;
  rejectOpens?: boolean;
  openFailure?: string;
  writeFailure?: string;
  abortReason?: unknown;
  secondChunk?: boolean;
  blockedPath?: string;
  received?: ReturnType<typeof deferred>;
  release?: ReturnType<typeof deferred>;
  maxOutputBytes?: number;
} = {}) {
  const backing = createMemoryFileSystem();
  for (const path of new Set(paths)) await backing.writeFile(path, new TextEncoder().encode("Q"));
  const state = { access: 0, mutations: 0, opens: [] as string[], active: 0, closed: [] as string[], pulls: 0, inputClosed: false,
    firstRead: undefined as { active: number; contents: string[] } | undefined };
  let blocked = false;
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "access") return (...args: Parameters<FileSystem["access"]>) => { state.access++; return target.access(...args); };
    if (key === "writeFile") return (...args: Parameters<FileSystem["writeFile"]>) => { state.mutations++; return target.writeFile(...args); };
    if (key === "appendFile") return (...args: Parameters<FileSystem["appendFile"]>) => { state.mutations++; return target.appendFile(...args); };
    if (key === "writeStream") return async (path: string, source: ByteSource, writeOptions: Parameters<NonNullable<FileSystem["writeStream"]>>[2]) => {
      state.opens.push(path);
      if (options.rejectOpens || path === options.openFailure) throw new FsError("EACCES", { path });
      state.active++;
      const guarded = (async function* () {
        for await (const chunk of source) {
          if (path === options.writeFailure) throw new FsError("ENOSPC", { path });
          if (path === options.blockedPath && !blocked) {
            blocked = true; options.received!.resolve(); await options.release!.promise;
          }
          yield chunk;
        }
      })();
      try { await target.writeStream(path, guarded, writeOptions); }
      finally { state.active--; state.closed.push(path); }
    };
    const member: unknown = Reflect.get(target, key);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const controller = new AbortController();
  const stdin = (async function* () {
    try {
      const contents = await Promise.all(paths.map(async path => new TextDecoder().decode(await backing.readFile(path))));
      state.firstRead = { active: state.active, contents };
      if (Object.hasOwn(options, "abortReason")) controller.abort(options.abortReason);
      const chunk = Uint8Array.of(65);
      state.pulls++; yield chunk; chunk[0] = 90;
      if (options.secondChunk) { state.pulls++; yield Uint8Array.of(66); }
    } finally { state.inputClosed = true; }
  })();
  const shell = new Shell({ fs, ...(options.maxOutputBytes === undefined ? {} : { limits: { maxOutputBytes: options.maxOutputBytes } }) });
  return { backing, fs, state, controller, stdin, shell, script: `tee ${options.append ? "-a " : ""}${paths.join(" ")}` };
}

for (const route of routes) {
  test(`tee target admission: ${route.name} rejects excess duplicate operands before filesystem work or stdin`, async () => {
    const setup = await fixture(["/kept", "/kept"]);
    try {
      install(setup.shell, route, 1);
      const result = await setup.shell.exec(setup.script, { stdin: setup.stdin });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.equal(setup.state.access + setup.state.mutations + setup.state.opens.length + setup.state.pulls, 0);
      assert.equal(new TextDecoder().decode(await setup.backing.readFile("/kept")), "Q");
    } finally { await setup.shell.dispose(); }
  });

  test(`tee target admission: ${route.name} zero allows stdout only and denies a file`, async () => {
    const setup = await fixture(["/kept"]);
    try {
      install(setup.shell, route, 0);
      assert.equal((await setup.shell.exec("tee", { stdin: "A" })).stdout, "A");
      assert.equal((await setup.shell.exec("tee /kept", { stdin: setup.stdin })).exitCode, 2);
      assert.equal(setup.state.access + setup.state.mutations + setup.state.opens.length + setup.state.pulls, 0);
    } finally { await setup.shell.dispose(); }
  });

  test(`tee target admission: ${route.name} accepts the exact configured target count`, async () => {
    const setup = await fixture(["/first", "/second"]);
    try {
      install(setup.shell, route, 2);
      const result = await setup.shell.exec(setup.script, { stdin: setup.stdin });
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "A");
      assert.deepEqual(setup.state.firstRead, { active: 2, contents: ["", ""] });
      assert.equal(setup.state.active, 0); assert.equal(setup.state.closed.length, 2);
      for (const path of ["/first", "/second"]) assert.equal(new TextDecoder().decode(await setup.backing.readFile(path)), "A");
    } finally { await setup.shell.dispose(); }
  });

  for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, null, "2", false]) {
    test(`tee target admission: ${route.name} rejects invalid host limit ${String(invalid)}`, async () => {
      const setup = await fixture([]);
      try {
        await assert.rejects(async () => { install(setup.shell, route, invalid as number); await setup.shell.exec("tee"); }, RangeError);
        assert.equal(setup.state.opens.length, 0);
      } finally { await setup.shell.dispose(); }
    });
  }

  test(`tee target admission: ${route.name} accepts negative zero and maximum safe host limits`, async () => {
    for (const limit of [-0, Number.MAX_SAFE_INTEGER]) {
      const setup = await fixture([]);
      try { install(setup.shell, route, limit); assert.equal((await setup.shell.exec("tee", { stdin: "A" })).stdout, "A"); }
      finally { await setup.shell.dispose(); }
    }
  });
}

for (const [count, limit, expectedCode, expectedOpens] of [[64, undefined, 1, 64], [65, undefined, 2, 0], [65, 65, 1, 65]] as const) {
  test(`tee target admission: default 64 boundary and explicit override (${count}, ${String(limit)})`, async () => {
    const setup = await fixture(Array<string>(count).fill("/kept"), { rejectOpens: true });
    try {
      setup.shell.use(standardCommands(limit === undefined ? {} : { maxTeeTargets: limit }));
      const result = await setup.shell.exec(setup.script, { stdin: setup.stdin });
      assert.equal(result.exitCode, expectedCode); assert.equal(setup.state.opens.length, expectedOpens);
      assert.equal(setup.state.active, 0); assert.equal(setup.state.pulls, expectedOpens ? 1 : 0);
      assert.equal(new TextDecoder().decode(await setup.backing.readFile("/kept")), "Q");
    } finally { await setup.shell.dispose(); }
  });
}

for (const count of [2, 4, 8]) {
  test(`tee target admission: ${count} admitted targets remain open and truncated before stdin`, async () => {
    const setup = await fixture(Array.from({ length: count }, (_, index) => `/f${index}`));
    try {
      setup.shell.use(standardCommands({ maxTeeTargets: count }));
      assert.equal((await setup.shell.exec(setup.script, { stdin: setup.stdin })).exitCode, 0);
      assert.deepEqual(setup.state.firstRead, { active: count, contents: Array<string>(count).fill("") });
      assert.equal(setup.state.closed.length, count); assert.equal(setup.state.active, 0);
    } finally { await setup.shell.dispose(); }
  });
}

for (const append of [false, true]) {
  test(`tee target admission: admitted duplicate paths retain separate consumers (append=${append})`, async () => {
    const setup = await fixture(["/same", "/same"], { append });
    try {
      setup.shell.use(standardCommands({ maxTeeTargets: 2 }));
      assert.equal((await setup.shell.exec(setup.script, { stdin: setup.stdin })).exitCode, 0);
      assert.equal(setup.state.firstRead?.active, 2);
      assert.deepEqual(setup.state.opens, ["/same", "/same"]);
      assert.equal(new TextDecoder().decode(await setup.backing.readFile("/same")), append ? "QAA" : "A");
      assert.equal(setup.state.active, 0); assert.equal(setup.state.closed.length, 2);
    } finally { await setup.shell.dispose(); }
  });
}

for (const failure of ["openFailure", "writeFailure"] as const) {
  test(`tee target admission: admitted ${failure} retains other targets and joins cleanup`, async () => {
    const setup = await fixture(["/first", "/bad", "/last"], { [failure]: "/bad" });
    try {
      setup.shell.use(standardCommands({ maxTeeTargets: 3 }));
      const result = await setup.shell.exec(setup.script, { stdin: setup.stdin });
      assert.equal(result.exitCode, 1); assert.equal(result.stdout, "A");
      for (const path of ["/first", "/last"]) assert.equal(new TextDecoder().decode(await setup.backing.readFile(path)), "A");
      assert.equal(new TextDecoder().decode(await setup.backing.readFile("/bad")), failure === "openFailure" ? "Q" : "");
      assert.equal(setup.state.active, 0); assert.equal(setup.state.closed.length, failure === "openFailure" ? 2 : 3);
    } finally { await setup.shell.dispose(); }
  });
}

for (const reason of [false, 0, "", null]) {
  test(`tee target admission: admitted cancellation preserves ${JSON.stringify(reason)} and closes targets`, async () => {
    const setup = await fixture(["/first", "/second"], { abortReason: reason });
    try {
      setup.shell.use(standardCommands({ maxTeeTargets: 2 }));
      await assert.rejects(setup.shell.exec(setup.script, { stdin: setup.stdin, signal: setup.controller.signal }), error => error === reason);
      assert.equal(setup.state.firstRead?.active, 2); assert.equal(setup.state.active, 0);
      assert.equal(setup.state.closed.length, 2); assert.equal(setup.state.inputClosed, true);
    } finally { await setup.shell.dispose(); }
  });
}

test("tee target admission: admitted targets preserve backpressure and borrowed input ownership", async () => {
  const received = deferred(), release = deferred();
  const setup = await fixture(["/first", "/second"], { blockedPath: "/first", received, release, secondChunk: true });
  setup.shell.use(standardCommands({ maxTeeTargets: 2 }));
  const running = setup.shell.exec(setup.script, { stdin: setup.stdin });
  try {
    await received.promise;
    assert.equal(setup.state.pulls, 1); assert.equal(setup.state.active, 2);
    assert.equal((await setup.backing.readFile("/second")).length, 0);
    release.resolve();
    const result = await running; assert.equal(result.exitCode, 0); assert.equal(result.stdout, "AB");
    for (const path of ["/first", "/second"]) assert.equal(new TextDecoder().decode(await setup.backing.readFile(path)), "AB");
    assert.equal(setup.state.active, 0);
  } finally { release.resolve(); await setup.shell.dispose(); }
});

test("tee target admission: admitted output copies still share the shell byte budget", async () => {
  const setup = await fixture(["/first", "/second"], { maxOutputBytes: 2 });
  try {
    setup.shell.use(standardCommands({ maxTeeTargets: 2 }));
    await assert.rejects(setup.shell.exec(setup.script, { stdin: setup.stdin }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(new TextDecoder().decode(await setup.backing.readFile("/first")), "A");
    assert.equal((await setup.backing.readFile("/second")).length, 0);
    assert.equal(setup.state.active, 0); assert.equal(setup.state.closed.length, 2);
  } finally { await setup.shell.dispose(); }
});

test("tee target admission: rejection does not suppress prior Shell redirection effects", async () => {
  const setup = await fixture(["/kept", "/outer"]);
  try {
    setup.shell.use(standardCommands({ maxTeeTargets: 0 }));
    const result = await setup.shell.exec("tee /kept > /outer", { stdin: setup.stdin });
    assert.equal(result.exitCode, 2); assert.equal(setup.state.pulls, 0);
    assert.equal(new TextDecoder().decode(await setup.backing.readFile("/kept")), "Q");
    assert.equal((await setup.backing.readFile("/outer")).length, 0);
    assert.equal(setup.state.opens.includes("/kept"), false);
  } finally { await setup.shell.dispose(); }
});
