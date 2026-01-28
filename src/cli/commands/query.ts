import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { DEFAULT_FRONTIER_MODEL } from "../constants.js";
import {
  createExecutionResources,
  resolveCommandFlags
} from "./shared.js";
import { loadCredentials } from "../../services/credentials.js";

export interface RegisterQueryCommandOptions {
  defaultModel?: string;
}

export function registerQueryCommand(
  program: Command,
  container: CliContainer,
  options: RegisterQueryCommandOptions = {}
): void {
  program
    .command("query")
    .description("Query an LLM via Poe API directly.")
    .option("--model <model>", "Model identifier", options.defaultModel ?? DEFAULT_FRONTIER_MODEL)
    .option("--system <prompt>", "System prompt")
    .argument("[prompt]", "User prompt (if not provided, reads from stdin)")
    .action(async function (
      this: Command,
      promptArg?: string
    ) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        "query"
      );
      const commandOptions = this.opts<{ model?: string; system?: string }>();
      const model = commandOptions.model ?? options.defaultModel ?? DEFAULT_FRONTIER_MODEL;
      const systemPrompt = commandOptions.system;

      // Get prompt from argument or stdin
      let prompt = promptArg;
      if (!prompt) {
        // Check if stdin is being piped (not a TTY)
        if (!process.stdin.isTTY) {
          // Read from stdin
          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          prompt = Buffer.concat(chunks).toString("utf8").trim();
        }
      }

      if (!prompt) {
        throw new Error("No prompt provided via argument or stdin");
      }

      if (flags.dryRun) {
        resources.logger.dryRun(
          `Dry run: would query model ${model} with prompt (${prompt.length} chars)`
        );
        if (systemPrompt) {
          resources.logger.dryRun(`System prompt: ${systemPrompt}`);
        }
        return;
      }

      const apiKey = await loadCredentials({
        fs: container.fs,
        filePath: container.env.credentialsPath
      });
      if (!apiKey) {
        throw new Error("Poe API key not found. Run 'poe-code login' first.");
      }

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const res = await fetch(
        `${container.env.poeApiBaseUrl}/chat/completions`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, messages })
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Poe API error (${res.status}): ${errorText}`);
      }

      const chat = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const response = chat.choices?.[0]?.message?.content;
      if (!response) {
        throw new Error("No response from LLM");
      }

      // Output to stdout (no logger prefix)
      process.stdout.write(response);
      if (!response.endsWith("\n")) {
        process.stdout.write("\n");
      }
    });
}
