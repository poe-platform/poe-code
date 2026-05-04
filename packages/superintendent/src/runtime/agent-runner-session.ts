import {
  createPoeCommandSession,
  resolvePoeCommandExecution,
  type AgentRunnerSession,
  type DownloadResult,
  type OpenSpec,
  type RuntimeOverrideOptions
} from "@poe-code/agent-harness-tools";

export function createSuperintendentAgentSession(options: {
  homeDir: string;
  runtime?: RuntimeOverrideOptions;
}): AgentRunnerSession {
  let session: AgentRunnerSession | undefined;

  const getSession = (openSpec: OpenSpec): AgentRunnerSession => {
    if (session) {
      return session;
    }

    const execution = resolvePoeCommandExecution({
      cwd: openSpec.cwd,
      env: resolveOpenSpecEnv(openSpec),
      argv: openSpec.jobLabel.argv,
      tool: openSpec.jobLabel.tool,
      runtime: options.runtime,
      context: {
        homeDir: options.homeDir
      },
      openSpec
    });

    session = createPoeCommandSession({
      factory: execution.factory,
      state: execution.state
    });
    return session;
  };

  return {
    async run(openSpec, signal, runOptions) {
      return await getSession(openSpec).run(openSpec, signal, runOptions);
    },
    async syncBack(): Promise<DownloadResult> {
      return session ? await session.syncBack() : { files: 0, bytes: 0, conflicts: [] };
    },
    async close(): Promise<void> {
      await session?.close();
    }
  };
}

export async function finalizeAgentRunnerSession(
  session: AgentRunnerSession | undefined
): Promise<void> {
  if (!session) {
    return;
  }

  try {
    await session.syncBack();
  } finally {
    await session.close();
  }
}

function resolveOpenSpecEnv(openSpec: OpenSpec): Record<string, string> {
  const env = openSpec.execution?.env ?? openSpec.env;
  return (env ?? process.env) as Record<string, string>;
}
