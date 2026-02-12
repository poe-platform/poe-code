import { randomUUID } from 'node:crypto';
import { spawn as spawnAsync, spawnSync } from 'node:child_process';
import type { Container, ContainerOptions, ExecResult } from './types.js';
import { detectEngine } from './engine.js';
import { ensureImage } from './image.js';
import { getApiKey } from './credentials.js';
import { getResolvedContext, buildContextArgs } from './context.js';
import {
  MOUNT_TARGET,
  NPM_CACHE_DIR,
  UV_CACHE_DIR,
  getWorkspaceDir,
} from './container.js';
import { mkdirSync, existsSync } from 'node:fs';

const CONTAINER_LABEL = 'poe-e2e-test-runner=true';
export const CONTAINER_HOME = '/home/poe';
export const CONTAINER_PATH = `${CONTAINER_HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;

function ensureCacheDirs(): void {
  for (const dir of [NPM_CACHE_DIR, UV_CACHE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function generateContainerName(): string {
  return `poe-e2e-${randomUUID().split('-')[0]}`;
}

export function buildCreateArgs(config: {
  name: string;
  mountSource: string;
  npmCacheDir: string;
  uvCacheDir: string;
  apiKey: string | null;
  image: string;
}): string[] {
  const args: string[] = [
    'create',
    '--name', config.name,
    '--label', CONTAINER_LABEL,
    '-v', `${config.mountSource}:${MOUNT_TARGET}:rw`,
    '-v', `${config.npmCacheDir}:${CONTAINER_HOME}/.npm:rw`,
    '-v', `${config.uvCacheDir}:${CONTAINER_HOME}/.cache/uv:rw`,
    '-w', MOUNT_TARGET,
  ];

  args.push('-e', `PATH=${CONTAINER_PATH}`);

  if (config.apiKey) {
    args.push('-e', 'POE_API_KEY');
    args.push('-e', 'POE_CODE_STDERR_LOGS=1');
  }

  args.push(config.image, 'sleep', '86400');

  return args;
}

export function buildExecArgs(containerId: string, command: string): string[] {
  return ['exec', containerId, 'sh', '-c', command];
}

function execStreaming(engine: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnAsync(engine, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const workspace = getWorkspaceDir() ?? process.cwd();
  ensureCacheDirs();

  const engine = detectEngine();
  const context = getResolvedContext();
  const ctxArgs = buildContextArgs(engine, context);
  const image = options.image ?? ensureImage(engine, workspace, { context: context ?? undefined });
  const apiKey = getApiKey();
  const name = generateContainerName();

  const createArgs = buildCreateArgs({
    name,
    mountSource: workspace,
    npmCacheDir: NPM_CACHE_DIR,
    uvCacheDir: UV_CACHE_DIR,
    apiKey,
    image,
  });

  const env = { ...process.env };
  if (apiKey) {
    env.POE_API_KEY = apiKey;
  }

  const createResult = spawnSync(engine, [...ctxArgs, ...createArgs], {
    encoding: 'utf-8',
    env,
  });

  if (createResult.status !== 0) {
    throw new Error(`Failed to create container: ${createResult.stderr}`);
  }

  const containerId = createResult.stdout.trim();

  const startResult = spawnSync(engine, [...ctxArgs, 'start', containerId], {
    encoding: 'utf-8',
  });

  if (startResult.status !== 0) {
    // Clean up the created container on start failure
    spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
    throw new Error(`Failed to start container: ${startResult.stderr}`);
  }

  const exec = async (command: string): Promise<ExecResult> => {
    const verbose = process.env.E2E_VERBOSE === '1';
    const execArgs = buildExecArgs(containerId, command);
    const fullArgs = [...ctxArgs, ...execArgs];

    if (verbose) {
      const result = await execStreaming(engine, fullArgs);
      return { exitCode: result.exitCode, stdout: result.stdout.trim(), stderr: result.stderr.trim(), command };
    }

    const result = spawnSync(engine, fullArgs, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return {
      exitCode: result.status ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
      command,
    };
  };

  const execOrThrow = async (command: string): Promise<ExecResult> => {
    const result = await exec(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed: "${command}" (exit code ${result.exitCode})\n${result.stderr}`
      );
    }
    return result;
  };

  return {
    id: containerId,

    destroy: async () => {
      spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
    },

    exec,

    execOrThrow,

    async login(): Promise<void> {
      if (!apiKey) {
        throw new Error('No API key available. Set POE_API_KEY or POE_CODE_API_KEY environment variable.');
      }
      await execOrThrow(`poe-code login --api-key '${apiKey}'`);
    },

    async fileExists(filePath: string): Promise<boolean> {
      const result = await exec(`test -f ${filePath}`);
      return result.exitCode === 0;
    },

    async readFile(filePath: string): Promise<string> {
      const result = await exec(`cat ${filePath}`);
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to read file "${filePath}": ${result.stderr}`
        );
      }
      return result.stdout;
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const result = spawnSync(engine, [...ctxArgs, 'exec', '-i', containerId, 'sh', '-c', `cat > ${filePath}`], {
        encoding: 'utf-8',
        input: content,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if ((result.status ?? 1) !== 0) {
        throw new Error(
          `Failed to write file "${filePath}": ${(result.stderr ?? '').trim()}`
        );
      }
    },
  };
}
