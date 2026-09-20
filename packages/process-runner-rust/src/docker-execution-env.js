import {setTimeout as sleep}from'node:timers/promises';
import {native} from './native.js';
import {buildDockerRuntimeTemplate} from './docker-template.js';
export {buildDockerRuntimeTemplate} from './docker-template.js';
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDockerRunArgs } from "./docker-args.js";
import { buildContextArgs, detectContext } from "./docker-context.js";
import { detectEngine } from "./docker-engine.js";
import { createDockerEnvFile } from "./docker-env-file.js";
import { createHostRunner } from "./host-runner.js";
import { downloadWorkspace as downloadTransferredWorkspace, uploadWorkspace as uploadTransferredWorkspace } from "./workspace-transfer.js";
const containerCommand = ["sh", "-c", "while :; do sleep 3600; done"];
export const dockerExecutionEnvFactory = {
    type: "docker",
    supportsDetach: true,
    supportsWorkspaceTransfer: true,
    async open(spec) {
        const runtime = parseDockerRuntime(spec.runtime);
        const runner = spec.hostRunner ?? createHostRunner();
        const engine = runtime.engine ?? detectEngine();
        const context = detectContext();
        const image = await resolveImage({
            spec,
            runtime,
            runner,
            engine,
            context
        });
        const containerName = createContainerName();
        const runArgs = buildDockerRunArgs({
            engine,
            context,
            image,
            command: containerCommand[0],
            args: containerCommand.slice(1),
            cwd: undefined,
            env: undefined,
            mounts: runtime.mounts ?? [],
            ports: [],
            network: runtime.network,
            containerName,
            detached: true,
            interactive: true,
            tty: false,
            rm: false,
            extraArgs: runtime.extra_args ?? []
        });
        const [command, ...args] = runArgs;
        const id = (await runAndRead(runner, { command, args, stdout: "pipe", stderr: "pipe" })).trim();
        return createDockerEnv({
            id,
            spec,
            runner,
            engine,
            context
        });
    },
    async attach(envId, context) {
        const reattachContext = parseDockerReattachContext(context?.reattachContext);
        const engine = reattachContext?.engine ?? detectEngine();
        return createDockerEnv({
            id: envId,
            spec: createAttachedSpec(context?.cwd),
            runner: createHostRunner(),
            engine,
            context: reattachContext === undefined ? detectContext() : reattachContext.context,
            attachedJobId: context?.jobId
        });
    }
};
function createDockerEnv(input) {
    const containerRef = input.id;
    const workspaceTransferEnv = {
        cwd: input.spec.cwd,
        uploadDir: "/tmp/poe-workspace-transfer",
        workspaceDir: input.spec.cwd,
        remoteFs: createContainerWorkspaceFileSystem(input)
    };
    let detachedJobContext = input.attachedJobId === undefined
        ? null
        : { id: input.attachedJobId, tool: input.spec.jobLabel.tool, argv: input.spec.jobLabel.argv };
    return {
        id: containerRef,
        reattachContext: { engine: input.engine, context: input.context },
        job: input.attachedJobId === undefined
            ? null
            : createContainerJob(containerRef, input.runner, input.engine, input.context, detachedJobContext),
        setDetachedJobContext(context) {
            detachedJobContext = context;
        },
        async uploadWorkspace() {
            if (readRunnerSync(input.spec.runner) === "none") {
                return { files: 0, bytes: 0, skipped: [] };
            }
            return uploadTransferredWorkspace(workspaceTransferEnv, {
                runner: readWorkspaceTransferRunner(input.spec.runner),
                workspaceExclude: input.spec.uploadIgnoreFiles
            });
        },
        async downloadWorkspace(opts) {
            const sync = readRunnerSync(input.spec.runner);
            if (sync === "upload" || sync === "none") {
                return { files: 0, bytes: 0, conflicts: [] };
            }
            return downloadTransferredWorkspace(workspaceTransferEnv, opts);
        },
        exec(spec) {
            const envFile = createDockerEnvFile(spec.env);
            try {
                return cleanUpEnvFileAfterRun(input.runner.exec({
                    command: input.engine,
                    args: native.dockerExecArgs({engine:input.engine,context:input.context??undefined,container:containerRef,interactive:spec.stdin==='pipe'||spec.stdin==='inherit',tty:spec.tty===true,cwd:spec.cwd,keys:Object.keys(spec.env??{}),envFile:envFile?.path,command:spec.command,args:spec.args??[]}),
                    stdin: spec.stdin,
                    stdout: spec.stdout,
                    stderr: spec.stderr,
                    tty: spec.tty,
                    signal: spec.signal,
                    killProcessGroup: spec.killProcessGroup
                }), envFile?.cleanup);
            }
            catch (error) {
                envFile?.cleanup();
                throw error;
            }
        },
        async detach() {
            return createContainerJob(containerRef, input.runner, input.engine, input.context, detachedJobContext);
        },
        shell() {
            const shellSpec = input.spec.shellSpec;
            return this.exec({
                command: shellSpec?.command ?? input.spec.env.SHELL ?? "sh",
                ...(shellSpec?.args ? { args: shellSpec.args } : {}),
                cwd: shellSpec?.cwd ?? input.spec.cwd,
                env: shellSpec && "env" in shellSpec ? shellSpec.env : input.spec.env,
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
                tty: true,
                signal: shellSpec?.signal
            });
        },
        async close() {
            await runAndRead(input.runner, {
                command: input.engine,
                args: new native.DockerJob(input.engine,input.context??undefined,containerRef).closeArgs(),
                stdout: "pipe",
                stderr: "pipe"
            });
        }
    };
}
function parseDockerReattachContext(value) {
    if (value !== undefined &&
        (value.engine === "docker" || value.engine === "podman") &&
        (value.context === null || typeof value.context === "string")) {
        return { engine: value.engine, context: value.context };
    }
    return undefined;
}
async function resolveImage(input) {
    if (input.runtime.image !== undefined) {
        return input.runtime.image;
    }
    const result = await buildDockerRuntimeTemplate({
        cwd: input.spec.cwd,
        runtime: input.runtime,
        state: input.spec.state,
        runner: input.runner
    });
    return result.image;
}
function parseDockerRuntime(runtime){const valid=!!runtime&&typeof runtime==='object'&&!Array.isArray(runtime);const type=valid?runtime.type:undefined;native.dockerRuntimeValidate(valid,typeof type==='string'?type:undefined);return runtime;}
async function runAndRead(runner, spec) {
    const handle = runner.exec(spec);
    const stdout = readStream(handle.stdout);
    const stderr = readStream(handle.stderr);
    const result = await handle.result;
    const output = await stdout;
    if (result.exitCode !== 0) {
        const errorOutput = await stderr;
        throw new Error(`Command failed with exit code ${result.exitCode}: ${spec.command} ${(spec.args ?? []).join(" ")}${errorOutput ? `\n${errorOutput}` : ""}`);
    }
    return output;
}
async function runJobRead(runner, spec) {
    spec.signal?.throwIfAborted();
    const controller = new AbortController();
    const signal = spec.signal
        ? AbortSignal.any([spec.signal, controller.signal])
        : controller.signal;
    const handle = runner.exec({ ...spec, signal });
    const reads = [handle.result, readStreamBytes(handle.stdout), readStream(handle.stderr)];
    try {
        const [result, stdout, stderr] = await Promise.all(reads);
        signal.throwIfAborted();
        return { exitCode: result.exitCode, stdout, stderr };
    }
    catch (error) {
        controller.abort();
        await Promise.allSettled(reads);
        throw error;
    }
}
function cleanUpEnvFileAfterRun(handle, cleanup) {
    if (cleanup === undefined) {
        return handle;
    }
    let cleanedUp = false;
    const cleanupOnce = () => {
        if (cleanedUp) {
            return;
        }
        cleanedUp = true;
        try {
            cleanup();
        }
        catch {
            // Cleanup is best effort; preserve the command result.
        }
    };
    return {
        pid: handle.pid,
        stdin: handle.stdin,
        stdout: handle.stdout,
        stderr: handle.stderr,
        result: handle.result.finally(cleanupOnce),
        kill: handle.kill.bind(handle)
    };
}
async function readStream(stream) {
    if (stream === null) {
        return "";
    }
    stream.setEncoding("utf8");
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(String(chunk));
    }
    return chunks.join("");
}
async function readStreamBytes(stream) {
    if (stream === null) {
        return Buffer.alloc(0);
    }
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
function createContainerName() {
    return `poe-env-${randomBytes(6).toString("hex")}`;
}
function readRunnerSync(runner) {
    if (typeof runner !== "object" || runner === null || !("sync" in runner)) {
        return undefined;
    }
    const sync = runner.sync;
    return sync === "both" || sync === "upload" || sync === "none" ? sync : undefined;
}
function readWorkspaceTransferRunner(runner) {
    if (typeof runner !== "object" || runner === null) {
        return undefined;
    }
    const record = runner;
    const uploadMaxFileMb = typeof record.upload_max_file_mb === "number" ? record.upload_max_file_mb : undefined;
    const workspace = typeof record.workspace === "object" && record.workspace !== null
        && Array.isArray(record.workspace.exclude)
        ? { exclude: record.workspace.exclude.filter((value) => typeof value === "string") }
        : undefined;
    return { ...(uploadMaxFileMb === undefined ? {} : { upload_max_file_mb: uploadMaxFileMb }), ...(workspace === undefined ? {} : { workspace }) };
}
function createContainerWorkspaceFileSystem(input) {
    const execShell = (command) => runAndRead(input.runner, {
        command: input.engine,
        args: [...buildContextArgs(input.engine, input.context), "exec", input.id, "sh", "-c", command],
        stdout: "pipe",
        stderr: "pipe"
    });
    async function readRemoteFile(targetPath) {
        const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-read-"));
        const destinationPath = path.join(tempDir, "content");
        try {
            await runAndRead(input.runner, {
                command: input.engine,
                args: [...buildContextArgs(input.engine, input.context), "cp", `${input.id}:${targetPath}`, destinationPath],
                stdout: "pipe",
                stderr: "pipe"
            });
            return await readFile(destinationPath);
        }
        finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    }
    async function readFileFromContainer(targetPath, encoding) {
        const contents = await readRemoteFile(targetPath);
        return encoding === undefined ? contents : contents.toString(encoding);
    }
    return {
        async mkdir(targetPath) {
            await execShell(`mkdir -p ${shellQuote(targetPath)}`);
        },
        async readdir(targetPath) {
            const quotedTargetPath = shellQuote(targetPath);
            const output = await execShell([
                `for item in ${quotedTargetPath}/* ${quotedTargetPath}/.[!.]* ${quotedTargetPath}/..?*; do`,
                `[ -e "$item" ] || [ -L "$item" ] || continue;`,
                `if [ -L "$item" ]; then kind=l; size=0;`,
                `elif [ -d "$item" ]; then kind=d; size=0;`,
                `elif [ -f "$item" ]; then kind=f; size=$(wc -c < "$item");`,
                `else continue; fi;`,
                `printf '%s\\t%s\\t%s\\n' "\${item##*/}" "$kind" "$size";`,
                `done`
            ].join(" "));
            return output.split("\n").filter(Boolean).map((line) => {
                const [name = "", kind = "f"] = line.split("\t");
                return {
                    name,
                    isFile: () => kind === "f",
                    isDirectory: () => kind === "d",
                    isSymbolicLink: () => kind === "l"
                };
            });
        },
        readFile: readFileFromContainer,
        async writeFile(targetPath, data) {
            const tempDir = mkdtempSync(path.join(tmpdir(), "poe-docker-write-"));
            const sourcePath = path.join(tempDir, "content");
            try {
                await writeFile(sourcePath, data);
                await runAndRead(input.runner, {
                    command: input.engine,
                    args: [...buildContextArgs(input.engine, input.context), "cp", sourcePath, `${input.id}:${targetPath}`],
                    stdout: "pipe",
                    stderr: "pipe"
                });
            }
            finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        },
        async stat(targetPath) {
            const output = await execShell(`if [ -d ${shellQuote(targetPath)} ]; then printf 'd\\t0'; elif [ -f ${shellQuote(targetPath)} ]; then printf 'f\\t'; wc -c < ${shellQuote(targetPath)}; else printf 'missing'; fi`);
            if (output.trim() === "missing") {
                throw Object.assign(new Error(`ENOENT: ${targetPath}`), { code: "ENOENT" });
            }
            const [kind = "f", rawSize = "0"] = output.trim().split("\t");
            return { size: Number(rawSize.trim()), isFile: () => kind === "f", isDirectory: () => kind === "d" };
        },
        async rename(oldPath, newPath) {
            await execShell(`mv ${shellQuote(oldPath)} ${shellQuote(newPath)}`);
        },
        async rm(targetPath) {
            await execShell(`rm -rf ${shellQuote(targetPath)}`);
        }
    };
}
function createAttachedSpec(cwd = "/workspace") {
    return {
        cwd,
        runtime: {
            type: "docker",
            image: "attached",
            build_args: {},
            mounts: []
        },
        env: {},
        uploadIgnoreFiles: [],
        jobLabel: {
            tool: "docker",
            argv: []
        }
    };
}
function shellQuote(value){return native.dockerShellQuote(value);}

function createContainerJob(containerId,runner,engine,context,detachedJobContext=null){
 const jobId=detachedJobContext?.id??containerId,job=new native.DockerJob(engine,context??undefined,containerId,detachedJobContext===null?undefined:jobId);
 async function state(signal){const result=await runJobRead(runner,{command:engine,args:job.statusArgs(),stdout:'pipe',stderr:'pipe',signal});const reply=job.status(result.exitCode,result.stdout.toString('utf8'));if(reply.error!==undefined)throw new Error(reply.error);return reply;}
 return{id:jobId,envId:containerId,tool:detachedJobContext?.tool??'docker',argv:detachedJobContext?.argv??['attach',containerId],
  async status(opts){return(await state(opts?.signal)).status;},
  async*stream(opts){let byteOffset=opts?.sinceByte??0,pendingBytes=Buffer.alloc(0),pendingByteOffset=byteOffset;const poll=new native.DockerLogPoll(opts?.follow===true,detachedJobContext!==null);
   for(;;){const spec={command:engine,args:job.logArgs(jobId,byteOffset,opts?.since?.getTime()),stdout:'pipe',stderr:'pipe',signal:opts?.signal},reply=await runJobRead(runner,spec);if(reply.exitCode!==0)throw new Error(`Command failed with exit code ${reply.exitCode}: ${engine} ${spec.args.join(' ')}${reply.stderr?'\n'+reply.stderr:''}`);
    if(reply.stdout.byteLength>0){const combined=pendingBytes.byteLength===0?reply.stdout:Buffer.concat([pendingBytes,reply.stdout]),completeLength=native.dockerCompleteUtf8Prefix(combined);byteOffset+=reply.stdout.byteLength;pendingBytes=combined.subarray(completeLength);const data=combined.subarray(0,completeLength).toString('utf8');if(data.length>0){yield{byteOffset:pendingByteOffset,data};pendingByteOffset+=completeLength;}}
    if(poll.afterRead()==='return')return;const action=poll.afterStatus(await this.status({signal:opts?.signal}));if(action==='read')continue;if(action==='return')return;await sleep(250,undefined,{signal:opts?.signal});
   }
  },
  async wait(){if(detachedJobContext!==null){for(;;){const reply=await state();if(reply.status==='exited')return{exitCode:reply.code};if(reply.status==='lost')return{exitCode:1};await new Promise(resolve=>setTimeout(resolve,25));}}
   const handle=runner.exec({command:engine,args:job.waitArgs(),stdout:'pipe',stderr:'pipe'}),stdout=await readStream(handle.stdout),result=await handle.result,reply=native.dockerWaitExitCode(stdout,result.exitCode);if(reply.error!==undefined)throw new Error(reply.error);return{exitCode:reply.code};
  },
  async kill(signal){await runAndRead(runner,{command:engine,args:job.killArgs(signal),stdout:'pipe',stderr:'pipe'});}
 };
}
