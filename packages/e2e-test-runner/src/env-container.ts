import { createHostContainer } from './host-container.js';
import type { Container, ContainerOptions } from './types.js';

export async function createEnvContainer(
  options: ContainerOptions = {},
): Promise<Container> {
  return createHostContainer(options, ({ command }) => ({
    bin: 'sh',
    args: ['-c', command],
  }));
}

export const createContainer = createEnvContainer;
