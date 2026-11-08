import * as root from "@poe-platform/safe-bash";
import { createCurlCommand, createCurlCommands, curlCommands } from "@poe-platform/safe-bash/commands/curl";
import * as contracts from "@poe-platform/safe-bash/contracts/command";
import * as values from "@poe-platform/safe-bash/contracts/value";
import { FsError } from "@poe-platform/safe-bash/contracts/errors";

function check(value, message) { if (!value) throw new Error(message); }
export const verification = (async () => {
  check(root.commandRuntimeIdentity === contracts.commandRuntimeIdentity, "curl contract identity");
  check(root.FsError === FsError, "curl filesystem error identity");
  check(root.createCurlCommand === createCurlCommand, "curl factory identity");
  check(!root.createAgentCommands().some(command => command.name === "curl"), "curl must remain opt-in");
  check(createCurlCommands().map(command => command.name).join() === "curl", "curl-only inventory");
  check(root.createCurlCommands().map(command => command.name).join() === "curl,wget", "legacy network inventory");
  const raw = contracts.createCommandArguments([values.shellValueFromBytes(Uint8Array.of(255)), values.shellValueFromBytes(Uint8Array.of(254))]);
  check(root.getCommandArguments({ args: raw.args, argumentValues: raw }) === raw, "canonical argv carrier");
  check(raw.bytes(0)[0] === 255 && raw.bytes(1)[0] === 254, "canonical byte values");
  let rejected = false;
  try { root.getCommandArguments({ args: [...raw.args], argumentValues: raw }); }
  catch (error) { rejected = error instanceof contracts.CommandArgumentIdentityError; }
  check(rejected, "forged argv must fail canonical identity check");
  const fs = root.createMemoryFileSystem();
  const bytes = Uint8Array.of(255, 254, 0, 10);
  await fs.writeFile("/payload", bytes);
  await fs.writeFile("/request.sh", new TextEncoder().encode("curl -s --data-binary @/payload https://allowed.test/upload | cat"));
  let calls = 0;
  const options = { authorize: () => true, transport: async request => {
    calls++;
    const chunks = [];
    if (request.body) for await (const chunk of request.body) chunks.push(...chunk);
    check(chunks.join() === [...bytes].join(), "curl upload bytes");
    return { status: 200, statusText: "OK", headers: [], body: root.toByteSource(bytes), async dispose() {} };
  } };
  const shell = new root.Shell({ fs }).use(root.baseAgentCommands()).use(curlCommands(options));
  let carrierSeen = false;
  shell.use(async (context, next) => {
    if (context.command === "curl") {
      const carrier = contracts.getCommandArguments(context);
      check(carrier === root.getCommandArguments(context), "Shell-created curl argv identity");
      carrierSeen = true;
    }
    return next();
  });
  try {
    const result = await shell.exec("sh /request.sh");
    check(result.exitCode === 0 && [...result.stdoutBytes].join() === [...bytes].join(), "curl VFS script and binary pipe");
    check(calls === 1 && carrierSeen, "one injected request with canonical Shell argv");
    const before = shell.commands.list();
    let collision = false;
    try { curlCommands(options).setup(shell); } catch { collision = true; }
    check(collision && shell.commands.list().every((command, index) => command === before[index]), "atomic curl collision");
    curlCommands({ ...options, replace: true }).setup(shell);
    check(shell.commands.list().length === before.length, "curl replacement inventory");
  } finally { await shell.dispose(); }
  const controller = new AbortController();
  const reason = new FsError("EACCES", "/canceled");
  const canceled = new root.Shell({ fs }).use(curlCommands({ authorize: () => { controller.abort(reason); return true; }, transport: options.transport }));
  try {
    let caught;
    try { await canceled.exec("curl https://allowed.test/cancel", { signal: controller.signal }); } catch (error) { caught = error; }
    check(caught === reason && calls === 1, "curl cancellation identity before transport");
  } finally { await canceled.dispose(); }
})();
await verification;
