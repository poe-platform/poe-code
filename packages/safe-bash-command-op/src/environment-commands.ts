import type { OpBackend, OpBackendRequest } from "./types.js";
import { selectOpBackendContext, selectOpGlobalFlags, type OpCommandContext } from "./cli.js";
import { captureEnvironment, restoreEnvironment, type EnvironmentSnapshot } from "./environment.js";
import { createMaskedSink } from "./secrets.js";
import { createOpTextCodec } from "./encoding.js";
import { createHandlerPreparation, createSourceSnapshot, type OpEffectIntent } from "./handler-preparation.js";

export interface EnvironmentCommandContext extends OpCommandContext {
  restoreEnvironment?: (snapshot: EnvironmentSnapshot, context: { signal: AbortSignal }) => Promise<void>;
}

function metadata(value: unknown): { id: string; name: string; variables: number; scope: string } {
  if (value === null || typeof value !== "object" || !("snapshot" in value) || !("id" in value) || typeof value.id !== "string") throw new Error("Invalid stored environment snapshot");
  restoreEnvironment(value.snapshot, {});
  const snapshot = value.snapshot as EnvironmentSnapshot;
  return { id: value.id, name: "name" in value && typeof value.name === "string" ? value.name : value.id, variables: Object.keys(snapshot.variables).length, scope: snapshot.scope };
}

function shellScript(shell: string, snapshot: EnvironmentSnapshot, current: Record<string, string>): string {
  if (!["bash", "zsh", "sh", "fish", "powershell"].includes(shell)) throw new Error("Unsupported restoration shell");
  const names = new Set([...(snapshot.scope === "complete" ? Object.keys(current) : []), ...Object.keys(snapshot.variables)]);
  for (const name of names) {
    if (![...name].every((character, index) => character === "_" || (character >= "A" && character <= "Z") || (character >= "a" && character <= "z") || (index > 0 && character >= "0" && character <= "9"))) {
      throw new Error("Environment contains a name that cannot be restored by a shell script");
    }
  }
  const lines: string[] = [];
  for (const name of names) {
    const value = Object.hasOwn(snapshot.variables, name) ? snapshot.variables[name] : undefined;
    if (value === null || value === undefined) {
      lines.push(shell === "fish" ? `set -e ${name}` : shell === "powershell" ? `Remove-Item Env:${name} -ErrorAction SilentlyContinue` : `unset ${name}`);
      continue;
    }
    if (shell === "powershell") lines.push(`$env:${name} = '${value.split("'").join("''")}'`);
    else if (shell === "fish") lines.push(`set -gx ${name} '${value.split("\\").join("\\\\").split("'").join("\\'")}'`);
    else lines.push(`export ${name}='${value.split("'").join("'\\''")}'`);
  }
  return `${lines.join("\n")}\n`;
}

