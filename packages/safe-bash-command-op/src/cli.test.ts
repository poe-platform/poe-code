import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand, renderOpOutput, type OpCommandContext, type OpCommandOptions } from "./cli.js";
import type { OpBackend, OpBackendContext } from "./types.js";
import { opCommandCatalog } from "./catalog.js";
import { createOp, createObjectBackend, captureEnvironment } from "./index.js";
import { renderOpHelp } from "./help-renderer.js";
import { createHandlerPreparation, type OpHandlerRequestMetadata } from "./handler-preparation.js";

function fixture(args: readonly string[], options: Partial<OpCommandOptions> = {}) {
  const requests: unknown[] = [];
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const backend = { execute: async (request: unknown) => { requests.push(request); return { id: "item-id" }; } } as OpBackend;
  const context: OpCommandContext = {
    args, env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write(data) { output.push(data.slice()); } },
    stderr: { async write(data) { errors.push(data.slice()); } },
  };
  return { context, requests, output, errors, command: createOpCommand({ backend, ...options }) };
}

test("dispatches nested commands with interspersed global and repeated array flags", async () => {
  const run = fixture(["--account", "work", "connect", "token", "create", "deploy", "--vault", "A,r", "--vault=B,w", "--server", "prod"]);
  assert.deepEqual(await run.command.execute(run.context), { exitCode: 0 });
  assert.deepEqual(run.requests, [{ resource: "connect token", action: "create", args: ["deploy"], flags: { account: "work", vault: ["A,r", "B,w"], server: "prod" } }]);
});

test("parses optional values, boolean false and comma-separated flags", async () => {
  const run = fixture(["item", "create", "--generate-password", "--favorite=false", "--tags=one,two", "title=example"]);
  await run.command.execute(run.context);
  assert.deepEqual(run.requests, [{ resource: "item", action: "create", args: ["title=example"], flags: { "generate-password": true, favorite: false, tags: ["one", "two"] } }]);
});

test("help traverses groups without invoking backend or authorization", async () => {
  const run = fixture(["help", "vault", "user"], { authorize: () => { throw new Error("must not authorize help"); } });
  assert.deepEqual(await run.command.execute(run.context), { exitCode: 0 });
  assert.equal(run.requests.length, 0);
  const help = Buffer.concat(run.output).toString();
  assert.ok(help.includes("grant"));
  assert.ok(help.includes("revoke"));
  assert.ok(help.includes("To list the global flags"));
});

test("CLI help renders shared metadata for roots, groups, leaves and channels", async () => {
  for (const path of [[], ["item"], ["item", "get"], ["environment", "read"], ["environment", "snapshot", "restore"]]) {
    const channel = path[0] === "environment" && path[1] === "read" ? "beta" : "stable";
    const run = fixture([...path, "--help"], { channel, authorize() { assert.fail("help must not authorize"); } });
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.equal(Buffer.concat(run.output).toString(), renderOpHelp(path, channel));
    assert.deepEqual(run.requests, []);
  }
});

test("rejects invalid commands and flags before execution", async () => {
  for (const args of [["item", "explode"], ["item", "list", "--raw"], ["item", "list", "--vault"], ["item", "list", "--favorite=maybe"]]) {
    const run = fixture(args);
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
    assert.ok(run.errors.length > 0);
  }
});

