export type {RunHandle,RunResult,RunSpec,Runner,HostRunnerOptions,ExecutionEnvFactory,ExecutionEnvType,OpenedEnv,OpenSpec,JobHandle,JobStatus,LogChunk,ExecutionState,TemplateEntry,UploadResult,DownloadResult}from'./types.js';
import type {HostRunnerOptions,Runner,ExecutionEnvFactory}from'./types.js';
export function createHostRunner(options?:HostRunnerOptions):Runner;
export const hostExecutionEnvFactory:ExecutionEnvFactory;
