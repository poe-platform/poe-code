import { Shell, MemoryFileSystem, agentCommands, createLlmService as rootService, llmCommands as rootPlugin, createOpenAiProvider as rootOpenAi, createElevenLabsProvider as rootElevenLabs } from "@poe-platform/safe-bash";
import { llmCommands, createLlmService } from "@poe-platform/safe-bash/commands/llm";
import { createOpenAiProvider, createElevenLabsProvider } from "@poe-platform/safe-bash/commands/llm/providers";

export async function verifyLlmCommands() {
  const service = createLlmService({ defaultModel: "echo", providers: [{ name: "test", models: [{ id: "echo" }], async *complete(request) { yield request.prompt; } }] });
  const chunks = [];
  for await (const chunk of service.complete({ prompt: "structured", attachments: [], options: {}, signal: new AbortController().signal })) chunks.push(chunk);
  if (chunks.length !== 1 || chunks[0] !== "structured") throw new Error("LLM structured service adds shell formatting");
  if (rootService !== createLlmService || rootPlugin !== llmCommands || rootOpenAi !== createOpenAiProvider || rootElevenLabs !== createElevenLabsProvider) throw new Error("LLM root/subpath identity mismatch");
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands()).use(llmCommands({
    defaultModel: "text", providers: [
      { name: "first", models: [{ id: "text" }], async *complete(request) { yield request.prompt; } },
      { name: "second", models: [{ id: "audio", aliases: ["sound"], outputType: "audio/mpeg" }], async *complete() { yield new Uint8Array([0, 255, 13, 10]); } },
    ],
  }));
  try {
    const text = await shell.exec("printf hello | llm | cat");
    if (text.exitCode !== 0 || text.stdout !== "hello\n") throw new Error(`LLM text pipeline: ${text.stderr}`);
    const binary = await shell.exec("llm -m sound generate | cat");
    if (binary.exitCode !== 0 || binary.stdoutBytes.length !== 4 || binary.stdoutBytes.some((byte, index) => byte !== [0, 255, 13, 10][index])) throw new Error("LLM binary pipeline corrupted bytes");
  } finally { await shell.dispose(); }
}
