import { fileURLToPath } from 'node:url';
import type { Backend } from '@poe-code/e2e-test-runner';

export function resolveMcpFixtureCommand(backend: Backend): { command: string; args: string[] } {
  if (backend === 'podman') {
    return { command: 'tiny-stdio-mcp-test-server', args: ['serve', 'word-of-the-day'] };
  }
  // npm ci runs before build, so the workspace bin link may not exist.
  // Host backends can invoke the built fixture without a link or executable bit.
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('../packages/tiny-stdio-mcp-test-server/dist/cli.js', import.meta.url)), 'serve', 'word-of-the-day'],
  };
}