export function createEnvironmentHandlers(backend: OpBackend) {
  const handlers: Record<string, (request: OpBackendRequest, context: EnvironmentCommandContext) => Promise<{ exitCode: number }>> = {};
  for (const action of ["create", "get", "list", "delete", "restore"]) {
    handlers[`environment snapshot ${action}`] = Object.assign(async (request: OpBackendRequest, context: EnvironmentCommandContext) => {
      context.signal.throwIfAborted();
      if (action === "list" ? request.args.length !== 0 : action === "restore" ? request.args.length < 1 : request.args.length !== 1) throw new Error("Invalid environment snapshot arguments");
      let value: unknown;
      if (action === "create") {
        const selected = request.flags.vars;
        if (selected !== undefined && (!Array.isArray(selected) || selected.some(name => typeof name !== "string"))) throw new Error("Invalid snapshot variable selection");
        const snapshot = captureEnvironment(context.env, { names: selected as readonly string[] | undefined });
        value = metadata(await backend.execute({ ...request, resource: "environment snapshot", args: [], input: { name: request.args[0], snapshot } }, selectOpBackendContext(context)));
      } else if (action === "restore") {
        const stored = await backend.execute({ resource: "environment snapshot", action: "get", args: [request.args[0]], flags: selectOpGlobalFlags(request.flags) }, selectOpBackendContext(context));
        metadata(stored);
        const snapshot = structuredClone((stored as { snapshot: EnvironmentSnapshot }).snapshot);
        const variables = restoreEnvironment(snapshot, context.env);
        context.signal.throwIfAborted();
        if (request.flags.shell !== undefined) {
          if (typeof request.flags.shell !== "string" || request.args.length !== 1) throw new Error("Shell output cannot be combined with a child command");
          await context.stdout.write(createOpTextCodec(request.flags.encoding).encode(shellScript(request.flags.shell, snapshot, context.env)));
        } else if (request.args.length > 1) {
          if (!context.invoke) throw new Error("Environment restoration requires a host invocation capability");
          if (request.flags["no-masking"] === true) {
            const result = await context.invoke(request.args[1], request.args.slice(2), { env: variables });
            context.signal.throwIfAborted();
            return result;
          }
          const values = Object.values(snapshot.variables).filter((value): value is string => typeof value === "string");
          const stdout = createMaskedSink(context.stdout, values, context.signal);
          const stderr = createMaskedSink(context.stderr, values, context.signal);
          const result = await context.invoke(request.args[1], request.args.slice(2), { env: variables, stdout: stdout.sink, stderr: stderr.sink });
          context.signal.throwIfAborted();
          await stdout.flush();
          await stderr.flush();
          return result;
        } else {
          if (!context.restoreEnvironment) throw new Error("Host environment restoration is unavailable; use --shell or supply a child command after --");
          await context.restoreEnvironment(snapshot, { signal: context.signal });
          context.signal.throwIfAborted();
        }
        return { exitCode: 0 };
      } else {
        value = await backend.execute({ ...request, resource: "environment snapshot" }, selectOpBackendContext(context));
        if (action === "list") {
          if (!Array.isArray(value)) throw new Error("Invalid snapshot collection");
          value = value.map(metadata);
        } else if (action === "get") metadata(value);
      }
      context.signal.throwIfAborted();
      if (value !== undefined) await context.stdout.write(createOpTextCodec(request.flags.encoding).encode(`${JSON.stringify(value, null, 2)}\n`));
      return { exitCode: 0 };
    }, {
      async prepare(request: OpBackendRequest, context: EnvironmentCommandContext) {
        const source = createSourceSnapshot(context);
        if (action === "list" ? request.args.length !== 0 : action === "restore" ? request.args.length < 1 : request.args.length !== 1) throw new Error("Invalid environment snapshot arguments");
        if (action === "create") {
          const selected = request.flags.vars;
          if (selected !== undefined && (!Array.isArray(selected) || selected.some(name => typeof name !== "string"))) throw new Error("Invalid snapshot variable selection");
          const snapshot = captureEnvironment(source.context.env, { names: selected as readonly string[] | undefined });
          return createHandlerPreparation([{ ...request, resource: "environment snapshot", args: [], input: { name: request.args[0], snapshot } }], source.context, [{ kind: "stdout", environmentNames: Object.keys(snapshot.variables), unsetNames: Object.entries(snapshot.variables).filter(([, value]) => value === null).map(([key]) => key) }]);
        }
        if (action !== "restore") return createHandlerPreparation([{ ...request, resource: "environment snapshot" }], source.context, [{ kind: "stdout" }]);
        const nested = { resource: "environment snapshot", action: "get", args: [request.args[0]!], flags: selectOpGlobalFlags(request.flags) };
        const effect: OpEffectIntent = request.flags.shell !== undefined ? { kind: "stdout" } : request.args.length > 1 ? { kind: "invoke", command: request.args[1]!, args: request.args.slice(2), masking: request.flags["no-masking"] !== true } : { kind: "restore" };
        return createHandlerPreparation([nested], source.context, [effect], metadata => {
          const environment = metadata[0]?.environment;
          if (!environment || !environment.dependenciesComplete || !environment.scope || !environment.unsetNames) throw new Error("Snapshot key metadata is unavailable");
          const unsetNames = new Set(environment.unsetNames);
          if (environment.scope === "complete") for (const key of Object.keys(source.context.env)) if (!environment.names.includes(key)) unsetNames.add(key);
          const names = new Set(environment.scope === "selected" && effect.kind === "invoke" ? Object.keys(source.context.env) : []);
          for (const key of environment.names) if (!unsetNames.has(key)) names.add(key);
          for (const key of unsetNames) names.delete(key);
          return [{ ...effect, environmentNames: [...names], unsetNames: [...unsetNames] }];
        });
      },
    });
  }
  return handlers;
}
