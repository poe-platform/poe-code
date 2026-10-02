import type { FileSystem } from "@poe-code/safe-fs/contracts";
import type {DownloadResult,UploadResult} from "./types.js";
export type {DownloadResult,UploadResult} from "./types.js";
export interface WorkspaceTransferDirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink?(): boolean;
}
export interface WorkspaceTransferStats {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink?(): boolean;
    size: number;
}
export interface WorkspaceTransferFileSystem {
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readdir(path: string, options: {
        withFileTypes: true;
    }): Promise<WorkspaceTransferDirent[]>;
    readFile(path: string): Promise<Uint8Array>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    writeFile(path: string, data: string | Uint8Array, options?: {
        flag?: string;
        mode?: number;
    }): Promise<void>;
    stat(path: string): Promise<WorkspaceTransferStats>;
    lstat?(path: string): Promise<WorkspaceTransferStats>;
    rename?(oldPath: string, newPath: string): Promise<void>;
    rm?(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    unlink?(path: string): Promise<void>;
    rmdir?(path: string): Promise<void>;
}
export interface WorkspaceTransferEnv {
    cwd: string;
    uploadDir: string;
    workspaceDir?: string;
    fs?: WorkspaceTransferFileSystem | FileSystem;
    remoteFs?: WorkspaceTransferFileSystem | FileSystem;
}
export interface WorkspaceTransferOptions {
    runner?: WorkspaceTransferRunnerOptions;
    uploadMaxFileMb?: number;
    workspaceExclude?: string[];
    warn?: (message: string) => void;
}
export interface WorkspaceTransferRunnerOptions {
    upload_max_file_mb?: number;
    workspace?: {
        exclude?: string[];
    };
}
export interface WorkspaceDownloadOptions {
    conflictPolicy: "refuse" | "overwrite";
}
export function uploadWorkspace(env:WorkspaceTransferEnv,opts:WorkspaceTransferOptions):Promise<UploadResult>;
export function downloadWorkspace(env:WorkspaceTransferEnv,opts:WorkspaceDownloadOptions):Promise<DownloadResult>;
