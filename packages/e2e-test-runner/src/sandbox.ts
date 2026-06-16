export interface SandboxConfig {
  home: string;
  writablePaths: string[];
  env: Record<string, string>;
}

const MACOS_SYSTEM_WRITABLE_PATHS = ['/dev', '/private/var/folders'];

function collectUniquePaths(paths: string[]): string[] {
  const writablePaths: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    if (path.length === 0 || seen.has(path)) {
      continue;
    }

    seen.add(path);
    writablePaths.push(path);
  }

  return writablePaths;
}

function collectWritablePaths(config: SandboxConfig): string[] {
  return collectUniquePaths([config.home, ...config.writablePaths]);
}

function getMacOsWritablePaths(config: SandboxConfig): string[] {
  return collectUniquePaths([...collectWritablePaths(config), ...MACOS_SYSTEM_WRITABLE_PATHS]);
}

function getEnvEntries(config: SandboxConfig): Array<[string, string]> {
  const entries: Array<[string, string]> = [['HOME', config.home]];

  for (const [key, value] of Object.entries(config.env)) {
    if (key === 'HOME') {
      continue;
    }
    entries.push([key, value]);
  }

  return entries;
}

function escapeSandboxPath(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function buildMacOsCommand(config: SandboxConfig, command: string): { bin: string; args: string[] } {
  const profileLines = [
    '(version 1)',
    '(deny default)',
    '(allow process*)',
    '(allow sysctl*)',
    '(allow mach*)',
    '(allow signal)',
    '(allow file-read*)',
    '(allow network*)',
    ...getMacOsWritablePaths(config).map(
      (path) => `(allow file-write* (subpath "${escapeSandboxPath(path)}"))`,
    ),
  ];

  return {
    bin: 'sandbox-exec',
    args: [
      '-p',
      `${profileLines.join('\n')}\n`,
      'env',
      ...getEnvEntries(config).map(([key, value]) => `${key}=${value}`),
      'sh',
      '-c',
      command,
    ],
  };
}

function buildLinuxCommand(config: SandboxConfig, command: string): { bin: string; args: string[] } {
  return {
    bin: 'bwrap',
    args: [
      '--ro-bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--tmpfs',
      '/tmp',
      ...collectWritablePaths(config).flatMap((path) => ['--bind', path, path]),
      ...getEnvEntries(config).flatMap(([key, value]) => ['--setenv', key, value]),
      '--die-with-parent',
      '--',
      'sh',
      '-c',
      command,
    ],
  };
}

export function buildSandboxCommand(
  config: SandboxConfig,
  command: string,
): { bin: string; args: string[] } {
  switch (process.platform) {
    case 'darwin':
      return buildMacOsCommand(config, command);
    case 'linux':
      return buildLinuxCommand(config, command);
    default:
      throw new Error(`Unsupported sandbox platform: ${process.platform}`);
  }
}
