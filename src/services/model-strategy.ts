import { randomUUID } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  DEFAULT_CLAUDE_CODE_MODEL,
  DEFAULT_CODEX_MODEL
} from "../cli/constants.js";
import { hasOwnErrorCode } from "../utils/error-codes.js";

const CLAUDE_DEFAULT_MODEL = DEFAULT_CLAUDE_CODE_MODEL;

/**
 * Available model identifiers
 */
export const AVAILABLE_MODELS = Object.freeze([
  CLAUDE_DEFAULT_MODEL,
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-chat",
  "gpt-5.4-pro",
  "gpt-4o",
  "Claude-3.5-Sonnet",
  DEFAULT_CODEX_MODEL,
] as const);

export type ModelIdentifier = (typeof AVAILABLE_MODELS)[number];

/**
 * Strategy types for model selection
 */
export type StrategyType = "mixed" | "smart" | "fixed" | "round-robin";

/**
 * Configuration for model strategy
 */
export interface StrategyConfig {
  type: StrategyType;
  fixedModel?: ModelIdentifier;
  customOrder?: ModelIdentifier[];
}

/**
 * Base interface for all model strategies
 */
export interface ModelStrategy {
  getNextModel(context?: ModelContext): ModelIdentifier;
  getName(): string;
  getDescription(): string;
  reset(): void;
}

/**
 * Context for smart model selection
 */
export interface ModelContext {
  messageType?: "code" | "chat" | "reasoning" | "general";
  complexity?: "simple" | "medium" | "complex";
  previousModel?: string;
}

/**
 * Mixed strategy: alternates between gpt-5.5 and the default Claude model
 */
export class MixedStrategy implements ModelStrategy {
  private currentIndex = 0;
  private models: ModelIdentifier[] = ["gpt-5.5", CLAUDE_DEFAULT_MODEL];

  getNextModel(): ModelIdentifier {
    const model = this.models[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.models.length;
    return model;
  }

  getName(): string {
    return "mixed";
  }

  getDescription(): string {
    return `Alternates between gpt-5.5 and ${CLAUDE_DEFAULT_MODEL} on each call`;
  }

  reset(): void {
    this.currentIndex = 0;
  }
}

/**
 * Smart strategy: selects model based on task type
 */
export class SmartStrategy implements ModelStrategy {
  private lastModel: ModelIdentifier = CLAUDE_DEFAULT_MODEL;

  getNextModel(context?: ModelContext): ModelIdentifier {
    if (!context) {
      return CLAUDE_DEFAULT_MODEL;
    }

    // Smart selection based on context
    if (context.messageType === "code" || context.messageType === "reasoning") {
      // Use gpt-5.5 for complex coding and reasoning tasks
      if (context.complexity === "complex") {
        this.lastModel = "gpt-5.5";
        return "gpt-5.5";
      }
      // Use Claude for medium complexity code
      this.lastModel = CLAUDE_DEFAULT_MODEL;
      return CLAUDE_DEFAULT_MODEL;
    }

    if (context.messageType === "chat") {
      // Use gpt-4o for general chat
      this.lastModel = "gpt-4o";
      return "gpt-4o";
    }

    // Default to Claude
    this.lastModel = CLAUDE_DEFAULT_MODEL;
    return CLAUDE_DEFAULT_MODEL;
  }

  getName(): string {
    return "smart";
  }

  getDescription(): string {
    return "Intelligently selects model based on task complexity and type";
  }

  reset(): void {
    this.lastModel = CLAUDE_DEFAULT_MODEL;
  }
}

/**
 * Fixed strategy: always uses the same model
 */
export class FixedStrategy implements ModelStrategy {
  constructor(private model: ModelIdentifier = CLAUDE_DEFAULT_MODEL) {}

  getNextModel(): ModelIdentifier {
    return this.model;
  }

  setModel(model: ModelIdentifier): void {
    this.model = model;
  }

  getName(): string {
    return "fixed";
  }

  getDescription(): string {
    return `Always uses ${this.model}`;
  }

  reset(): void {
    // No state to reset
  }
}

/**
 * Round-robin strategy: cycles through all available models
 */
export class RoundRobinStrategy implements ModelStrategy {
  private currentIndex = 0;
  private models: ModelIdentifier[];