test("plugin selection callback identity is captured before policy and forwarded in frozen backend context", async () => {
  const selectPlugin = () => "offered-id";
  const run = fixture(["plugin", "inspect"], {
    authorize() {
      Object.assign(run.context, { selectPlugin: () => { assert.fail("replacement callback"); } });
      return "allow";
    },
    backend: { async execute(_request, context) {
      assert.equal(Reflect.get(context, "selectPlugin"), selectPlugin);
      assert.ok(Object.isFrozen(context));
      assert.equal(Reflect.set(context, "selectPlugin", undefined), false);
      return {};
    } },
  });
  run.context.selectPlugin = selectPlugin;
  assert.equal((await run.command.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
});

test("plugin selection denial does not acquire input, candidates or invoke the chooser", async () => {
  const effects: string[] = [];
  const run = fixture(["plugin", "inspect"], {
    authorize: () => "deny",
    backend: { async execute() { effects.push("metadata"); return {}; } },
  });
  run.context.selectPlugin = () => { effects.push("chooser"); return undefined; };
  run.context.stdin = { async *[Symbol.asyncIterator]() { effects.push("stdin"); yield new Uint8Array(); } };
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.deepEqual(effects, []);
});

test("denial and unapproved ask fail closed including delegated handlers", async () => {
  for (const decision of ["deny", "ask"] as const) {
    const run = fixture(["read", "op://vault/item/password"], { authorize: () => decision, handlers: { read: async () => { throw new Error("must not run"); } } });
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
  }
});

test("literal authorization denial happens before stdin acquisition or backend execution", async () => {
  for (const args of [["item", "get", "entry"], ["item", "get"]]) {
    const effects: string[] = [];
    const run = fixture(args, {
      authorize(request) {
        effects.push("authorize");
        assert.equal(request.input, undefined);
        return "deny";
      },
      backend: { async execute() { effects.push("backend"); return {}; } },
    });
    run.context.stdin = { async *[Symbol.asyncIterator]() { effects.push("stdin"); yield new TextEncoder().encode("synthetic-input"); } };
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.deepEqual(effects, ["authorize"]);
  }
});

test("ask never falls back implicitly to legacy literal approval", async () => {
  const effects: string[] = [];
  const run = fixture(["item", "get", "entry"], {
    authorize() { effects.push("authorize"); return "ask"; },
    approve() { effects.push("legacy-approve"); return true; },
    backend: { async execute() { effects.push("backend"); return {}; } },
  });
  run.context.stdin = { async *[Symbol.asyncIterator]() { effects.push("stdin"); yield new Uint8Array(); } };
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.deepEqual(effects, ["authorize"]);
});

test("resolved manifests project an immutable allowlist without handles or provider extras", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault", fields: [{ id: "password", value: "synthetic-secret" }] }] });
  const prepare = backend.prepareBinding.bind(backend);
  backend.prepareBinding = async (requests, context) => {
    const prepared = await prepare(requests, context);
    return { ...prepared, input: "provider-extra-secret", targets: prepared.targets.map(target => ({ ...target, value: "provider-extra-secret" })) };
  };
  const run = fixture(["item", "get", "Entry"], {
    backend, authorize: () => "ask", authorizeResolution: () => true,
    approveResolved(manifest) {
      assert.deepEqual(Object.keys(manifest).sort(), ["accountId", "backendId", "mutation", "operation", "optionNames", "output", "targets"]);
      assert.ok(Object.isFrozen(manifest));
      assert.ok(Object.isFrozen(manifest.targets));
      assert.ok(manifest.targets.every(target => Object.isFrozen(target)));
      assert.equal(JSON.stringify(manifest).includes("secret"), false);
      assert.equal(Object.hasOwn(manifest, "handle"), false);
      return false;
    },
  });
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.output.length, 0);
  assert.equal(Buffer.concat(run.errors).toString(), "op: permission denied\n");
});

test("resolved completion receives ordered backend metadata before approval and fails closed", async () => {
  for (const incomplete of [false, true]) {
    const calls: string[] = [];
    const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "first", title: "First", vault: "vault" }, { id: "second", title: "Second", vault: "vault" }] });
    const prepare = backend.prepareBinding.bind(backend);
    const metadata: readonly OpHandlerRequestMetadata[] = incomplete ? [{}] : [{}, { environment: { names: ["TOKEN"], unsetNames: [], scope: "selected", dependenciesComplete: true } }];
    backend.prepareBinding = async (requests, context) => {
      calls.push("bind");
      assert.deepEqual(requests.map(request => request.args[0]), ["first", "second"]);
      return { ...await prepare(requests, context), metadata };
    };
    const handler = Object.assign(async () => { assert.fail("denied approval must not execute"); }, {
      async prepare(_request: unknown, context: OpCommandContext) {
        calls.push("plan");
        return createHandlerPreparation(["first", "second"].map(id => ({ resource: "item", action: "get", args: [id], flags: {} })), context, [], received => {
          calls.push("complete");
          assert.equal(received, metadata);
          return [];
        });
      },
    });
    const run = fixture(["read", "op://vault/item/password"], {
      backend, handlers: { read: handler }, authorize: () => "ask", authorizeResolution: () => true,
      approveResolved() { calls.push("approve"); return false; },
    });
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.deepEqual(calls, incomplete ? ["plan", "bind"] : ["plan", "bind", "complete", "approve"]);
    assert.equal(run.output.length, 0);
  }
});

test("resolved inject uses the prepared file once and keeps its values out of approval", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault", fields: [{ id: "password", value: "synthetic-secret" }] }] });
  let source = "TOKEN={{ op://Work/Entry/password }}";
  let reads = 0;
  const run = fixture(["inject", "--in-file", "template"]);
  run.context.readFile = async () => { reads++; return new TextEncoder().encode(source); };
  const command = createOp({ backend, authorize: () => "ask", authorizeResolution: () => true,
    approveResolved(manifest) {
      assert.equal(JSON.stringify(manifest).includes("synthetic-secret"), false);
      source = "changed-after-approval";
      return true;
    },
  });
  assert.equal((await command.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
  assert.equal(reads, 1);
  assert.equal(Buffer.concat(run.output).toString(), "TOKEN=synthetic-secret");
});

test("synchronous binding validation hands off output before queued invalidation with the bound context", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault" }] });
  const validate = backend.validateBinding.bind(backend);
  let validations = 0;
  let checkAtHandoff: (() => void) | undefined;
  const events: string[] = [];
  backend.validateBinding = (handle, context) => {
    validate(handle, context);
    validations++;
    if (validations === 2) {
      events.push("validate");
      checkAtHandoff = () => validate(handle, context);
      queueMicrotask(() => { events.push("invalidate"); backend.cancelBinding(handle); });
    }
  };
  const run = fixture(["item", "get", "Entry"], { backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true });
  run.context.stdout = { async write() {
    assert.ok(checkAtHandoff);
    checkAtHandoff();
    events.push("handoff");
  } };
  assert.equal((await run.command.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
  assert.deepEqual(events, ["validate", "handoff", "invalidate"]);
});

test("resolved validation rejects a changed backend before an output handoff", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault" }] });
  const execute = backend.execute.bind(backend);
  backend.execute = async (request, context) => {
    const value = await execute(request, context);
    await execute({ resource: "item", action: "edit", args: ["item"], flags: { title: "Changed" } }, { signal: context.signal });
    return value;
  };
  const run = fixture(["item", "get", "Entry"], { backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true });
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.output.length, 0);
  assert.equal(backend.snapshot().items![0]!.title, "Changed");
});

