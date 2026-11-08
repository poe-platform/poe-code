import type {DockerMount,Engine,ExecutionState,Runner}from'./types.js';
interface DockerRuntime {
    type: "docker";
    image?: string;
    dockerfile?: string;
    build_context?: string;
    build_args?: Record<string, string>;
    mounts?: DockerMount[];
    engine?: Engine;
    network?: string;
    extra_args?: string[];
}
export interface BuildDockerRuntimeTemplateInput {
    cwd: string;
    runtime: DockerRuntime;
    state?: ExecutionState;
    runner?: Runner;
    force?: boolean;
}
export interface BuildDockerRuntimeTemplateResult {
    backend: "docker";
    hash: string;
    image: string;
    cached: boolean;
}
export declare function buildDockerRuntimeTemplate(input:BuildDockerRuntimeTemplateInput):Promise<BuildDockerRuntimeTemplateResult>;
