import { Shell } from "@poe-platform/safe-bash";
import { createMemoryFileSystem } from "@poe-platform/safe-fs";
import { createWgetCommand, createWgetCommands, wgetCommands } from "@poe-platform/safe-bash/commands/wget";
import { getCommandArguments, commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts/command";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";
import { FsError as filesystemError } from "@poe-platform/safe-fs";
import { shellValueBytes } from "@poe-platform/safe-bash/contracts/value";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(FsError === filesystemError, "canonical filesystem error identity");
  check(createWgetCommands().map(command => command.name).join() === "wget", "wget-only registration");
  const fs = createMemoryFileSystem();
  const encoder = new TextEncoder();
  const payload = Uint8Array.of(0, 255, 128, 10);
  const requests = [], authorized = [];
  let disposals = 0, witnessed = 0;
  const options = {
    limits: { maxUrls: 8, maxBufferBytes: 4096, maxDownloadBytes: 16, maxRetries: 0 },
    authorize: request => { authorized.push(request.url); return true; },
    async transport(request) {
      requests.push(request.url);
      const redirect = request.url.endsWith("/start");
      return { status: redirect ? 302 : 200, statusText: "OK", headers: redirect ? [["Location", "/file"]] : [],
        body: (async function* () { if (!redirect) yield payload; })(), async dispose() { disposals++; } };
    },
  };
  const command = createWgetCommand(options);
  const shell = new Shell({ fs }).use(wgetCommands(options));
  shell.use({ name: "wget-boundary-witness", setup(host) {
    host.commands.register({ ...command, runtimeIdentity: commandRuntimeIdentity, execute(context) {
      if (context.args[0] === "raw") {
        const argv = getCommandArguments(context);
        check(argv === context.argumentValues, "canonical paired argv");
        check(shellValueBytes(argv.values[1])[0] === 255, "first invalid byte identity");
        check(shellValueBytes(argv.values[2])[0] === 254, "second invalid byte identity");
        witnessed++;
      }
      return command.execute(context);
    } }, { replace: true });
    host.commands.register({ name: "raw-byte", async execute(context) {
      await context.stdout.write(Uint8Array.of(Number(context.args[0]))); return { exitCode: 0 };
    } });
  } });
  try {
    await fs.writeFile("/script.sh", encoder.encode("wget -q -O /download https://offline.invalid/start; wget -q -i - -O -"));
    const result = await shell.exec("sh /script.sh", { stdin: "https://offline.invalid/file\n" });
    check(result.exitCode === 0 && result.stderr === "", "VFS script and stdin URL list: " + result.stderr);
    check([...result.stdoutBytes].join() === [...payload].join(), "binary stdout publication");
    check([...await fs.readFile("/download")].join() === [...payload].join(), "binary VFS publication");
    check(authorized.join() === requests.join() && requests.length === 3, "authorization at every redirect");
    check(disposals === requests.length, "response cleanup");
    const pipe = await shell.exec("raw-byte 10 | wget -q -i - -O - https://offline.invalid/file");
    check(pipe.exitCode === 0 && [...pipe.stdoutBytes].join() === [...payload].join(), "pipeline URL input");
    const before = requests.length;
    const invalid = await shell.exec('wget raw "$(raw-byte 255)" "$(raw-byte 254)"');
    check(invalid.exitCode === 2 && witnessed === 1 && requests.length === before, "reject invalid UTF-8 before host effects");
    shell.use(wgetCommands({ ...options, replace: true, limits: { ...options.limits, maxDownloadBytes: 3 } }));
    check((await shell.exec("wget -q -O - https://offline.invalid/file")).exitCode !== 0, "explicit download quota");
  } finally { await shell.dispose(); }
  const collision = new Shell({ fs }).use(wgetCommands(options)).use(wgetCommands(options));
  try {
    let rejected = false;
    try { await collision.exec(":"); } catch (error) { rejected = error.message.includes("already registered"); }
    check(rejected, "registration collision");
  } finally { await collision.dispose(); }
  const reason = new Error("wget cancellation");
  const controller = new AbortController();
  let disposed = false;
  const cancelled = new Shell({ fs }).use(wgetCommands({ ...options, async transport() {
    return { status: 200, statusText: "OK", headers: [], body: (async function* () { controller.abort(reason); yield payload; })(),
      async dispose() { disposed = true; } };
  } }));
  try {
    let caught;
    try { await cancelled.exec("wget -q -O - https://offline.invalid/file", { signal: controller.signal }); } catch (error) { caught = error; }
    check(caught === reason && disposed, "cancellation identity and cleanup");
  } finally { await cancelled.dispose(); }
})();
await verification;
