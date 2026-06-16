import path from "node:path";
import type { E2bRuntime } from "@poe-code/poe-code-config";
import type { ExecutionEnvFactory, OpenSpec, OpenedEnv } from "@poe-code/agent-harness-tools";
import { createSandbox, connectSandbox } from "./sdk.js";
import { buildE2bRuntimeTemplate } from "./template-build.js";
import { createOpenedE2bEnv } from "./opened-env.js";
import { resolveE2bApiKey } from "./auth-scope.js";

interface E2bReattachContext extends Record<string, unknown> {
  runtimeCwd?: string;
  workspaceDir?: string;
  preserveAfterExitHours?: number;
}

export const e2bExecutionEnvFactory: ExecutionEnvFactory = {
  type: "e2b",
  supportsDetach: true,
  async open(spec): Promise<OpenedEnv> {
    const runtime = parseE2bRuntime(spec.runtime);
    rejectRuntimeMounts(runtime);
    const runtimeCwd = spec.runtimeCwd ?? spec.cwd;
    const apiKey = await resolveE2bApiKey({ cwd: runtimeCwd });
    const templateId =
      runtime.template_id ??
      (
        await buildE2bRuntimeTemplate({
          runtime,
          dockerfilePath: path.resolve(
            runtimeCwd,
            runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
          ),
          buildContext: path.resolve(runtimeCwd, runtime.build_context ?? "."),
          state: spec.state,
          apiKey
        })
      ).templateId;
    const sandbox = await createSandbox({
      apiKey,
      templateId,
      env: spec.env,
      timeoutMinutes: runtime.timeout_minutes
    });

    const reattachContext = createE2bReattachContext(spec, runtime);
    return createOpenedE2bEnv({
      sandbox,
      spec,
      runtime,
      ...(reattachContext === undefined ? {} : { reattachContext })
    });
  },
  async attach(envId, context): Promise<OpenedEnv> {
    const reattachContext = parseE2bReattachContext(context?.reattachContext);
    const cwd = context?.cwd ?? process.cwd();
    const apiKey = await resolveE2bApiKey({ cwd: reattachContext.runtimeCwd ?? cwd });
    const sandbox = await connectSandbox(envId, apiKey);
    const runtime: E2bRuntime = {
      type: "e2b",
      build_args: {},
      mounts: [],
      ...(reattachContext.workspaceDir === undefined
        ? {}
        : { workspace_dir: reattachContext.workspaceDir }),
      ...(reattachContext.preserveAfterExitHours === undefined
        ? {}
        : { preserve_after_exit_hours: reattachContext.preserveAfterExitHours })
    };
    return createOpenedE2bEnv({
      sandbox,
      spec: {
        cwd: context?.cwd ?? "/workspace",
        runtime,
        env: {},
        uploadIgnoreFiles: [],
        jobLabel: { tool: context?.tool ?? "e2b", argv: context?.argv ?? [] },
        ...(context?.jobId ? { detachedJobId: context.jobId } : {})
      } as OpenSpec & { detachedJobId?: string },
      runtime,
      reattachContext
    });
  }
};

function createE2bReattachContext(
  spec: OpenSpec,
  runtime: E2bRuntime
): E2bReattachContext | undefined {
  const reattachContext = {
    ...(spec.runtimeCwd === undefined ? {} : { runtimeCwd: spec.runtimeCwd }),
    ...(runtime.workspace_dir === undefined ? {} : { workspaceDir: runtime.workspace_dir }),
    ...(runtime.preserve_after_exit_hours === undefined
      ? {}
      : { preserveAfterExitHours: runtime.preserve_after_exit_hours })
  };
  return Object.keys(reattachContext).length === 0 ? undefined : reattachContext;
}

function parseE2bReattachContext(value: Record<string, unknown> | undefined): E2bReattachContext {
  if (value === undefined) {
    return {};
  }

  return {
    ...(typeof value.runtimeCwd === "string" ? { runtimeCwd: value.runtimeCwd } : {}),
    ...(typeof value.workspaceDir === "string" ? { workspaceDir: value.workspaceDir } : {}),
    ...(typeof value.preserveAfterExitHours === "number"
      ? { preserveAfterExitHours: value.preserveAfterExitHours }
      : {})
  };
}

function parseE2bRuntime(runtime: unknown): E2bRuntime {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("e2b runtime must be an object");
  }
  const record = runtime as Record<string, unknown>;
  if (record.type !== "e2b") {
    throw new Error('e2b runtime type must be "e2b"');
  }
  return record as unknown as E2bRuntime;
}

function rejectRuntimeMounts(runtime: E2bRuntime): void {
  if (runtime.mounts.length > 0) {
    throw new Error(
      "E2B runtime mounts are not supported. Use workspace upload/download sync or include required files in the configured build context."
    );
  }
}
