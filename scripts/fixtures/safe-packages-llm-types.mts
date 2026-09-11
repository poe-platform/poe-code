import { Shell, MemoryFileSystem, llmCommands, createLlmCommands, createOpenAiProvider, createElevenLabsProvider, type LlmCommandsOptions, type LlmProvider, type LlmRequest } from "@poe-platform/safe-bash";
import { llmCommands as subpathPlugin, createLlmCommands as subpathCommands } from "@poe-platform/safe-bash/commands/llm";
import { createOpenAiProvider as openAi, createElevenLabsProvider as elevenLabs, type OpenAiProviderOptions, type ElevenLabsProviderOptions, type LlmProviderLimits } from "@poe-platform/safe-bash/commands/llm/providers";

const provider: LlmProvider = {
  name: "injected", models: [{ id: "text", aliases: ["short"] }],
  async *complete(request: LlmRequest) { yield request.prompt; },
};
const options: LlmCommandsOptions = { providers: [provider], defaultModel: "short", replace: false };
const plugin: typeof llmCommands = subpathPlugin;
const commands: typeof createLlmCommands = subpathCommands;
const openAiFactory: typeof createOpenAiProvider = openAi;
const elevenLabsFactory: typeof createElevenLabsProvider = elevenLabs;
const limits: Partial<LlmProviderLimits> = { maxResponseBytes: 1024 };
const transport: OpenAiProviderOptions["transport"] = async () => { throw new Error("No network in the type fixture"); };
const openAiOptions: OpenAiProviderOptions = { transport, apiKey: "injected", models: [{ id: "chat", endpoint: "chat" }], limits };
const elevenLabsOptions: ElevenLabsProviderOptions = { transport, apiKey: "injected", models: [{ id: "voice", endpoint: "tts", defaultVoiceId: "voice-id", outputType: "audio/mpeg" }], limits };
const providers: readonly LlmProvider[] = [openAiFactory(openAiOptions), elevenLabsFactory(elevenLabsOptions)];
const shell = new Shell({ fs: new MemoryFileSystem() }).use(plugin(options));
void [shell, commands(options), providers];
