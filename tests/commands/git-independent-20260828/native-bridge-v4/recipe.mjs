import { TOOLS, HASHES, IDS, ownedRoot, exact, need, ownValue } from './finite.mjs';

export function nativeRecipe(root, row) {
  ownedRoot(root);
  need(IDS.includes(row.id), 'six original observations only');
  const empty = `${root}/empty`;
  const settings = [
    `core.hooksPath=${empty}/hooks`, 'core.fsmonitor=false',
    `core.attributesFile=${empty}/attributes`, `core.excludesFile=${empty}/excludes`,
    'core.autocrlf=false', 'core.filemode=false', 'core.quotePath=true', 'core.pager=',
    'core.untrackedCache=false', 'core.preloadIndex=false', 'core.useReplaceRefs=false',
    'diff.autoRefreshIndex=false', 'diff.renames=false', 'diff.external=',
    'diff.ignoreSubmodules=none', 'color.ui=false', 'color.status=false', 'color.diff=false',
    'log.showSignature=false', 'log.decorate=false', 'gc.auto=0', 'maintenance.auto=false',
    'credential.helper=', 'credential.interactive=false', 'protocol.allow=never',
  ];
  const commonArgs = ['--no-pager', ...settings.flatMap(setting => ['-c', setting])];
  const securityArgs = row.args[0] === 'diff' || row.args[0] === 'show' ? ['--no-ext-diff', '--no-textconv'] : [];
  return {
    id: row.id, executable: TOOLS.git, executableSha256: HASHES.git,
    semanticArgs: [...row.args], commonArgs, securityArgs,
    args: [...commonArgs, row.args[0], ...securityArgs, ...row.args.slice(1)], cwd: `${root}/repo`,
    env: {
      PATH: `${empty}/bin`, HOME: `${empty}/home`, XDG_CONFIG_HOME: `${empty}/xdg`,
      GIT_CONFIG_GLOBAL: `${empty}/global.config`, GIT_CONFIG_SYSTEM: `${empty}/system.config`,
      GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_COUNT: '0',
      GIT_CEILING_DIRECTORIES: root, GIT_DISCOVERY_ACROSS_FILESYSTEM: '0',
      GIT_EXEC_PATH: `${empty}/git-core`, GIT_ALLOW_PROTOCOL: '', GIT_PROTOCOL_FROM_USER: '0',
      LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TMPDIR: `${root}/tmp`, TMP: `${root}/tmp`, TEMP: `${root}/tmp`,
    },
    timeoutMs: 10000, maxOutputBytes: 65536, observeSockets: false, ipc: false,
    stdout: `${root}/capture/stdout.bin`, stderr: `${root}/capture/stderr.bin`,
    stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: false,
  };
}
export function admitRecipe(recipe, records) {
  const cwd = ownValue(recipe, 'cwd'), id = ownValue(recipe, 'id');
  need(typeof cwd === 'string' && cwd.endsWith('/repo'), 'root/cwd binding');
  const row = records.workflows.find(item => item.id === id);
  need(row, 'no extra version workflow');
  exact(recipe, nativeRecipe(cwd.slice(0, -5), row), 'original security/semantic recipe');
  return row;
}
