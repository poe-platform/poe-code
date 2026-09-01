import { posix } from "node:path";
import type { CommandContext, CommandDefinition, CommandResult } from "../../contracts/command.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { admitSource } from "./admission.js";
import { invocation } from "./cli.js";
import { NodeHost } from "./host.js";
import { NodeOwner } from "./lifecycle.js";
import { buildNodeProgram } from "./program.js";
import { createSafeJsNodeCommand } from "./safejs.js";
import type { NodeSafeJsCommandOptions } from "./types.js";
import { NODE_PROFILE, NodeProfileError, NodeUsageError, nodeLimits, type NodeCommandOptions, type NodeCompletion, type NodeHostServices, type NodeReason, type NodeRuntimeProvider, type NodeSourceRequest } from "./types.js";
import { environment, grants, record, text } from "./values.js";

export { NODE_PROFILE, NodeProfileError, NodeUsageError, nodeLimits } from "./types.js";
export type { NodeCommandOptions, NodeProviderCommandOptions, NodeSafeJsCommandOptions, NodeCompletion, NodeGrants, NodeGuestError, NodeHostRequest, NodeHostResponse, NodeHostServices, NodeObservation, NodeReason, NodeRetirement, NodeRuntimeProvider, NodeSelector, NodeSession, NodeSourceRequest } from "./types.js";
export { createNodeWorkerProvider } from "./worker-provider.js";
export { NODE_ENGINE_ABI } from "./worker-types.js";
export type { NodeBridge, NodeEngineAdapter, NodeEngineInput, NodeEngineResult, NodeWorkerEvent, NodeWorkerProviderOptions } from "./worker-types.js";

export type NodeCommandsOptions<Budget = unknown> = NodeCommandOptions<Budget> & {
  readonly replace?: boolean;
}

function commandConfiguration<Budget>(options: NodeCommandsOptions<Budget>): { readonly definitions: readonly CommandDefinition[]; readonly replace: boolean } {
  const settings = record(options, [], ["provider", "grants", "runtime", "limits", "replace"]);
  if (Object.hasOwn(settings, "replace") && typeof settings.replace !== "boolean") throw new TypeError("node replace must be boolean");
  const { replace, ...commandOptions } = settings;
  const definition = createNodeCommand(commandOptions as unknown as NodeCommandOptions<Budget>);
  return { definitions: Object.freeze([definition]), replace: replace === true };
}

export function createNodeCommands<Budget = unknown>(options: NodeCommandsOptions<Budget>): readonly CommandDefinition[] {
  return commandConfiguration(options).definitions;
}

export function nodeCommands<Budget = unknown>(options: NodeCommandsOptions<Budget>): VirtualShellPlugin {
  const { definitions, replace } = commandConfiguration(options);
  return {
    name: "node-commands",
    setup(host) {
      if (!replace && host.commands.has("node")) throw new Error("Command already registered: node");
      for (const definition of definitions) host.commands.register(definition, { replace });
    },
  };
}

