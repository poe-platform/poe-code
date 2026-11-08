#!/usr/bin/env node

const fs = require("node:fs");

const outputPath = readEnv("GITHUB_OUTPUT");
const labels = parseLabels(process.env.ISSUE_LABELS);

const DEFAULT_SERVICES = ["claude-code", "codex", "opencode"];
const SERVICE_SET = new Set(DEFAULT_SERVICES);
const AGENT_PREFIX = "agent:";
const MENU_LABEL = "poe-code";

let selectedService = DEFAULT_SERVICES[0];
let selectedLabel = "";

for (const label of labels) {
  const name = toLabelName(label);
  if (name.startsWith(AGENT_PREFIX)) {
    const candidate = name.slice(AGENT_PREFIX.length);
    if (!SERVICE_SET.has(candidate)) {
      fail(`Unsupported agent label: ${name}`);
    }
    selectedService = candidate;
    selectedLabel = name;
    break;
  }
}

const menuRequested = labels.some(
  (label) => toLabelName(label) === MENU_LABEL
);
const modelOverride = extractModelOverride(labels);

const outputs = [
  `service=${selectedService}`,
  `default_service=${DEFAULT_SERVICES[0]}`,
  `services=${DEFAULT_SERVICES.join(",")}`,
  `selected_label=${selectedLabel}`,
  `menu_label=${menuRequested ? "true" : "false"}`,
  `model=${modelOverride ?? ""}`
];

appendWorkflowOutput(outputPath, `${outputs.join("\n")}\n`);

function appendWorkflowOutput(path, content, fileSystem = fs) {
  assertNotSymbolicLink(path, fileSystem);
  fileSystem.appendFileSync(path, content);
}

function assertNotSymbolicLink(path, fileSystem) {
  try {
    if (fileSystem.lstatSync(path).isSymbolicLink()) {
      throw new Error(`Refusing to use symbolic link path: ${path}`);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function readEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(`Missing ${name} environment variable.`);
  }
  return value;
}

function parseLabels(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    fail(`Failed to parse labels: ${error.message}`);
  }
}

function toLabelName(label) {
  if (!label) {
    return "";
  }
  const name = typeof label.name === "string" ? label.name : "";
  return name.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function extractModelOverride(foundLabels) {
  for (const label of foundLabels) {
    const name = toLabelName(label);
    const normalized = name.toLowerCase();
    if (normalized.startsWith("model:")) {
      const value = name.slice(name.indexOf(":") + 1).trim();
      if (value) {
        return value;
      }
    }
  }
  return null;
}

module.exports = { appendWorkflowOutput };