test("approval sees a frozen snapshot and delegates literal child argv", async () => {
  let authorized: unknown;
  const run = fixture(["run", "--env-file=a", "--", "echo", "--help", "$(secret)"], {
    approvalMode: "literal",
    authorize(request) { authorized = request; assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.args)); assert.ok(Object.isFrozen(request.flags)); assert.ok(Object.isFrozen(request.flags["env-file"])); return "ask"; },
    approve(request) { assert.equal(request, authorized); return true; },
    handlers: { run: async (request, context) => { assert.equal(request, authorized); assert.deepEqual(request.args, ["echo", "--help", "$(secret)"]); assert.equal(context.stdout, run.context.stdout); assert.equal(context.signal, run.context.signal); assert.deepEqual(context.env, run.context.env); assert.notEqual(context.env, run.context.env); return { exitCode: 7 }; } },
  });
  assert.deepEqual(await run.command.execute(run.context), { exitCode: 7 });
  assert.equal(run.requests.length, 0);
});

test("timestamp environment compatibility chooses omission for unrecognized labels without claiming native toggle values", async () => {
  for (const value of ["", "yes", "no", "Yes", "NO", "TrUe", "FaLsE", "invalid", " true ", " true", "false "]) {
    const run = fixture(["account", "list"]);
    run.context.env = { OP_ISO_TIMESTAMPS: value };
    assert.equal((await run.command.execute(run.context)).exitCode, 0, value);
    assert.equal(Object.hasOwn((run.requests[0] as { flags: object }).flags, "iso-timestamps"), false, value);
  }
});

test("timestamp boolean spellings and strict explicit precedence remain unchanged", async () => {
  for (const [expected, values] of [[true, ["true", "1", "t", "TRUE", "True", "T"]], [false, ["false", "0", "f", "FALSE", "False", "F"]]] as const) {
    for (const value of values) {
      const environment = fixture(["account", "list"]);
      environment.context.env = { OP_ISO_TIMESTAMPS: value };
      assert.equal((await environment.command.execute(environment.context)).exitCode, 0);
      assert.equal((environment.requests[0] as { flags: Record<string, unknown> }).flags["iso-timestamps"], expected);
      for (const fallback of ["invalid", String(!expected)]) {
        const explicit = fixture(["account", "list", `--iso-timestamps=${value}`]);
        explicit.context.env = { OP_ISO_TIMESTAMPS: fallback };
        assert.equal((await explicit.command.execute(explicit.context)).exitCode, 0);
        assert.equal((explicit.requests[0] as { flags: Record<string, unknown> }).flags["iso-timestamps"], expected);
      }
    }
  }
  for (const value of ["", "yes", "no", "Yes", "NO", "TrUe", "FaLsE", "invalid", " true ", " true", "false "]) {
    const run = fixture(["account", "list", `--iso-timestamps=${value}`], { authorize() { assert.fail("invalid flag must precede policy"); } });
    run.context.env = { OP_ISO_TIMESTAMPS: "true" };
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.deepEqual(run.requests, []);
  }
});

test("timestamp invalid-environment policy does not relax other boolean environment variables", async () => {
  for (const name of ["OP_CACHE", "OP_DEBUG"]) {
    const run = fixture(["account", "list"], { authorize() { assert.fail("invalid environment must precede policy"); } });
    run.context.env = { OP_ISO_TIMESTAMPS: "invalid", [name]: "invalid" };
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.deepEqual(run.requests, []);
    assert.ok(Buffer.concat(run.errors).toString().includes(`--${name === "OP_CACHE" ? "cache" : "debug"}`));
  }
});

test("formats JSON and forwards environment defaults with explicit flag precedence", async () => {
  const run = fixture(["item", "get", "example", "--account=explicit"]);
  run.context.env = { OP_FORMAT: "json", OP_ACCOUNT: "implicit", OP_INCLUDE_ARCHIVE: "true" };
  await run.command.execute(run.context);
  assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()), { id: "item-id" });
  assert.deepEqual(run.requests, [{ resource: "item", action: "get", args: ["example"], flags: { account: "explicit", format: "json", "include-archive": true } }]);
});

