import * as native from "toolcraft-rust/process-runner";
import * as reference from "toolcraft/process-runner";
const own: typeof reference = native;
const original: typeof native = reference;
const spec: native.RunSpec = {command: "node", args: ["--version"], stdin: "pipe", killProcessGroup: true};
const originalSpec: reference.RunSpec = spec;
const runner: native.Runner = native.createHostRunner({detached: false});
const handle: native.RunHandle = runner.exec(spec);
const result: Promise<native.RunResult> = handle.result;
const factory: native.ExecutionEnvFactory = native.hostExecutionEnvFactory;
const options: native.OpenSpec = {cwd: "/work", runtime: {type: "host"}, env: {}, uploadIgnoreFiles: [], jobLabel: {tool: "test", argv: []}, execution: {captureStdout: false, onStdout(chunk) { const text: string = chunk; void text; }}};
const originalOptions: reference.OpenSpec = options;
const environment: Promise<native.OpenedEnv> = factory.open(options);
const docker: native.DockerRunnerOptions = {image: "node:22", engine: "podman", ports: [{host: 8080, container: 80, protocol: "tcp"}]};
const mock: native.MockRunBehavior = {exitCode: 0, stdout: ["hello"]};
const files: Promise<native.DockerBuildContextFile[]> = native.readDockerBuildContextFiles("/work");
declare const transfer: native.WorkspaceTransferOptions;
const originalTransfer: reference.WorkspaceTransferOptions = transfer;
declare const job: native.JobHandle;
const status: Promise<native.JobStatus> = job.status({signal: new AbortController().signal});
const chunks: AsyncIterable<native.LogChunk> = job.stream({follow: false, sinceByte: 0});
// @ts-expect-error engine is a closed union
native.buildContextArgs("other", null);
// @ts-expect-error dependency-only build input alias is not a Toolcraft export
type Extra = native.BuildDockerRuntimeTemplateInput;
void [own, original, originalSpec, result, originalOptions, environment, docker, mock, files, originalTransfer, status, chunks];
export type {Extra};
