import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { argumentsFor } from "./arguments.js";
import { Session } from "./io.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, settings, type GitCommandsOptions } from "./limits.js";
import { query } from "./queries.js";
import { Repository } from "./repository.js";

export type { GitCommandsOptions } from "./limits.js";

async function diagnostic(context: CommandContext, error: GitFailure): Promise<number> {
  context.signal.throwIfAborted();
  const message = `git: ${error.message}\n`;
  if (Buffer.byteLength(message) > GIT_LIMITS.maxDiagnosticBytes) throw new Error("Git diagnostic limit exceeded");
  await context.stderr.write(Buffer.from(message));
  context.signal.throwIfAborted();
  return error.status;
}

export function createGitCommand(options: GitCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  return {
    name: "git",
    async execute(context) {
      context.signal.throwIfAborted();
      let parsed;
      try { parsed = argumentsFor(context.args, context.cwd); }
      catch (error) { if (error instanceof GitFailure) return { exitCode: await diagnostic(context, error) }; throw error; }
      const session = new Session(context, configured.discoveryBoundary);
      let failed = false, failure: unknown, exitCode = 0, cleanupFailed = false, cleanupFailure: unknown;
      try { exitCode = await query(await Repository.discover(session, parsed.cwd), parsed); }
      catch (error) { failed = true; failure = error; }
      try { await session.operation.close(); }
      catch (error) { cleanupFailed = true; cleanupFailure = error; }
      session.finish();
      context.signal.throwIfAborted();
      if (failed && !(failure instanceof GitFailure) && !(failure instanceof ConsumerClosed)) throw failure;
      if (cleanupFailed) throw cleanupFailure;
      if (failed) exitCode = failure instanceof GitFailure ? await diagnostic(context, failure) : 141;
      return { exitCode };
    },
  };
}

export function createGitCommands(options: GitCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createGitCommand(options)]);
}

export function gitCommands(options: GitCommandsOptions = {}): VirtualShellPlugin {
  const configured = settings(options), commands = createGitCommands(configured);
  return { name: "git-commands", setup(host) { for (const command of commands) host.commands.register(command, { replace: configured.replace }); } };
}
