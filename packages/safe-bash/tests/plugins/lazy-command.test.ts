import assert from "node:assert/strict";
import { test } from "node:test";
import { createLazyCommandLoader, createLazyCommands } from "../../src/plugins/lazy-command.js";
import { Shell } from "../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import type { CommandContext } from "../../src/contracts/command.js";
import { writeText } from "../../src/contracts/io.js";

test("registration and discovery do not load; concurrent first executions share code only", async () => {
  let loads = 0,
    factories = 0;
  const contexts: unknown[] = [];
  const load = createLazyCommandLoader(async () => {
    loads++;
    return () => {
      factories++;
      return [
        {
          name: "lazy",
          async execute(context: CommandContext) {
            contexts.push(context);
            await writeText(
              context.stdout,
              `${context.cwd}:${context.env.MARK}:${context.args.join("|")}`
            );
            return { exitCode: 0 };
          }
        }
      ];
    };
  });
  const commands = createLazyCommands([{ name: "lazy", description: "Lazy test" }], load);
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  shell.register(commands[0]!);
  assert.equal(shell.commands.get("lazy")?.description, "Lazy test");
  assert.equal(loads, 0);
  const results = await Promise.all([
    shell.exec("MARK=one lazy 'a b' '$literal'"),
    shell.exec("MARK=two lazy second")
  ]);
  assert.equal(loads, 1);
  assert.equal(factories, 2);
  assert.notEqual(contexts[0], contexts[1]);
  assert.equal(results[0]!.stdout, "/:one:a b|$literal");
  assert.equal(results[1]!.stdout, "/:two:second");
  await shell.dispose();
});

test("a rejected load is shared, then retried without poisoning another loader", async () => {
  let attempts = 0;
  const load = createLazyCommandLoader(async () => {
    if (++attempts === 1) throw new Error("temporary");
    return 42;
  });
  const first = await Promise.allSettled([load(), load()]);
  assert.ok(first.every((result) => result.status === "rejected"));
  assert.equal(attempts, 1);
  assert.equal(await load(), 42);
  assert.equal(attempts, 2);
});

test("cancelled wait does not cancel shared loading or dispatch late work", async () => {
  let release!: () => void;
  let dispatched = 0;
  const load = createLazyCommandLoader(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => [
      {
        name: "lazy",
        async execute() {
          dispatched++;
          return { exitCode: 0 };
        }
      }
    ];
  });
  const command = createLazyCommands([{ name: "lazy" }], load)[0]!;
  const controller = new AbortController();
  const invocation = Promise.resolve(command.execute({ signal: controller.signal } as unknown as CommandContext));
  await Promise.resolve();
  controller.abort(new Error("cancelled"));
  await assert.rejects(invocation, /cancelled/);
  release();
  await load();
  assert.equal(dispatched, 0);
  assert.equal(
    (await command.execute({ signal: new AbortController().signal } as unknown as CommandContext))
      .exitCode,
    0
  );
});
