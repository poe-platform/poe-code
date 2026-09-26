import { Shell, CommandRegistry, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { createFfmpegCommand, createFfprobeCommand, createFfmpegCommands, ffmpegCommands, cloudflareWorkerLimits, type FfmpegCommandsOptions, type MediaAstPlugin } from "@poe-platform/safe-bash/commands/ffmpeg";

const options: FfmpegCommandsOptions = { limits: cloudflareWorkerLimits(), features: { videoTranscode: true } };
const asts: readonly MediaAstPlugin[] | undefined = options.asts;
const pair = createFfmpegCommands(options);
const shell = new Shell({ fs: createMemoryFileSystem(), commands: new CommandRegistry([createFfmpegCommand(options), createFfprobeCommand(options)]) });
shell.use(ffmpegCommands({ ...options, replace: true }));
void pair.ffmpeg;
void pair.ffprobe;
void asts;
