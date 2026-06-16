export interface CliSettings {
  apiKeyHelper?: string;
  env?: Record<string, string | number>;
  [key: string]: unknown;
}

export interface ExtractedSettings {
  userSettings: CliSettings | null;
  settingsFilePath?: string;
  argsWithoutSettings: string[];
}

/**
 * Extracts --settings from args, returning parsed settings and remaining args
 */
export function extractSettingsFromArgs(args: string[]): ExtractedSettings {
  const settingsIdx = args.indexOf("--settings");

  if (settingsIdx === -1 || settingsIdx >= args.length - 1) {
    return { userSettings: null, argsWithoutSettings: args };
  }

  const settingsValue = args[settingsIdx + 1];
  const argsWithoutSettings = [
    ...args.slice(0, settingsIdx),
    ...args.slice(settingsIdx + 2)
  ];

  // JSON string
  if (settingsValue.startsWith("{")) {
    return {
      userSettings: JSON.parse(settingsValue),
      argsWithoutSettings
    };
  }

  // File path - return path for caller to handle
  return {
    userSettings: null,
    settingsFilePath: settingsValue,
    argsWithoutSettings
  };
}

/**
 * Deep merges settings, with required settings taking precedence
 */
export function mergeCliSettings(
  userSettings: CliSettings | null,
  requiredSettings: CliSettings
): CliSettings {
  if (!userSettings) {
    return requiredSettings;
  }

  const merged: CliSettings = {
    ...userSettings,
    ...requiredSettings
  };

  // Deep merge env if both have it
  if (userSettings.env || requiredSettings.env) {
    merged.env = {
      ...(userSettings.env ?? {}),
      ...(requiredSettings.env ?? {})
    };
  }

  return merged;
}

/**
 * Builds final args array with merged --settings
 */
export function buildArgsWithMergedSettings(
  args: string[],
  requiredSettings: CliSettings
): string[] {
  const { userSettings, settingsFilePath, argsWithoutSettings } =
    extractSettingsFromArgs(args);
  if (settingsFilePath) {
    throw new Error(
      `Cannot merge provider-required settings with --settings file path ${settingsFilePath}. Pass settings as inline JSON or remove --settings.`
    );
  }

  const merged = mergeCliSettings(userSettings, requiredSettings);

  return [...argsWithoutSettings, "--settings", JSON.stringify(merged)];
}
