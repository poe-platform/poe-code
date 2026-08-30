const __v9 = globalThis.__gitAdapterV9;
import { argumentsFor } from "./arguments.js";
import { Session } from "./io.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, settings } from "./limits.js";
import { query } from "./queries.js";
import { Repository } from "./repository.js";
async function diagnostic(context, error) {
    context.signal.throwIfAborted();
    const message = `git: ${error.message}\n`;
    if (Buffer.byteLength(message) > GIT_LIMITS.maxDiagnosticBytes)
        throw new Error("Git diagnostic limit exceeded");
    await context.stderr.write(Buffer.from(message));
    context.signal.throwIfAborted();
    return error.status;
}
export function createGitCommand(options = {}) {
    const configured = settings(options);
    return {
        name: "git",
        async execute(context) {
            __v9("invocation-begin", context);
            context.signal.throwIfAborted();
            let parsed;
            try {
                parsed = argumentsFor(context.args, context.cwd);
            }
            catch (error) {
                if (error instanceof GitFailure)
                    return { exitCode: await diagnostic(context, error) };
                throw error;
            }
            const session = new Session(context, configured.discoveryBoundary);
            let failed = false, failure, exitCode = 0, cleanupFailed = false, cleanupFailure;
            try {
                exitCode = await query(await Repository.discover(session, parsed.cwd), parsed);
            }
            catch (error) {
                failed = true;
                failure = error;
            }
            try {
                await session.operation.close();
                __v9("internal-cleanup-fulfilled", context);
            }
            catch (error) {
                __v9("internal-cleanup-rejected", context, error);
                cleanupFailed = true;
                cleanupFailure = error;
            }
            context.signal.throwIfAborted();
            if (failed && !(failure instanceof GitFailure) && !(failure instanceof ConsumerClosed))
                throw failure;
            if (cleanupFailed)
                throw cleanupFailure;
            if (failed)
                exitCode = failure instanceof GitFailure ? await diagnostic(context, failure) : 141;
            return { exitCode };
        },
    };
}
export function createGitCommands(options = {}) {
    return Object.freeze([createGitCommand(options)]);
}
export function gitCommands(options = {}) {
    const configured = settings(options), commands = createGitCommands(configured);
    return { name: "git-commands", setup(host) { for (const command of commands)
            host.commands.register(command, { replace: configured.replace }); } };
}
