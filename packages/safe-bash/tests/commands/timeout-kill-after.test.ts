import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { createTimeoutCommand } from "../../src/commands/timeout/index.js";
import { captureContext, ManualScheduler } from "./timeout-author-20260828/fixtures.js";

test("kill-after accepts the reported file command through the default Shell", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/Changed input.txt", new TextEncoder().encode("Changed12\r\n"));
  const shell = new Shell({ fs });
  await shell.use(agentCommands());
  try {
    for (const option of ["-k 0.03", "-k0.03", "--kill-after 0.03", "--kill-after=0.03"]) {
      const result = await shell.exec(`timeout ${option} 2 cat 'Changed input.txt'`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "Changed12\r\n");
      assert.equal(result.stderr, "");
    }
  } finally { await shell.dispose(); }
});

test("kill-after forms require an escalation capability from custom hosts", async () => {
  for (const option of [["-k", "0.03"], ["-k0.03"], ["--kill-after", "0.03"], ["--kill-after=0.03"]]) {
    const capture = captureContext([...option, "2", "cat", "Changed input.txt"], {
      invoke: async () => assert.fail("host without escalation invoked"),
    });
    assert.equal((await createTimeoutCommand().execute(capture.context)).exitCode, 125);
    assert.equal(capture.stderr(), "timeout: hard escalation is unavailable on this host\n");
  }
});

test("kill-after delegates complete timeout policy to the explicit host binding", async () => {
  const capture = captureContext(["--preserve-status", "-sINT", "-k0.03", "2", "child", "literal"], {
    invoke: async () => assert.fail("cooperative invocation used"),
  });
  const command = createTimeoutCommand({
    killAfterPolicy: async (context, child, args, options, policy) => {
      assert.equal(context, capture.context);
      assert.equal(child, "child");
      assert.deepEqual(args, ["literal"]);
      assert.equal(options.stdout, capture.context.stdout);
      assert.deepEqual(policy, { durationMilliseconds: 2000, killAfterMilliseconds: 30, signalNumber: 2, preserveStatus: true });
      return { exitCode: 137 };
    },
  });
  assert.equal((await command.execute(capture.context)).exitCode, 137);
});

test("kill-after validates duration before invocation", async () => {
  for (const option of [["-k"], ["-knope"], ["--kill-after="], ["--kill-after=999999999999999999999d"]]) {
    const capture = captureContext(option, { invoke: async () => assert.fail("invoked") });
    assert.equal((await createTimeoutCommand().execute(capture.context)).exitCode, 125);
    assert.match(capture.stderr(), /duration/);
  }
});

test("cooperative expiry preserves status after child rejection", async () => {
  const scheduler = new ManualScheduler();
  const capture = captureContext(["1", "child"], {
    invoke: async (_command, _args, options) => {
      scheduler.fire(1000);
      throw options!.signal!.reason;
    },
  });
  assert.equal((await createTimeoutCommand({ scheduler }).execute(capture.context)).exitCode, 124);
  assert.equal(capture.stderr(), "");
  assert.equal(scheduler.pending, false);
});
