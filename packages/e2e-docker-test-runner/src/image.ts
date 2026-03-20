import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Engine } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCKERFILE_DIR = join(__dirname, '..');
const DOCKERFILE_PATH = join(DOCKERFILE_DIR, 'e2e.Dockerfile');
interface BuildTarball {
  name: string;
  packageDir: string;
}

export const BUILD_TARBALLS: ReadonlyArray<BuildTarball> = [
  { name: 'poe-code.tgz', packageDir: '.' },
  { name: 'e2e-docker-test-runner.tgz', packageDir: 'packages/e2e-docker-test-runner' },
  { name: 'auth.tgz', packageDir: 'packages/auth' },
  { name: 'agent-defs.tgz', packageDir: 'packages/agent-defs' },
  { name: 'design-system.tgz', packageDir: 'packages/design-system' },
  { name: 'agent-spawn.tgz', packageDir: 'packages/agent-spawn' },
  { name: 'poe-acp-client.tgz', packageDir: 'packages/poe-acp-client' },
  { name: 'tiny-mcp-client.tgz', packageDir: 'packages/tiny-mcp-client' },
  { name: 'poe-agent.tgz', packageDir: 'packages/poe-agent' },
  { name: 'tiny-stdio-mcp-server.tgz', packageDir: 'packages/tiny-stdio-mcp-server' },
  { name: 'tiny-stdio-mcp-test-server.tgz', packageDir: 'packages/tiny-stdio-mcp-test-server' },
];
export const IMAGE_NAME = 'poe-code-e2e';

/**
 * Collect all files matching patterns for hashing
 */
function collectFiles(baseDir: string, patterns: string[]): string[] {
  const files: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Handle glob patterns like 'src/**/*.ts'
      const parts = pattern.split('/');
      const baseIndex = parts.findIndex((p) => p.includes('*'));
      const staticPath = parts.slice(0, baseIndex).join('/');
      const startDir = join(baseDir, staticPath);

      try {
        walkDir(startDir, (filePath) => {
          if (matchesPattern(filePath, pattern, baseDir)) {
            files.push(filePath);
          }
        });
      } catch {
        // Directory doesn't exist, skip
      }
    } else {
      // Exact file path
      const filePath = join(baseDir, pattern);
      try {
        if (statSync(filePath).isFile()) {
          files.push(filePath);
        }
      } catch {
        // File doesn't exist, skip
      }
    }
  }

  return files.sort();
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules and dist
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        walkDir(fullPath, callback);
      }
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

function matchesPattern(filePath: string, pattern: string, baseDir: string): boolean {
  const relativePath = filePath.slice(baseDir.length + 1);

  // Convert glob pattern to regex
  // IMPORTANT: escape dots before expanding {{GLOBSTAR}} → .* to avoid corrupting .*
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\./g, '\\.')
    .replace(/{{GLOBSTAR}}/g, '.*');

  return new RegExp(`^${regexPattern}$`).test(relativePath);
}

/**
 * Compute hash of source files for cache invalidation
 */
export function getSourceHash(workspaceRoot: string): string {
  const patterns = [
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'turbo.json',
    'src/**/*.ts',
    'packages/*/src/**/*.ts',
    'packages/*/package.json',
    'scripts/*.mjs',
  ];

  const files = collectFiles(workspaceRoot, patterns);
  const hash = createHash('sha256');

  // Also hash the Dockerfile itself
  try {
    hash.update(readFileSync(DOCKERFILE_PATH));
  } catch {
    // Dockerfile not found, will fail later
  }

  for (const file of files) {
    try {
      hash.update(readFileSync(file));
    } catch {
      // File read error, skip
    }
  }

  return hash.digest('hex').slice(0, 12);
}

/**
 * Check if Docker image exists
 */
export function imageExists(engine: Engine, tag: string, context?: string): boolean {
  try {
    const contextArg = context && engine === 'docker' ? `--context ${context} ` : '';
    const result = execSync(`${engine} ${contextArg}images -q ${tag}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Pack a workspace package into a tarball for the Docker build context.
 */
function packTarball(cwd: string, targetName: string, verbose: boolean): void {
  const packResult = execSync('npm pack --pack-destination ' + DOCKERFILE_DIR, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', verbose ? 'inherit' : 'pipe'],
  });

  const packedFile = packResult.trim().split('\n').pop()!;
  const packedPath = join(DOCKERFILE_DIR, packedFile);
  const targetPath = join(DOCKERFILE_DIR, targetName);

  if (packedPath !== targetPath) {
    renameSync(packedPath, targetPath);
  }
}

/**
 * Create tarballs for the Docker build context.
 */
function createTarball(workspaceRoot: string, verbose: boolean): void {
  if (verbose) {
    console.error('Creating tarballs...');
  }

  for (const tarball of BUILD_TARBALLS) {
    const cwd = tarball.packageDir === '.'
      ? workspaceRoot
      : join(workspaceRoot, tarball.packageDir);
    packTarball(cwd, tarball.name, verbose);
  }
}

function cleanupTarball(): void {
  for (const tarball of BUILD_TARBALLS) {
    try {
      unlinkSync(join(DOCKERFILE_DIR, tarball.name));
    } catch {
      // Ignore if already cleaned up
    }
  }
}

/**
 * Build the Docker image
 */
export function buildImage(
  engine: Engine,
  tag: string,
  workspaceRoot: string,
  options: { verbose?: boolean; context?: string } = {}
): void {
  const verbose = options.verbose ?? process.env.E2E_VERBOSE === '1';

  if (verbose) {
    console.error(`\n--- Building e2e image: ${tag} ---\n`);
  }

  try {
    createTarball(workspaceRoot, verbose);

    const args: string[] = [];
    if (options.context && engine === 'docker') {
      args.push('--context', options.context);
    }
    args.push('build', '-t', tag, '-f', DOCKERFILE_PATH, DOCKERFILE_DIR);

    const result = spawnSync(engine, args, {
      stdio: verbose ? 'inherit' : 'pipe',
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      const error = result.stderr || 'Unknown error';
      throw new Error(`Failed to build e2e image: ${error}`);
    }

    if (verbose) {
      console.error(`\n--- Image built successfully: ${tag} ---\n`);
    }
  } finally {
    cleanupTarball();
  }
}

/**
 * Ensure the e2e image exists, building if necessary.
 * Returns the full image tag.
 */
export function ensureImage(
  engine: Engine,
  workspaceRoot: string,
  options: { verbose?: boolean; context?: string } = {}
): string {
  const hash = getSourceHash(workspaceRoot);
  const tag = `${IMAGE_NAME}:${hash}`;

  if (imageExists(engine, tag, options.context)) {
    if (options.verbose ?? process.env.E2E_VERBOSE === '1') {
      console.error(`Using cached e2e image: ${tag}`);
    }
    return tag;
  }

  buildImage(engine, tag, workspaceRoot, options);
  return tag;
}
