type StringProperty = {
  type: "string";
  description: string;
  enum?: string[];
};

type ObjectSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, StringProperty>;
  required: string[];
};

export type BuilderToolDefinition = {
  name: "builder_run";
  description: string;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
};

export type InspectorToolDefinition = {
  name: "inspector_run";
  description: string;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
};

export type BuilderRunInput = {
  prompt: string;
};

export type InspectorRunInput = {
  name: string;
  prompt?: string;
};

export const builderRunOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "Builder summary."
    },
    log: {
      type: "string",
      description: "Builder log text."
    },
    log_path: {
      type: "string",
      description: "Path to the builder session log."
    }
  },
  required: ["summary", "log", "log_path"]
} satisfies ObjectSchema;

export const inspectorRunOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "Inspector name."
    },
    summary: {
      type: "string",
      description: "Inspector summary."
    },
    log_path: {
      type: "string",
      description: "Path to the inspector session log."
    }
  },
  required: ["name", "summary"]
} satisfies ObjectSchema;

export function createBuilderTool(): BuilderToolDefinition {
  return {
    name: "builder_run",
    description:
      "Run the builder agent with a prompt you compose. Returns the builder's summary and the path to its session log. Use this to make targeted changes mid-round without waiting for the next auto-run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          description:
            "Full prompt for the builder. Replaces the frontmatter `builder.prompt` template for this call only."
        }
      },
      required: ["prompt"]
    },
    outputSchema: builderRunOutputSchema
  };
}

export function createInspectorTool(inspectorNames: string[]): InspectorToolDefinition {
  const namesAvailable = inspectorNames.length > 0;

  return {
    name: "inspector_run",
    description: namesAvailable
      ? `Re-run a specific inspector. Returns the inspector's summary. Available inspectors: ${inspectorNames.join(", ")}.`
      : "Re-run a specific inspector. No inspectors are configured for this document.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          description: "Name of the inspector to run, as defined under `inspectors:` in the frontmatter.",
          ...(namesAvailable ? { enum: inspectorNames } : {})
        },
        prompt: {
          type: "string",
          description:
            "Optional prompt that replaces the inspector's frontmatter `prompt` template for this call only. Omit to use the configured prompt."
        }
      },
      required: ["name"]
    },
    outputSchema: inspectorRunOutputSchema
  };
}

export function parseBuilderRunInput(input: unknown): BuilderRunInput {
  if (!isRecord(input)) {
    throw new Error("builder_run requires an object input with a `prompt` field");
  }

  const prompt = input.prompt;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("builder_run `prompt` must be a non-empty string");
  }

  return { prompt };
}

export function parseInspectorRunInput(
  input: unknown,
  inspectorNames: string[]
): InspectorRunInput {
  if (!isRecord(input)) {
    throw new Error("inspector_run requires an object input with a `name` field");
  }

  const name = input.name;

  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("inspector_run `name` must be a non-empty string");
  }

  if (inspectorNames.length > 0 && !inspectorNames.includes(name)) {
    throw new Error(
      `inspector_run name "${name}" is not configured. Available inspectors: ${inspectorNames.join(", ")}`
    );
  }

  if (input.prompt === undefined) {
    return { name };
  }

  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0) {
    throw new Error("inspector_run `prompt` must be a non-empty string when provided");
  }

  return { name, prompt: input.prompt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
