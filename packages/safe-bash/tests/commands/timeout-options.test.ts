import assert from "node:assert/strict";
import test from "node:test";
import { Shell, CommandRegistry, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { parseSignal } from "../../src/commands/timeout/signal.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("timeout foreground options preserve file bytes and child status through Shell", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/Changed input.txt", new TextEncoder().encode("Changed12\r\n"));
  const shell = new Shell({ fs });
  await shell.use(agentCommands());
  try {
    for (const option of ["-f", "--foreground", "-f --preserve-status -sTERM", "-p", "-f -p -sTERM"]) {
      const result = await shell.exec(`timeout ${option} 2 cat "Changed input.txt"`);
      assert.equal(result.exitCode, 0, option);
      assert.equal(result.stdout, "Changed12\r\n", option);
      assert.equal(result.stderr, "", option);
      const failed = await shell.exec(`timeout ${option} 2 sh -c 'printf child; exit 9'`);
      assert.equal(failed.exitCode, 9, option);
      assert.equal(failed.stdout, "child", option);
      assert.equal(failed.stderr, "", option);
    }
  } finally { await shell.dispose(); }
});

test("timeout foreground retains cooperative expiry and preserve-status", async () => {
  for (const option of ["-f", "--foreground"]) {
    for (const preserve of [false, true]) {
      const scheduler = new ManualScheduler();
      const capture = captureContext([option, ...(preserve ? ["--preserve-status"] : []), "1", "child"], {
        invoke: async (_command, _args, invocation) => {
          scheduler.fire(1000);
          assert.equal(invocation!.signal!.aborted, true);
          throw invocation!.signal!.reason;
        },
      });
      assert.equal((await createTimeoutCommand({ scheduler }).execute(capture.context)).exitCode, preserve ? 143 : 124);
      assert.equal(capture.stderr(), "");
      assert.equal(scheduler.pending, false);
    }
  }
});

test("timeout accepts preserve-status and named, numeric, attached signal options through Shell", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  await shell.use(agentCommands());
  try {
    for (const option of ["--preserve-status", "-s TERM", "--signal=SIGTERM", "--signal 15", "-sINT", "--preserve-status -sTERM"]) {
      const result = await shell.exec(`timeout ${option} 1 printf hi`);
      assert.equal(result.exitCode, 0, option);
      assert.equal(result.stdout, "hi", option);
      assert.equal(result.stderr, "", option);
    }
    assert.equal((await shell.exec("timeout --preserve-status 1 false")).exitCode, 1);
  } finally { await shell.dispose(); }
});

test("timeout deadline status reflects preserve-status and selected signal", async () => {
  for (const [options, expected] of [
    [[], 124], [["--preserve-status"], 143], [["-p"], 143], [["-p", "-s", "INT"], 130], [["--preserve-status", "-s", "INT"], 130],
    [["--signal=KILL"], 137], [["--preserve-status", "--signal=9"], 137],
  ] as const) {
    const scheduler = new ManualScheduler();
    const capture = captureContext([...options, "1", "child"], {
      invoke: async (_command, _args, invocation) => {
        scheduler.fire(1000);
        throw invocation!.signal!.reason;
      },
    });
    const result = await createTimeoutCommand({ scheduler }).execute(capture.context);
    assert.equal(result.exitCode, expected, options.join(" "));
    assert.equal(capture.stderr(), "");
    assert.equal(scheduler.pending, false);
  }
});

test("timeout validates signal options before invoking the child", async () => {
  for (const options of [["--signal=bogus"], ["-s", "65"], ["-s"], ["--preserve-status=yes"], ["-p=yes"], ["--foreground=yes"], ["-fyes"]]) {
    const capture = captureContext(options, { invoke: async () => { assert.fail("invalid options invoked child"); } });
    assert.equal((await createTimeoutCommand().execute(capture.context)).exitCode, 125);
    assert.notEqual(capture.stderr(), "");
  }
});

test("timeout signal zero lets the child finish and preserve-status retains its result", async () => {
  for (const preserve of [false, true]) {
    const scheduler = new ManualScheduler();
    const capture = captureContext([...(preserve ? ["--preserve-status"] : []), "-s0", "1", "child"], {
      invoke: async (_command, _args, invocation) => {
        scheduler.fire(1000);
        assert.equal(invocation!.signal!.aborted, false);
        return { exitCode: 7 };
      },
    });
    assert.equal((await createTimeoutCommand({ scheduler }).execute(capture.context)).exitCode, preserve ? 7 : 124);
    assert.equal(scheduler.pending, false);
  }
});

test("timeout preserves a cooperative child's returned status after expiry", async () => {
  const scheduler = new ManualScheduler();
  const capture = captureContext(["--preserve-status", "1", "child"], {
    invoke: async () => { scheduler.fire(1000); return { exitCode: 7 }; },
  });
  assert.equal((await createTimeoutCommand({ scheduler }).execute(capture.context)).exitCode, 7);
});

test("timeout signal parsing is portable for aliases and realtime boundaries", () => {
  for (const [name, number] of [["sigterm", 15], ["IOT", 6], ["CLD", 17], ["POLL", 29], ["RTMIN", 34], ["SIGRTMIN+30", 64], ["RTMAX-30", 34], ["0", 0], ["64", 64]] as const) {
    assert.equal(parseSignal(name), number, name);
  }
  for (const name of ["", "-1", "65", "1.5", "RTMIN+31", "RTMAX-31", "RTMIN+", " TERM"]) {
    assert.equal(parseSignal(name), undefined, name);
  }
});

test("timeout options preserve byte streams and cancellation status through the registry", async () => {
  for (const [option, expected] of [["--preserve-status -s INT", 130], ["-p -s INT", 130], ["-s TERM", 124], ["-s KILL", 137]] as const) {
    const scheduler = new ManualScheduler();
    const chunks: Uint8Array[] = [];
    const commands = new CommandRegistry([createTimeoutCommand({ scheduler }), {
      name: "child",
      async execute(context) {
        assert.deepEqual(context.args, ["--signal", "literal argument"]);
        await context.stdout.write(Uint8Array.of(0, 255, 10));
        scheduler.fire(1000);
        context.signal.throwIfAborted();
        return { exitCode: 0 };
      },
    }]);
    const shell = new Shell({ fs: createMemoryFileSystem(), commands });
    try {
      const result = await shell.exec(`timeout ${option} 1 child --signal 'literal argument'`, {
        stdout: { async write(chunk) { chunks.push(Uint8Array.from(chunk)); } },
      });
      assert.equal(result.exitCode, expected);
      assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 10]));
      assert.equal(result.stderr, "");
      assert.equal(scheduler.pending, false);
    } finally { await shell.dispose(); }
  }
});
