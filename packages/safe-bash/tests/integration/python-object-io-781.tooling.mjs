import { resolve } from 'node:path';

export function selectObjectIo781WorkerdLauncher(tooling, official, configured = official) {
  if (configured === official) return { executable: official, mode: 'official-installed-binary' };
  if (configured === resolve(tooling, 'workerd-local.sh')) return { executable: configured, mode: 'explicit-tooling-wrapper' };
  throw new Error('Unrecognized workerd launcher; use the official installed binary or explicit tooling/workerd-local.sh');
}
