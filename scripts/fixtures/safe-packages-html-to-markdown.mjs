import { Shell } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createCommandArguments, getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { createHtmlToMarkdownCommand, htmlToMarkdownCommands } from "@poe-platform/safe-bash/commands/html-to-markdown";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export const verification = (async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  const command = createHtmlToMarkdownCommand();
  const encoder = new TextEncoder();
  try {
    await shell.exec("true");
    assert(!shell.commands.has("html-to-markdown"), "conversion unexpectedly registered by default");
    shell.use(htmlToMarkdownCommands());
    await shell.exec("true");
    let collision;
    try { await htmlToMarkdownCommands().setup({ commands: shell.commands }); } catch (error) { collision = error; }
    assert(collision, "duplicate registration accepted");
    shell.use(htmlToMarkdownCommands({ replace: true }));
    const input = encoder.encode('<h1>Title</h1><p><a href="https://example.com">link</a></p><script>hidden</script>');
    await fs.writeFile("/input.html", input);
    shell.use({ name: "html-source", setup(host) {
      host.commands.register({ name: "html-source", async execute(context) {
        await context.stdout.write(input);
        return { exitCode: 0 };
      } });
    } });
    await fs.writeFile("/convert.sh", encoder.encode("html-source | html-to-markdown"));
    const result = await shell.exec("sh /convert.sh");
    assert(result.exitCode === 0 && result.stdout === "# Title\n\n[link](<https://example.com>)\n" && result.stderr === "", "VFS script/pipeline conversion differs: " + JSON.stringify(result));
    shell.use({ name: "html-argv-witness", setup(host) {
      host.commands.register({ name: "html-witness", runtimeIdentity: commandRuntimeIdentity, execute(context) {
        const carrier = getCommandArguments(context);
        assert(carrier.bytes(0)[0] === 47, "Shell argv lost canonical ownership");
        return command.execute(context);
      } });
    } });
    assert((await shell.exec("html-witness /input.html")).stdout === result.stdout, "canonical argv delegation differs");
    const controller = new AbortController();
    const reason = new FsError("EIO");
    const carrier = createCommandArguments([]);
    const context = { command: "html-to-markdown", args: carrier.args, argumentValues: carrier,
      fs, cwd: "/", env: {}, signal: controller.signal,
      stdin: (async function* () { controller.abort(reason); yield encoder.encode("<p>x</p>"); })(),
      stdout: { async write() { throw new Error("cancelled conversion wrote output"); } },
      stderr: { async write() { throw new Error("cancellation became a diagnostic"); } } };
    let failure;
    try { await command.execute(context); } catch (error) { failure = error; }
    assert(failure === reason && failure instanceof FsError, "cancellation lost canonical error identity");
    shell.use(htmlToMarkdownCommands({ replace: true, limits: { maxOutputBytes: 1 } }));
    const limited = await shell.exec("html-to-markdown /input.html");
    assert(limited.exitCode === 1 && limited.stdout === "", "output byte limit was lost");
  } finally { await shell.dispose(); }
})();