test("backend errors cannot manufacture successful output", async () => {
  const run = fixture(["account", "list"], { backend: { execute: async () => { throw new Error("unsupported operation"); } } as OpBackend });
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(run.output.length, 0);
});

test("an aborted invocation never reaches backend", async () => {
  const run = fixture(["item", "list"]);
  run.context.signal = AbortSignal.abort();
  assert.notEqual((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(run.requests.length, 0);
});

test("biometric environment overrides trusted integration before policy binding", async () => {
  for (const integration of [undefined, "manual", "app"] as const) {
    for (const override of [undefined, "true", "false"] as const) {
      const expected = override === undefined ? integration ?? "manual" : override === "true" ? "app" : "manual";
      const authentication = { terminalId: "trusted", ...(integration === undefined ? {} : { integration }) };
      let bound: unknown;
      const run = fixture(["vault", "list"], {
        approvalMode: "literal",
        authorize(_request, context) {
          assert.deepEqual(context.authentication, { terminalId: "trusted", integration: expected });
          assert.ok(Object.isFrozen(context.authentication));
          bound = context.authentication;
          authentication.terminalId = "changed";
          run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = override === "true" ? "false" : "true";
          return "ask";
        },
        approve(_request, context) { assert.equal(context.authentication, bound); return true; },
        backend: { async execute(_request, context) { assert.equal(context.authentication, bound); return []; } },
      });
      run.context.authentication = authentication;
      if (override !== undefined) run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = override;
      assert.equal((await run.command.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
    }
  }
});

test("integration defaults to manual without inferring a terminal identity", async () => {
  for (const override of [undefined, "true", "false"] as const) {
    const run = fixture(["vault", "list"], { backend: { async execute(_request, context) {
      assert.deepEqual(context.authentication, { integration: override === "true" ? "app" : "manual" });
      return [];
    } } });
    if (override !== undefined) run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = override;
    assert.equal((await run.command.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
  }
});

test("invalid biometric environment values fail before policy and handlers", async () => {
  for (const value of ["", "TRUE", "1", "yes", " false "]) {
    const run = fixture(["read", "op://vault/item/field"], {
      authorize() { assert.fail("invalid integration must not reach policy"); },
      handlers: { read: async () => { assert.fail("invalid integration must not reach handlers"); } },
    });
    run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = value;
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.ok(Buffer.concat(run.errors).toString().includes("OP_BIOMETRIC_UNLOCK_ENABLED must be true or false"));
    assert.equal(run.requests.length, 0);
  }
});

test("authentication metadata is bound and frozen before both policy callbacks", async () => {
  const authentication = { terminalId: "terminal-original" };
  let bound: unknown;
  const run = fixture(["account", "list"], {
    approvalMode: "literal",
    authorize(_request, context) {
      bound = context.authentication;
      assert.deepEqual(bound, { terminalId: "terminal-original", integration: "manual" });
      assert.ok(Object.isFrozen(bound));
      authentication.terminalId = "changed";
      run.context.authentication = { terminalId: "replaced" };
      return "ask";
    },
    approve(_request, context) {
      assert.equal(context.authentication, bound);
      return true;
    },
    backend: { async execute(_request, context) {
      assert.equal(context.authentication, bound);
      assert.deepEqual(context.authentication, { terminalId: "terminal-original", integration: "manual" });
    } },
  });
  run.context.authentication = authentication;
  assert.deepEqual(await run.command.execute(run.context), { exitCode: 0 });
});

test("all built-in backend paths preserve approved authentication metadata", async () => {
  const commands = [
    ["item", "create", "title=example"], ["item", "edit", "item", "title=example"],
    ["document", "create", "-"], ["document", "edit", "document", "-"], ["document", "get", "document"],
    ["read", "op://vault/item/field"], ["inject"],
    ["run", "--environment=environment", "--", "child"],
    ...["create", "get", "delete", "restore"].map(action => ["environment", "snapshot", action, "snapshot", ...(action === "restore" ? ["--shell=bash"] : [])]),
    ["environment", "snapshot", "list"],
  ];
  for (const args of commands) {
    const authentication = { terminalId: "terminal-original" };
    const calls: string[] = [];
    let bound: unknown;
    const run = fixture(["--account=work", "--session=explicit-token", "--config=/config", "--cache=false", ...args]);
    run.context.authentication = authentication;
    if (args[0] === "run") run.context.env = { LOCAL_TOKEN: "op://vault/item/field" };
    run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = "true";
    run.context.stdin = (async function* () {
      if (args[0] === "inject") yield new TextEncoder().encode("{{ op://vault/item/field }}");
    })();
    run.context.invoke = async () => ({ exitCode: 0 });
    const command = createOp({
      channel: "beta",
      authorize(_request, context) { bound = context.authentication; authentication.terminalId = "changed"; run.context.env.OP_BIOMETRIC_UNLOCK_ENABLED = "false"; return "allow"; },
      backend: { async execute(request, context) {
        calls.push(`${request.resource} ${request.action}`);
        assert.equal(request.flags.account, "work");
        assert.equal(request.flags.session, "explicit-token");
        assert.equal(request.flags.config, "/config");
        assert.equal(request.flags.cache, false);
        if (request.resource === "secret" || request.resource === "environment" || args[2] === "restore") {
          assert.deepEqual(request.flags, { account: "work", session: "explicit-token", config: "/config", cache: false });
        }
        assert.deepEqual(context.authentication, { terminalId: "terminal-original", integration: "app" });
        assert.equal(context.authentication, bound);
        assert.ok(Object.isFrozen(context.authentication));
        assert.equal(context.signal, run.context.signal);
        if (request.resource === "secret") return "secret-value";
        if (request.resource === "environment") return "TOKEN=environment-value";
        if (request.resource === "environment snapshot") {
          const stored = { id: "snapshot", snapshot: captureEnvironment({ TOKEN: "value" }) };
          return request.action === "list" ? [stored] : stored;
        }
        if (request.resource === "document" && request.action === "get") return new Uint8Array([0, 255]);
        return { id: "result" };
      } },
    });
    assert.deepEqual(await command.execute(run.context), { exitCode: 0 }, `${args.join(" ")}: ${Buffer.concat(run.errors).toString()}`);
    assert.ok(calls.length > 0, args.join(" "));
    if (args[0] === "run") assert.deepEqual(calls, ["environment read", "secret read"]);
  }
});

test("plugin scope and clear confirmation bind before asynchronous authorization", async () => {
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const authorized = new Promise<void>(resolve => { entered = resolve; });
  const scope = { cwd: "/work", home: "/home", terminalSession: "original" };
  const confirm = async () => true;
  const contexts: OpBackendContext[] = [];
  const run = fixture(["plugin", "clear", "aws", "--force"], {
    async authorize(_request, context) {
      entered();
      assert.equal(Object.hasOwn(context, "confirmPluginClear"), false);
      assert.deepEqual(context.pluginScope, { cwd: "/work", home: "/home", terminalSession: "original" });
      assert.ok(Object.isFrozen(context.pluginScope));
      await pending;
      return "allow" as const;
    },
    backend: { async execute(request, context) {
      assert.equal(request.flags.force, true);
      contexts.push(context);
      return undefined;
    } },
  });
  run.context.pluginScope = scope;
  run.context.confirmPluginClear = confirm;
  const execution = run.command.execute(run.context);
  await authorized;
  assert.equal(contexts.length, 0);
  scope.cwd = "/changed";
  scope.home = "/elsewhere";
  scope.terminalSession = "changed";
  run.context.confirmPluginClear = async () => false;
  release();
  assert.deepEqual(await execution, { exitCode: 0 });
  const received = contexts[0];
  assert.ok(received);
  assert.deepEqual(received.pluginScope, { cwd: "/work", home: "/home", terminalSession: "original" });
  assert.notEqual(received.pluginScope, scope);
  assert.ok(Object.isFrozen(received.pluginScope));
  assert.equal(received.confirmPluginClear, confirm);
  assert.equal(received.signal, run.context.signal);
});

test("force cannot bypass centralized authorization for plugin clear", async () => {
  for (const decision of ["deny", "ask"] as const) {
    const effects: string[] = [];
    const run = fixture(["plugin", "clear", "aws", "--force"], {
      authorize: () => decision,
      approve: async () => false,
      backend: { async execute() { effects.push("backend"); } },
    });
    run.context.confirmPluginClear = async () => { effects.push("confirm"); return true; };
    assert.deepEqual(await run.command.execute(run.context), { exitCode: 1 });
    assert.deepEqual(effects, []);
  }
});

test("delegated plugin handlers receive the frozen invocation scope after approval", async () => {
  const scope = { cwd: "/work", home: "/home" };
  const confirm = async () => true;
  const run = fixture(["plugin", "inspect", "aws"], {
    approvalMode: "literal",
    authorize(_request, context) {
      scope.cwd = "/changed";
      assert.deepEqual(context.pluginScope, { cwd: "/work", home: "/home" });
      return "ask";
    },
    approve(_request, context) {
      assert.deepEqual(context.pluginScope, { cwd: "/work", home: "/home" });
      assert.ok(Object.isFrozen(context.pluginScope));
      assert.equal(Object.hasOwn(context, "confirmPluginClear"), false);
      return true;
    },
    handlers: { "plugin inspect": async (_request, context) => {
      assert.deepEqual(context.pluginScope, { cwd: "/work", home: "/home" });
      assert.ok(Object.isFrozen(context.pluginScope));
      assert.equal(context.confirmPluginClear, confirm);
      return { exitCode: 0 };
    } },
  });
  run.context.pluginScope = scope;
  run.context.confirmPluginClear = confirm;
  assert.deepEqual(await run.command.execute(run.context), { exitCode: 0 });
});

test("catalog inventories all documented terminal commands and snapshot extensions", () => {
  const inventory: Record<string, readonly string[]> = {
    account: ["add", "forget", "get", "list"],
    connect: ["group grant", "group revoke", "server create", "server delete", "server edit", "server get", "server list", "token create", "token delete", "token edit", "token list", "vault grant", "vault revoke"],
    document: ["create", "delete", "edit", "get", "list"], environment: ["read", "snapshot create", "snapshot get", "snapshot list", "snapshot delete", "snapshot restore"], "events-api": ["create"],
    group: ["create", "delete", "edit", "get", "list", "user grant", "user list", "user revoke"],
    item: ["create", "delete", "edit", "get", "list", "move", "share", "template get", "template list"],
    plugin: ["clear", "init", "inspect", "list", "run", "credential import"], "service-account": ["create", "ratelimit"],
    user: ["confirm", "delete", "edit", "get", "list", "provision", "reactivate", "recovery begin", "suspend"],
    vault: ["create", "delete", "edit", "get", "group grant", "group list", "group revoke", "list", "user grant", "user list", "user revoke"],
  };
  const expected = ["read", "inject", "run", "signin", "signout", "update", "whoami", "completion", ...Object.entries(inventory).flatMap(([noun, verbs]) => verbs.map(verb => `${noun} ${verb}`))];
  assert.deepEqual(opCommandCatalog.map(command => command.path.join(" ")).sort(), expected.sort());
});

test("rejects prototype names as flags", async () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    const run = fixture(["item", "list", `--${name}=anything`]);
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
  }
});

test("short options accept attached values and combined booleans", async () => {
  const run = fixture(["read", "-fn", "-osecret.txt", "op://vault/item/field"], {
    handlers: { read: async request => {
      assert.deepEqual(request.flags, { force: true, "no-newline": true, "out-file": "secret.txt" });
      return { exitCode: 0 };
    } },
  });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
});

test("freezes JSON stdin after literal allowance and owns reused chunks", async () => {
  const run = fixture(["item", "create"], { authorize(request) {
    assert.equal(request.input, undefined);
    return "allow";
  }, backend: { async execute(request) {
    assert.deepEqual(request.input, { title: "Example", fields: [{ value: "secret" }] });
    assert.ok(Object.isFrozen(request.input));
    assert.ok(Object.isFrozen((request.input as { fields: unknown[] }).fields[0]));
    return {};
  } } });
  run.context.stdin = (async function* () {
    const bytes = new TextEncoder().encode('{"title":"Example","fields":[{"value":"secret"}]}');
    yield bytes;
    bytes.fill(0);
  })();
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
});

test("cancellation while authorizing prevents dispatch", async () => {
  const controller = new AbortController();
  const run = fixture(["item", "list"], { authorize() { controller.abort(); return "allow"; } });
  run.context.signal = controller.signal;
  assert.equal((await run.command.execute(run.context)).exitCode, 130);
  assert.equal(run.requests.length, 0);
});

test("preserves binary backend output without text conversion", async () => {
  const bytes = new Uint8Array([0, 255, 128, 10]);
  const run = fixture(["document", "get", "binary"], { backend: { async execute() { return bytes; } } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from(bytes));
});

const exampleItem = { id: "item", title: "Example", fields: [
  { id: "username", label: "username", type: "STRING", value: "alice" },
  { id: "password", label: "password", type: "CONCEALED", value: "private-secret" },
  { id: "otp", label: "one-time password", type: "OTP", value: "otpauth://totp/example?secret=SEED" },
] };

test("human item output conceals secret fields without mutating backend data", async () => {
  const run = fixture(["item", "get", "example"], { backend: { async execute() { return exampleItem; } } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  const text = Buffer.concat(run.output).toString();
  assert.ok(text.includes("alice"));
  assert.ok(text.includes("use 'op item get --reveal' to reveal"));
  assert.ok(!text.includes("private-secret"));
  assert.ok(!text.includes("SEED"));
  assert.equal(exampleItem.fields[1]!.value, "private-secret");
});

test("JSON and explicit reveal preserve full item values", async () => {
  for (const flag of ["--format=json", "--reveal"]) {
    const run = fixture(["item", "get", "example", flag], { backend: { async execute() { return exampleItem; } } });
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.ok(Buffer.concat(run.output).toString().includes("private-secret"));
  }
});

test("human field selection emits CSV values, JSON emits field objects", async () => {
  const run = fixture(["item", "get", "example", "--fields=label=username,label=password", "--reveal"], { backend: { async execute() { return exampleItem; } } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(Buffer.concat(run.output).toString(), "alice,private-secret\n");
  const json = fixture(["item", "get", "example", "--fields=type=concealed", "--format=json"], { backend: { async execute() { return exampleItem; } } });
  assert.equal((await json.command.execute(json.context)).exitCode, 0);
  assert.deepEqual(JSON.parse(Buffer.concat(json.output).toString()), exampleItem.fields[1]);
});

test("OTP emits backend generated code and refuses to print an OTP seed as a code", async () => {
  const run = fixture(["item", "get", "example", "--otp"], { backend: { async execute() { return "123456"; } } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(Buffer.concat(run.output).toString(), "123456\n");
  const unsupported = fixture(["item", "get", "example", "--otp"], { backend: { async execute() { return exampleItem; } } });
  assert.equal((await unsupported.command.execute(unsupported.context)).exitCode, 1);
  assert.equal(unsupported.output.length, 0);
});

test("document get emits content bytes without metadata or an extra newline", async () => {
  const run = fixture(["document", "get", "example"], { backend: { async execute() { return { id: "doc", content: "file-content" }; } } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(Buffer.concat(run.output).toString(), "file-content");
});

test("version emits the package semver in native scalar format without authorization", async () => {
  const run = fixture(["--version"], { version: "0.0.1", authorize() { throw new Error("unexpected authorization"); } });
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(Buffer.concat(run.output).toString(), "0.0.1\n");
  assert.equal(run.requests.length, 0);
});

test("root help separates native command groups and presents global flags", async () => {
  const run = fixture(["--help"]);
  await run.command.execute(run.context);
  const text = Buffer.concat(run.output).toString();
  assert.ok(text.includes("Management Commands:\n"));
  assert.ok(text.includes("\nCommands:\n"));
  assert.ok(text.includes("Global Flags:\n"));
  assert.ok(text.indexOf("--account") < text.indexOf("--cache"));
});

test("generic output validates file mode and capability before executing backend", async () => {
  for (const mode of ["invalid", "40000000000", "-1"]) {
    const run = fixture(["item", "template", "get", "Login", "-o", "template.json", `--file-mode=${mode}`]);
    run.context.writeFile = async () => {};
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
  }
});

test("generic file output forwards octal mode and force to host", async () => {
  const run = fixture(["item", "template", "get", "Login", "-o", "template.json", "--file-mode=0640", "--force"]);
  let writes = 0;
  run.context.writeFile = async (path, bytes, options) => {
    writes++;
    assert.equal(path, "template.json");
    assert.deepEqual(options, { mode: 0o640, overwrite: true });
    assert.ok(bytes.byteLength > 0);
  };
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(writes, 1);
});

test("native stable command aliases resolve before authorization", async () => {
  for (const [alias, canonical] of [["item rm", "item delete"], ["connect token ls", "connect token list"], ["item mv", "item move"], ["plugin reset", "plugin clear"], ["plugin info", "plugin inspect"], ["service-account ratelimits", "service-account ratelimit"]]) {
    const run = fixture(alias!.split(" "));
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    const request = run.requests[0] as { resource: string; action: string };
    assert.equal(`${request.resource} ${request.action}`, canonical);
  }
});

test("native hidden long flag aliases normalize to canonical names", async () => {
  const fields = fixture(["item", "get", "example", "--field=password"], { handlers: { "item get": async request => { assert.deepEqual(request.flags.fields, ["password"]); return { exitCode: 0 }; } } });
  assert.equal((await fields.command.execute(fields.context)).exitCode, 0);
  const expiry = fixture(["item", "share", "example", "--expiry=1h"]);
  assert.equal((await expiry.command.execute(expiry.context)).exitCode, 0);
  assert.equal((expiry.requests[0] as { flags: Record<string, unknown> }).flags["expires-in"], "1h");
});

test("native document force has no short alias and SSH generation requires a value", async () => {
  for (const args of [["document", "get", "example", "-f"], ["item", "create", "--ssh-generate-key"]]) {
    const run = fixture(args);
    assert.equal((await run.command.execute(run.context)).exitCode, 1);
    assert.equal(run.requests.length, 0);
  }
  const run = fixture(["item", "create", "--ssh-generate-key", "ed25519"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal((run.requests[0] as { flags: Record<string, unknown> }).flags["ssh-generate-key"], "ed25519");
});

test("beta environment additions are separate from the native stable inventory", async () => {
  const stable = fixture(["run", "--environment=example", "--", "printenv"]);
  assert.equal((await stable.command.execute(stable.context)).exitCode, 1);
  const betaRun = fixture(["run", "--environment=example", "--", "printenv"], { channel: "beta" });
  assert.equal((await betaRun.command.execute(betaRun.context)).exitCode, 0);
  assert.deepEqual((betaRun.requests[0] as { flags: Record<string, unknown> }).flags.environment, ["example"]);
  const beta = fixture(["environment", "read", "example"], { channel: "beta" });
  assert.equal((await beta.command.execute(beta.context)).exitCode, 0);
  assert.equal(opCommandCatalog.filter(command => command.availability === "stable").length, 76);
  assert.deepEqual(opCommandCatalog.filter(command => command.availability === "beta").map(command => command.path.join(" ")), ["environment read"]);
  assert.equal(opCommandCatalog.find(command => command.path.join(" ") === "run")!.flags.environment!.availability, "beta");
  const guessed = fixture(["run", "--environments=example", "--", "printenv"], { channel: "beta" });
  assert.equal((await guessed.command.execute(guessed.context)).exitCode, 1);
});

test("run no masking reads the documented environment toggle", async () => {
  const run = fixture(["run", "--", "printenv"]);
  run.context.env.OP_RUN_NO_MASKING = "true";
  await run.command.execute(run.context);
  assert.equal((run.requests[0] as { flags: Record<string, unknown> }).flags["no-masking"], true);
});

test("required string values consume flag-looking tokens before parsing the next flag", async () => {
  for (const value of ["--help", "--", "--vault=other"]) {
    const run = fixture(["item", "list", "--vault", value]);
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.deepEqual(run.requests, [{ resource: "item", action: "list", args: [], flags: { vault: value } }]);
    const help = fixture(["item", "list", "--vault", value, "--help"]);
    assert.equal((await help.command.execute(help.context)).exitCode, 0);
    assert.equal(help.requests.length, 0);
  }
});

test("required short values consume flag-looking tokens and attached values stay literal", async () => {
  for (const args of [["-o", "--help"], ["-o--help"], ["-o=--help"]]) {
    let seen = false;
    const run = fixture(["read", ...args, "op://vault/item/field"], { handlers: { read: async request => {
      seen = true;
      assert.equal(request.flags["out-file"], "--help");
      assert.deepEqual(request.args, ["op://vault/item/field"]);
      return { exitCode: 0 };
    } } });
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.equal(seen, true);
  }
});

test("native shorthand help clusters and attached output options remain accepted", async () => {
  for (const args of [["read", "-hn"], ["read", "-ooutput", "--help"], ["read", "-hn=false"], ["read", "-hooutput"]]) {
    const run = fixture(args);
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.equal(run.requests.length, 0);
  }
});

test("explicit help false preserves native parent usage while leaf flags use the last value", async () => {
  for (const args of [["--help=false"], ["item", "--help=false"], ["item", "template", "--help=false"]]) {
    const run = fixture(args);
    assert.equal((await run.command.execute(run.context)).exitCode, 0);
    assert.equal(run.requests.length, 0);
    assert.ok(Buffer.concat(run.output).toString().includes("Usage:"));
  }
  const run = fixture(["item", "list", "--help", "--help=false"]);
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
  assert.equal(run.requests.length, 1);
});

test("snapshot restore no-masking is explicit and remains subject to approval", async () => {
  let authorized = false;
  let invoked = false;
  const run = fixture(["environment", "snapshot", "restore", "dev", "--no-masking", "--", "worker"], {
    authorize(request) {
      authorized = true;
      assert.equal(request.resource, "environment snapshot");
      assert.equal(request.action, "restore");
      assert.equal(request.flags["no-masking"], true);
      return "deny";
    },
    handlers: { "environment snapshot restore": async () => { invoked = true; return { exitCode: 0 }; } },
  });
  assert.equal((await run.command.execute(run.context)).exitCode, 1);
  assert.equal(authorized, true);
  assert.equal(invoked, false);
});

test("snapshot restore does not inherit the run-only masking environment toggle", async () => {
  const run = fixture(["environment", "snapshot", "restore", "dev"], {
    handlers: { "environment snapshot restore": async request => {
      assert.equal(request.flags["no-masking"], undefined);
      return { exitCode: 0 };
    } },
  });
  run.context.env.OP_RUN_NO_MASKING = "true";
  assert.equal((await run.command.execute(run.context)).exitCode, 0);
});

test("all item metadata output strips attachment bodies while preserving field values and file metadata", () => {
  const item = { id: "item", fields: [{ id: "note", value: "note content" }], files: [
    { id: "text", name: "text.txt", size: 12, content: "private-body" },
    { id: "binary", name: "binary.dat", size: 2, content: new Uint8Array([255, 128]) },
  ] };
  for (const action of ["get", "list", "create", "edit", "move"]) {
    const result = action === "list" ? [item] : item;
    for (const format of ["json", "human-readable"]) {
      const output = renderOpOutput(result, { resource: "item", action, args: [], flags: { format, reveal: true } })!;
      const text = new TextDecoder().decode(output);
      assert.ok(!text.includes("private-body"));
      assert.ok(!text.includes('"content":'));
      assert.ok(text.includes("binary.dat"));
      assert.ok(text.includes("note content"));
      if (format === "json") {
        const parsed = JSON.parse(text);
        assert.deepEqual((action === "list" ? parsed[0] : parsed).files, [
          { id: "text", name: "text.txt", size: 12 }, { id: "binary", name: "binary.dat", size: 2 },
        ]);
      }
    }
  }
  assert.equal(item.files[0]!.content, "private-body");
  assert.deepEqual(item.files[1]!.content, new Uint8Array([255, 128]));
});

test("document metadata omits content but document get preserves the exact body", () => {
  const document = { id: "doc", title: "Document", content: new Uint8Array([255, 0, 128]) };
  for (const action of ["list", "create", "edit"]) {
    const output = renderOpOutput(action === "list" ? [document] : document, { resource: "document", action, args: [], flags: { format: "json" } })!;
    assert.deepEqual(JSON.parse(new TextDecoder().decode(output)), action === "list" ? [{ id: "doc", title: "Document" }] : { id: "doc", title: "Document" });
  }
  const output = renderOpOutput(document, { resource: "document", action: "get", args: ["doc"], flags: {} });
  assert.deepEqual(output, document.content);
});
