import { Shell, standardCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { commandRuntimeIdentity } from "@poe-platform/safe-bash/contracts";
import { createFfmpegCommands, ffmpegCommands, cloudflareWorkerLimits } from "@poe-platform/safe-bash/commands/ffmpeg";

export async function verifyFfmpeg() {
  for (const command of createFfmpegCommands()) {
    if (command.runtimeIdentity !== commandRuntimeIdentity) throw new Error("Media command contract identity diverged");
  }
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands()).use(ffmpegCommands({ limits: cloudflareWorkerLimits() }));
  try {
    const generated = await shell.exec("ffmpeg -f lavfi -i color=c=red:s=16x16:r=2:d=1 -an /clip.mp4");
    if (generated.exitCode !== 0) throw new Error(generated.stderr);
    await fs.writeFile("/probe.sh", new TextEncoder().encode("cat /clip.mp4 | ffprobe -v quiet -show_streams -show_format -of json pipe:0"));
    const result = await shell.exec("sh /probe.sh");
    if (result.exitCode !== 0) throw new Error(result.stderr);
    const probe = JSON.parse(result.stdout);
    if (probe.streams[0].width !== 16 || probe.streams[0].height !== 16) throw new Error("Packed media probe failed");
    const extracted = await shell.exec("ffmpeg -i /clip.mp4 -frames:v 1 /frame.png");
    if (extracted.exitCode !== 0) throw new Error(extracted.stderr);
    if ((await fs.readFile("/frame.png"))[0] !== 137) throw new Error("Packed PNG encoder failed");
    const audio = await shell.exec("ffmpeg -f lavfi -i sine=frequency=440:sample_rate=8000:duration=0.01 /audio.wav");
    if (audio.exitCode !== 0) throw new Error(audio.stderr);
    const audioResult = await shell.exec("ffprobe -v quiet -select_streams a:0 -show_streams -show_format -of json -i /audio.wav");
    if (audioResult.exitCode !== 0) throw new Error(audioResult.stderr);
    const audioProbe = JSON.parse(audioResult.stdout);
    if (audioProbe.streams.length !== 1 || audioProbe.streams[0].codec_type !== "audio" || Number(audioProbe.streams[0].sample_rate) !== 8000) throw new Error("Shared audio/media ffprobe surface failed");
    let collision = false;
    try { ffmpegCommands().setup({ commands: shell.commands }); } catch { collision = true; }
    if (!collision) throw new Error("Duplicate media registration was accepted");
    shell.use(ffmpegCommands({ replace: true, limits: { maxInputBytes: 1 } }));
    if ((await shell.exec("ffprobe /clip.mp4")).exitCode === 0) throw new Error("Media input budget was not enforced");
  } finally { await shell.dispose(); }
}
