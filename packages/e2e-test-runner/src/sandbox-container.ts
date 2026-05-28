import { tmpdir } from 'node:os';
import { buildSandboxCommand } from './sandbox.js';
import { createHostContainer } from './host-container.js';
import type { Container, ContainerOptions } from './types.js';

function toSandboxEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const sandboxEnv = Object.create(null) as Record<string, string>;

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      sandboxEnv[key] = value;
    }
  }

  return sandboxEnv;
}

export async function createSandboxContainer(
  options: ContainerOptions = {},
): Promise<Container> {
  return createHostContainer(options, ({ command, env, home }) => {
    return buildSandboxCommand(
      {
        home,
        writablePaths: [home, tmpdir()],
        env: toSandboxEnv(env),
      },
      command,
    );
  });
}

export const createContainer = createSandboxContainer;
