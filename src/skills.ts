import { createNodeFsBridge, getNodeFsBridgeProvider, type FileSystem } from "@poe-code/safe-fs";
import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  installSkill as installAgentSkill,
  type InstallSkillResult,
  type SkillScope
} from "@poe-code/agent-skill-config";

export interface InstallSkillFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm?(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  copyFile?(src: string, dest: string): Promise<void>;
  chmod?(path: string, mode: number): Promise<void>;
}

export type InstallSkillSource =
  | {
      name: string;
      content: string;
    }
  | {
      name: string;
      file: string;
    };

export interface InstallSkillOptions {
  cwd?: string;
  homeDir?: string;
  scope?: SkillScope;
  dryRun?: boolean;
  fs?: InstallSkillFileSystem | FileSystem;
  signal?: AbortSignal;
}

function createNodeFileSystem(): InstallSkillFileSystem {
  return {
    readFile: ((filePath: string, encoding?: BufferEncoding) => {
      if (encoding) {
        return fs.readFile(filePath, encoding);
      }
      return fs.readFile(filePath);
    }) as InstallSkillFileSystem["readFile"],
    symlink: (target, filePath) => fs.symlink(target, filePath),
    readlink: (filePath) => fs.readlink(filePath, { encoding: "utf8" }),
    realpath: (filePath) => fs.realpath(filePath),
    writeFile: (filePath, data, options) => fs.writeFile(filePath, data, options),
    mkdir: (filePath, options) => fs.mkdir(filePath, options).then(() => {}),
    stat: (filePath) => fs.stat(filePath),
    lstat: (filePath) => fs.lstat(filePath),
    rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
    rm: (filePath, options) => fs.rm(filePath, options),
    unlink: (filePath) => fs.unlink(filePath),
    readdir: (filePath) => fs.readdir(filePath),
    copyFile: (src, dest) => fs.copyFile(src, dest),
    chmod: (filePath, mode) => fs.chmod(filePath, mode)
  };
}

async function resolveSkillContent(
  source: InstallSkillSource,
  options: { cwd: string; fs: InstallSkillFileSystem }
): Promise<string> {
  if ("content" in source) {
    return source.content;
  }

  const paths = getNodeFsBridgeProvider(options.fs) ? path.posix : path;
  const sourcePath = paths.isAbsolute(source.file)
    ? source.file
    : paths.resolve(options.cwd, source.file);
  return options.fs.readFile(sourcePath, "utf8");
}

/**
 * Install arbitrary skill content into an agent's native skill directory.
 *
 * The actual mutation and validation are delegated to poe-code's agent skill
 * configuration machinery, so SDK and CLI installs share the same safety rules.
 */
export async function installSkill(
  agentId: string,
  source: InstallSkillSource,
  options: InstallSkillOptions = {}
): Promise<InstallSkillResult> {
  const canonical = options.fs && "capabilities" in options.fs ? options.fs : undefined;
  const cwd = canonical ? path.posix.resolve("/", options.cwd ?? "/") : options.cwd ?? process.cwd();
  const homeDir = canonical ? path.posix.resolve(cwd, options.homeDir ?? "/") : options.homeDir ?? os.homedir();
  const fileSystem: InstallSkillFileSystem = options.fs && "capabilities" in options.fs
    ? createNodeFsBridge(options.fs, { cwd, root: "/", signal: options.signal })
    : options.fs ?? createNodeFileSystem();
  options.signal?.throwIfAborted();
  const content = await resolveSkillContent(source, { cwd, fs: fileSystem });

  return installAgentSkill(
    agentId,
    {
      name: source.name,
      content
    },
    {
      fs: fileSystem,
      paths: canonical || getNodeFsBridgeProvider(fileSystem) ? path.posix : path,
      cwd,
      homeDir,
      scope: options.scope ?? "local",
      dryRun: options.dryRun
    }
  );
}

export type { InstallSkillResult, SkillScope };

export { resolveSkillReferenceAsync, bridgeActiveSkillsAsync, cleanupBridgedSkillsAsync } from "@poe-code/agent-skill-config";
export type { SkillRuntimeOptions, SkillResolution, BridgeManifest } from "@poe-code/agent-skill-config";