function local(error: unknown): error is NodeProfileError | NodeUsageError { return error instanceof NodeProfileError || error instanceof NodeUsageError; }
function providerValue(value: unknown): NodeRuntimeProvider {
  const provider = record(value, ["profile", "identity", "prepare"]);
  if (provider.profile !== NODE_PROFILE || typeof provider.prepare !== "function" || text(provider.identity, nodeLimits.metadataBytes, "provider identity").length === 0) throw new TypeError("node requires an explicit qualifying provider");
  return Object.freeze(provider) as unknown as NodeRuntimeProvider;
}
export function createNodeCommand<Budget = unknown>(options: NodeCommandOptions<Budget>): CommandDefinition {
  const selected = record(options, [], ["provider", "grants", "runtime", "limits"]);
  if (Object.hasOwn(selected, "runtime")) {
    const settings = record(selected, ["runtime"], ["limits"]);
    if (settings.runtime === undefined || settings.runtime === null) throw new TypeError("node requires an injected SafeJS runtime");
    return createSafeJsNodeCommand(settings as unknown as NodeSafeJsCommandOptions<Budget>);
  }
  const settings = record(options, ["provider"], ["grants"]);
  const provider = providerValue(settings.provider);
  const allowed = grants(Object.hasOwn(settings, "grants") ? settings.grants : {});
  return Object.freeze({
    name: "node",
    description: "Explicit-provider restricted synchronous virtual Node profile",
    execute: async (context: CommandContext): Promise<CommandResult> => {
      const owner = new NodeOwner(context);
      let hold: (() => void) | undefined;
      let request: NodeSourceRequest | undefined;
      let source: string | undefined;
      let host: NodeHost | undefined;
      let result: NodeCompletion | undefined;
      let escaping: NodeReason | undefined;
      let cleanup: NodeReason | undefined;
      context.registerCleanup?.(owner.close);
      const diagnose = async (message: string): Promise<void> => {
        if (!allowed.stderrWrite || owner.retiring || owner.signal.aborted || context.signal.aborted) return;
        const bounded = text(message, nodeLimits.errorBytes, "diagnostic");
        const output = "node: " + bounded + "\n";
        if (host) await host.diagnostic(output);
        else {
          const diagnosticHost = new NodeHost(owner, allowed, "/", "/");
          await diagnosticHost.diagnostic(output);
        }
      };
      try {
        owner.open();
        hold = owner.ledger.reserve("source-context-diagnostics", nodeLimits.sourceBytes * 6 + nodeLimits.contextBytes * 4 + nodeLimits.diagnosticReserve);
        const selected = invocation(context.args, context.cwd);
        const env = environment(context.env);
        const argv = Object.freeze(selected.argv);
        let contextBytes = Buffer.byteLength(context.cwd) + Buffer.byteLength(selected.filename);
        for (const argument of argv) { if (argument.includes("\0")) throw new NodeUsageError("NUL in argument"); contextBytes += Buffer.byteLength(argument); }
        for (const [name, value] of Object.entries(env)) contextBytes += Buffer.byteLength(name) + Buffer.byteLength(value);
        if (argv.length > 128 || contextBytes > nodeLimits.contextBytes) throw new NodeProfileError("context bytes/entries");
        const cwd = text(context.cwd, nodeLimits.pathBytes, "cwd");
        host = new NodeHost(owner, allowed, cwd, selected.selector === "file" ? posix.dirname(selected.filename) : cwd);
        owner.attachHost(host);
        if (selected.source === null) source = await host.source(selected.selector === "file" ? selected.filename : null);
        else {
          source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(selected.source));
          if (source.startsWith("\ufeff")) source = source.slice(1);
        }
        text(source, nodeLimits.sourceBytes, "source bytes");
        const parseRelease = owner.ledger.reserve("source-admission", source.length * 32);
        try { admitSource(source, selected.selector === "print"); } finally { parseRelease(); }
        owner.check();
        request = Object.freeze({ profile: NODE_PROFILE, selector: selected.selector, source, program: buildNodeProgram(source, selected.selector), filename: selected.filename, cwd, argv, env, grants: allowed, limits: nodeLimits });
        const sessionHost = (): NodeHost => {
          if (!owner.started || !host) { const error = new NodeProfileError("inactive provider session"); owner.failure(error, "profile"); throw error; }
          return host;
        };
        const services: NodeHostServices = Object.freeze<NodeHostServices>({
          signal: owner.signal,
          request: async value => {
            const activeHost = sessionHost();
            return owner.job(() => activeHost.request(value));
          },
          delivered: sequence => sessionHost().delivered(sequence),
          reserve: (label, bytes) => {
            sessionHost();
            try { owner.check(); return owner.ledger.reserve("provider:" + text(label, 119, "provider reservation name"), bytes); }
            catch (error) { owner.failure(error, "profile"); throw error; }
          },
          cutoff: () => { sessionHost(); owner.cutoff(); },
          job: owner.job,
          stopProfile: reason => {
            sessionHost();
            const failure = record(reason, ["present", "value"]);
            if (failure.present !== true) throw new TypeError("provider profile failure presence");
            owner.failure(failure.value, "profile");
          },
          fail: reason => {
            sessionHost();
            const failure = record(reason, ["present", "value"]);
            if (failure.present !== true) throw new TypeError("provider execution failure presence");
            owner.failure(failure.value, "execution");
          },
        });
        const prepare = provider.prepare;
        let prepared: unknown;
        try { prepared = prepare(request, services); }
        catch (error) { owner.capture(error, "execution"); throw error; }
        owner.attachSession(prepared);
        result = await owner.start();
        if (result.kind !== "entryReturned") await diagnose(result.observation.state === "captured" ? result.observation.message ?? result.observation.name ?? "guest failed" : "guest failure; diagnostic unavailable");
        owner.cutoff();
      } catch (error) {
        escaping = { present: true, value: error };
        if (local(error) && (!owner.primary || owner.primaryIsProfile)) {
          try { await diagnose(error.message); }
          catch (diagnosticFailure) { escaping = { present: true, value: diagnosticFailure }; }
        }
        owner.capture(escaping.value, "profile");
      } finally {
        try { await owner.close(); } catch (error) { cleanup = { present: true, value: error }; }
        source = undefined; request = undefined; host = undefined; hold?.(); hold = undefined;
      }
      context.signal.throwIfAborted();
      const primary = owner.primary ?? escaping;
      if (primary && !owner.primaryIsProfile) throw primary.value;
      if (cleanup) throw cleanup.value;
      if (primary) return { exitCode: 2 };
      if (!result) throw new NodeProfileError("missing completion");
      return { exitCode: result.kind === "entryReturned" ? 0 : result.kind === "guestFailure" ? 1 : 2 };
    },
  });
}