  constructor(models?: ModelIdentifier[]) {
    if (models?.length === 0) {
      throw new Error("Round-robin custom order must include at least one model");
    }
    this.models = models ? [...models] : [...AVAILABLE_MODELS];
  }

  getNextModel(): ModelIdentifier {
    const model = this.models[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.models.length;
    return model;
  }

  getName(): string {
    return "round-robin";
  }

  getDescription(): string {
    return `Cycles through: ${this.models.join(", ")}`;
  }

  reset(): void {
    this.currentIndex = 0;
  }
}

/**
 * Factory for creating model strategies
 */
export class ModelStrategyFactory {
  static createStrategy(config: StrategyConfig): ModelStrategy {
    switch (config.type) {
      case "mixed":
        return new MixedStrategy();
      case "smart":
        return new SmartStrategy();
      case "fixed":
        return new FixedStrategy(config.fixedModel);
      case "round-robin":
        return new RoundRobinStrategy(config.customOrder);
      default:
        return new MixedStrategy();
    }
  }

  static getAvailableStrategies(): Array<{
    type: StrategyType;
    description: string;
  }> {
    return [
      {
        type: "mixed",
        description: `Alternate between gpt-5.5 and ${CLAUDE_DEFAULT_MODEL}`
      },
      { type: "smart", description: "Intelligently select based on task type" },
      { type: "fixed", description: "Always use the same model" },
      { type: "round-robin", description: "Cycle through all available models" },
    ];
  }
}

/**
 * Manager for persisting and loading strategy configuration
 */
export class StrategyConfigManager {
  private static CONFIG_DIR = path.join(os.homedir(), ".poe-code");
  private static CONFIG_FILE = path.join(
    StrategyConfigManager.CONFIG_DIR,
    "strategy-config.json"
  );

  static saveConfig(config: StrategyConfig): void {
    if (!isStrategyConfig(config)) {
      throw new Error("Invalid model strategy configuration");
    }
    this.assertSafeStatePath();
    if (!fs.existsSync(this.CONFIG_DIR)) {
      fs.mkdirSync(this.CONFIG_DIR, { recursive: true });
    }
    this.assertSafeStatePath();
    const temporaryFile = `${this.CONFIG_FILE}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(config, null, 2), { flag: "wx" });
      temporaryCreated = true;
      fs.renameSync(temporaryFile, this.CONFIG_FILE);
      temporaryCreated = false;
    } catch (error) {
      if (temporaryCreated || !isAlreadyExists(error)) {
        tryUnlinkSync(temporaryFile);
      }
      throw error;
    }
  }

  static loadConfig(): StrategyConfig | null {
    try {
      this.assertSafeStatePath();
      if (fs.existsSync(this.CONFIG_FILE)) {
        const data = fs.readFileSync(this.CONFIG_FILE, "utf-8");
        const config: unknown = JSON.parse(data);
        return isStrategyConfig(config) ? config : null;
      }
    } catch (error) {
      console.error("Failed to load strategy config:", error);
    }
    return null;
  }

  static getDefaultConfig(): StrategyConfig {
    return {
      type: "fixed",
      fixedModel: CLAUDE_DEFAULT_MODEL,
    };
  }

  private static assertSafeStatePath(): void {
    for (const candidate of [this.CONFIG_DIR, this.CONFIG_FILE]) {
      if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Strategy config path cannot be a symbolic link: ${candidate}`);
      }
    }
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}

function tryUnlinkSync(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    return;
  }
}

function isStrategyConfig(value: unknown): value is StrategyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const config = value as Record<string, unknown>;
  if (!isStrategyType(config.type)) {
    return false;
  }

  if (config.fixedModel !== undefined && !isModelIdentifier(config.fixedModel)) {
    return false;
  }

  if (config.customOrder !== undefined) {
    if (
      !Array.isArray(config.customOrder) ||
      config.customOrder.length === 0 ||
      !config.customOrder.every(isModelIdentifier)
    ) {
      return false;
    }
  }

  return true;
}

function isStrategyType(value: unknown): value is StrategyType {
  return value === "mixed" || value === "smart" || value === "fixed" || value === "round-robin";
}

function isModelIdentifier(value: unknown): value is ModelIdentifier {
  return typeof value === "string" && (AVAILABLE_MODELS as readonly string[]).includes(value);
}
