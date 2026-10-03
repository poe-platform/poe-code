import type {FileSystem} from '@poe-code/safe-fs';
export type SkillRuntimeOptions = {
  fs: FileSystem;
  cwd: string;
  homeDir: string;
  signal?: AbortSignal;
};
export interface DiscoveredSkill {
  name: string;
  file: string;
  content: string;
}
export declare function discoverSkillsAsync(
  directories: readonly string[],
  options: SkillRuntimeOptions & {nativePaths?: boolean}
): Promise<DiscoveredSkill[]>;
