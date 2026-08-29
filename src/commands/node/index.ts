import { posix } from "node:path";
import type { CommandContext, CommandDefinition, CommandResult } from "../../contracts/command.js";
import { admitSource } from "./admission.js";
import { invocation } from "./cli.js";
import { NodeHost } from "./host.js";
import { NodeOwner } from "./lifecycle.js";
import { buildNodeProgram } from "./program.js";
import { NODE_PROFILE, NodeProfileError, NodeUsageError, nodeLimits, type NodeCommandOptions, type NodeCompletion, type NodeHostServices, type NodeReason, type NodeRuntimeProvider, type NodeSourceRequest } from "./types.js";
import { environment, grants, record, text } from "./values.js";

export { NODE_PROFILE, NodeProfileError, NodeUsageError, nodeLimits } from "./types.js";
export type { NodeCommandOptions, NodeCompletion, NodeGrants, NodeGuestError, NodeHostRequest, NodeHostResponse, NodeHostServices, NodeObservation, NodeReason, NodeRetirement, NodeRuntimeProvider, NodeSelector, NodeSession, NodeSourceRequest } from "./types.js";

function local(error: unknown): error is NodeProfileError | NodeUsageError { return error instanceof NodeProfileError || error instanceof NodeUsageError; }
function providerValue(value: unknown): NodeRuntimeProvider {
  const provider = record(value, ["profile", "identity", "prepare"]);
  if (provider.profile !== NODE_PROFILE || typeof provider.prepare !== "function" || text(provider.identity, nodeLimits.metadataBytes, "provider identity").length === 0) throw new TypeError("node requires an explicit qualifying provider");
  return Object.freeze(provider) as unknown as NodeRuntimeProvider;
}
export function createNodeCommand(options: NodeCommandOptions): CommandDefinition {
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
        if (!allowed.stderrWrite || owner.isClosed() || context.signal.aborted) return;
        const bounded = text(message, nodeLimits.errorBytes, "diagnostic");
        const output = "node: " + bounded + "\n";
        if (host) await host.diagnostic(output);
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
        const services: NodeHostServices = Object.freeze({
          signal: owner.signal,
          request: async value => {
            const activeHost = sessionHost();
            return owner.job(() => activeHost.request(value));
          },
          delivered: sequence => sessionHost().delivered(sequence),
          reserve: (label, bytes) => {
            sessionHost();
            try { owner.check(); return owner.ledger.reserve("provider:" + text(label, 119, "provider reservation name"), bytes); }
            catch (error) { owner.failure(error, error instanceof NodeProfileError ? "profile" : "execution"); throw error; }
          },
          cutoff: () => { sessionHost(); owner.cutoff(); },
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
        owner.capture(escaping.value, local(escaping.value) ? "profile" : "execution");
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
