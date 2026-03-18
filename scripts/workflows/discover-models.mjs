#!/usr/bin/env node

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

const CHANGELOG_URL = "https://models.poecdn.net/changelog.json";
const RENAME_CHANGELOG_URL = "https://models.poecdn.net/test_changelog.json";
const RESOLVER_LABEL = "agent:claude-code";
const MODEL_LABEL = "model";
const TRACKING_LABELS = ["new-model", "removed-model", "renamed-model"];
const LABEL_DEFINITIONS = [
  {
    name: "new-model",
    color: "0E8A16",
    description: "Tracking issue for a model added in Poe changelog"
  },
  {
    name: "removed-model",
    color: "B60205",
    description: "Tracking issue for a model removed in Poe changelog"
  },
  {
    name: "renamed-model",
    color: "1D76DB",
    description: "Tracking issue for a model rename in Poe changelog"
  },
  {
    name: MODEL_LABEL,
    color: "5319E7",
    description: "Model discovery tracking issue"
  }
];
const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx"
]);

export function collectEvents(changelogFeed, renameFeed, options = {}) {
  const referenceDate = options.referenceDate ?? new Date();
  const startOfWeek = startOfCurrentWeekUtc(referenceDate);
  const added = [];
  const removed = [];
  const renamed = [];
  const addedSeen = new Set();
  const removedSeen = new Set();
  const renamedSeen = new Set();

  for (const entry of asArray(changelogFeed)) {
    if (!isEntryFromCurrentWeek(entry, startOfWeek)) {
      continue;
    }

    for (const value of asArray(entry?.added)) {
      const modelId = normalizeModelId(value);
      if (!modelId || addedSeen.has(modelId)) {
        continue;
      }
      addedSeen.add(modelId);
      added.push(modelId);
    }

    for (const value of asArray(entry?.removed)) {
      const modelId = normalizeModelId(value);
      if (!modelId || removedSeen.has(modelId)) {
        continue;
      }
      removedSeen.add(modelId);
      removed.push(modelId);
    }
  }

  for (const entry of asArray(renameFeed)) {
    if (!isEntryFromCurrentWeek(entry, startOfWeek)) {
      continue;
    }

    for (const candidate of asArray(entry?.renamed)) {
      const from = normalizeModelId(candidate?.from);
      const to = normalizeModelId(candidate?.to);
      if (!from || !to) {
        continue;
      }
      const key = `${from}->${to}`;
      if (renamedSeen.has(key)) {
        continue;
      }
      renamedSeen.add(key);
      renamed.push({ from, to });
    }
  }

  return { added, removed, renamed };
}

export function parseIssueKeyFromTitle(title) {
  if (typeof title !== "string") {
    return null;
  }
  const trimmed = title.trim();
  const lower = trimmed.toLowerCase();

  const addedPrefix = "new model:";
  if (lower.startsWith(addedPrefix)) {
    const modelId = normalizeModelId(trimmed.slice(addedPrefix.length));
    return modelId ? buildAddedKey(modelId) : null;
  }

  const removedPrefix = "removed model:";
  if (lower.startsWith(removedPrefix)) {
    const modelId = normalizeModelId(trimmed.slice(removedPrefix.length));
    return modelId ? buildRemovedKey(modelId) : null;
  }

  const renamedPrefix = "renamed model:";
  if (lower.startsWith(renamedPrefix)) {
    const remainder = trimmed.slice(renamedPrefix.length).trim();
    const separatorIndex = remainder.indexOf("->");
    if (separatorIndex <= 0) {
      return null;
    }
    const from = normalizeModelId(remainder.slice(0, separatorIndex));
    const to = normalizeModelId(remainder.slice(separatorIndex + 2));
    if (!from || !to) {
      return null;
    }
    return buildRenamedKey(from, to);
  }

  return null;
}

export function buildIssueLabels(primaryLabel, needsChanges) {
  const labels = [primaryLabel, MODEL_LABEL];
  if (needsChanges) {
    labels.push(RESOLVER_LABEL);
  }
  return labels;
}

export function shouldOpenIssue(eventType, triage) {
  if (eventType === "removed") {
    return triage.exactMentions.length > 0;
  }
  if (eventType === "added") {
    return (
      triage.exactMentions.length === 0 && triage.predecessorMentions.length > 0
    );
  }
  return (
    triage.exactMentions.length > 0 || triage.predecessorMentions.length > 0
  );
}

export async function runDiscovery(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const warn = options.warn ?? console.warn;
  const fetchFn = options.fetch ?? fetch;
  const exec = options.execFileSync ?? execFileSync;
  const readText = options.readFileSync ?? readFileSync;
  const readDir = options.readdirSync ?? readdirSync;
  const stat = options.statSync ?? statSync;

  const repository = readRequiredEnv(env, "GITHUB_REPOSITORY");
  const token = readRequiredEnv(env, "GITHUB_TOKEN");
  const [owner, repo] = splitRepository(repository);
  const projectOwner = env.PROJECT_OWNER;
  const projectNumber = parseOptionalNumber(env.PROJECT_NUMBER);

  const [changelogFeed, renameFeed] = await Promise.all([
    fetchJson(fetchFn, CHANGELOG_URL),
    fetchJson(fetchFn, RENAME_CHANGELOG_URL)
  ]);
  const events = collectEvents(changelogFeed, renameFeed);
  const knownKeys = await fetchKnownKeys(fetchFn, token, owner, repo);

  await ensureLabels(fetchFn, token, owner, repo, warn);

  const projectId = await fetchProjectId(fetchFn, token, projectOwner, projectNumber, warn);

  const modelCatalog = loadModelCatalog(exec, warn);
  const modelLookup = new Map(
    modelCatalog.map((entry) => [normalizeModelId(entry.id), entry])
  );
  const sourceCorpus = loadSourceCorpus(readDir, readText, stat);
  const actionableIssueNumbers = [];

  for (const modelId of events.added) {
    const key = buildAddedKey(modelId);
    if (knownKeys.has(key)) {
      continue;
    }

    const metadata = await resolveModelMetadata(modelId, modelLookup, exec, warn);
    const triage = triageAddedModel(modelId, metadata, modelCatalog, sourceCorpus);
    const needsChanges = shouldOpenIssue("added", triage);
    const issue = await createTrackingIssue({
      fetchFn,
      token,
      owner,
      repo,
      title: `New model: ${modelId}`,
      labels: buildIssueLabels("new-model", needsChanges),
      body: renderIssueBody({
        eventType: "added",
        modelId,
        metadata,
        triage,
        needsChanges
      })
    });

    if (!needsChanges) {
      await closeIssue(fetchFn, token, owner, repo, issue.number);
    } else {
      actionableIssueNumbers.push(issue.number);
    }
    await addIssueToProject(fetchFn, token, projectId, issue.node_id, warn);
    knownKeys.add(key);
  }

  for (const modelId of events.removed) {
    const key = buildRemovedKey(modelId);
    if (knownKeys.has(key)) {
      continue;
    }

    const triage = triageRemovedModel(modelId, modelCatalog, sourceCorpus);
    const needsChanges = shouldOpenIssue("removed", triage);
    const issue = await createTrackingIssue({
      fetchFn,
      token,
      owner,
      repo,
      title: `Removed model: ${modelId}`,
      labels: buildIssueLabels("removed-model", needsChanges),
      body: renderIssueBody({
        eventType: "removed",
        modelId,
        metadata: null,
        triage,
        needsChanges
      })
    });

    if (!needsChanges) {
      await closeIssue(fetchFn, token, owner, repo, issue.number);
    } else {
      actionableIssueNumbers.push(issue.number);
    }
    await addIssueToProject(fetchFn, token, projectId, issue.node_id, warn);
    knownKeys.add(key);
  }

  for (const event of events.renamed) {
    const key = buildRenamedKey(event.from, event.to);
    if (knownKeys.has(key)) {
      continue;
    }

    const metadata = await resolveModelMetadata(event.to, modelLookup, exec, warn);
    const triage = triageRenamedModel(event, metadata, modelCatalog, sourceCorpus);
    const needsChanges = shouldOpenIssue("renamed", triage);
    const issue = await createTrackingIssue({
      fetchFn,
      token,
      owner,
      repo,
      title: `Renamed model: ${event.from} -> ${event.to}`,
      labels: buildIssueLabels("renamed-model", needsChanges),
      body: renderIssueBody({
        eventType: "renamed",
        modelId: event.to,
        previousModelId: event.from,
        metadata,
        triage,
        needsChanges
      })
    });

    if (!needsChanges) {
      await closeIssue(fetchFn, token, owner, repo, issue.number);
    } else {
      actionableIssueNumbers.push(issue.number);
    }
    await addIssueToProject(fetchFn, token, projectId, issue.node_id, warn);
    knownKeys.add(key);
  }

  writeWorkflowOutputs(env.GITHUB_OUTPUT, actionableIssueNumbers);
  log(
    `Model discovery created ${actionableIssueNumbers.length} actionable issues out of ${
      events.added.length + events.removed.length + events.renamed.length
    } candidate events.`
  );

  return {
    actionableIssueNumbers,
    events
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeModelId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function startOfCurrentWeekUtc(referenceDate) {
  const utcDate = new Date(referenceDate);
  utcDate.setUTCHours(0, 0, 0, 0);
  const offset = (utcDate.getUTCDay() + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - offset);
  return utcDate;
}

function isEntryFromCurrentWeek(entry, startOfWeek) {
  if (!entry || typeof entry !== "object" || typeof entry.date !== "string") {
    return false;
  }
  const parsed = new Date(entry.date);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed >= startOfWeek;
}

function readRequiredEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing ${key} environment variable.`);
  }
  return value;
}

function parseOptionalNumber(raw) {
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) ? value : null;
}

function splitRepository(repository) {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
  }
  return parts;
}

function buildAddedKey(modelId) {
  return `added::${modelId}`;
}

function buildRemovedKey(modelId) {
  return `removed::${modelId}`;
}

function buildRenamedKey(from, to) {
  return `renamed::${from}->${to}`;
}

async function fetchKnownKeys(fetchFn, token, owner, repo) {
  const keys = new Set();
  for (const label of TRACKING_LABELS) {
    const issues = await fetchIssuesForLabel(fetchFn, token, owner, repo, label);
    for (const issue of issues) {
      const key = parseIssueKeyFromTitle(issue.title);
      if (key) {
        keys.add(key);
      }
    }
  }
  return keys;
}

async function fetchIssuesForLabel(fetchFn, token, owner, repo, label) {
  const issues = [];
  let url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&labels=${encodeURIComponent(
    label
  )}&per_page=100`;

  while (url) {
    const response = await githubRequest(fetchFn, token, url);
    const page = await response.json();
    for (const issue of page) {
      if (!issue.pull_request) {
        issues.push(issue);
      }
    }
    url = parseNextLink(response.headers.get("link"));
  }

  return issues;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) {
    return null;
  }
  for (const rawPart of linkHeader.split(",")) {
    const part = rawPart.trim();
    if (!part.includes('rel="next"')) {
      continue;
    }
    const start = part.indexOf("<");
    const end = part.indexOf(">");
    if (start >= 0 && end > start) {
      return part.slice(start + 1, end);
    }
  }
  return null;
}

async function ensureLabels(fetchFn, token, owner, repo, warn) {
  for (const label of LABEL_DEFINITIONS) {
    const response = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/labels`, {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify(label)
    });

    if (response.ok || response.status === 422) {
      continue;
    }
    const message = await safeReadError(response);
    warn(`Failed to ensure label "${label.name}": ${message}`);
  }
}

async function fetchProjectId(fetchFn, token, owner, number, warn) {
  if (!owner || !number) {
    return null;
  }
  const query = `
    query ($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
        }
      }
    }
  `;
  const payload = await githubGraphql(fetchFn, token, query, { owner, number }, warn, {
    suppressErrors: isProjectV2NotFoundErrors
  });
  return payload?.data?.organization?.projectV2?.id ?? null;
}

async function addIssueToProject(fetchFn, token, projectId, issueNodeId, warn) {
  if (!projectId || !issueNodeId) {
    return;
  }
  const mutation = `
    mutation ($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  `;
  await githubGraphql(fetchFn, token, mutation, {
    projectId,
    contentId: issueNodeId
  }, warn);
}

function isProjectV2NotFoundErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return false;
  }

  for (const error of errors) {
    if (!error || typeof error !== "object") {
      return false;
    }
    if (error.type !== "NOT_FOUND") {
      return false;
    }
    if (!Array.isArray(error.path)) {
      return false;
    }
    if (error.path.length !== 2) {
      return false;
    }
    if (error.path[0] !== "organization" || error.path[1] !== "projectV2") {
      return false;
    }
  }

  return true;
}

async function githubGraphql(fetchFn, token, query, variables, warn, options = {}) {
  const response = await fetchFn("https://api.github.com/graphql", {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const message = await safeReadError(response);
    warn(`GraphQL request failed: ${message}`);
    return null;
  }
  const payload = await response.json();
  if (payload.errors) {
    if (options.suppressErrors?.(payload.errors)) {
      return null;
    }
    warn(`GraphQL request returned errors: ${JSON.stringify(payload.errors)}`);
    return null;
  }
  return payload;
}

function execModelsRaw(exec, args) {
  return exec("poe-code", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      OUTPUT_FORMAT: "json"
    }
  });
}

function loadModelCatalog(exec, warn) {
  try {
    const raw = execModelsRaw(exec, ["models", "--view", "raw"]);
    const parsed = yamlParse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          typeof entry.id === "string" &&
          typeof entry.owned_by === "string"
      )
      .map((entry) => ({
        id: normalizeModelId(entry.id),
        owned_by: normalizeModelId(entry.owned_by),
        created: typeof entry.created === "number" ? entry.created : null
      }));
  } catch (error) {
    warn(`Unable to load model catalog: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function resolveModelMetadata(modelId, modelLookup, exec, warn) {
  const cached = modelLookup.get(modelId);
  if (cached) {
    return cached;
  }

  try {
    const raw = execModelsRaw(exec, ["models", "--model", modelId, "--view", "raw"]);
    const parsed = yamlParse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (!first || typeof first !== "object") {
      return null;
    }
    if (typeof first.id !== "string" || typeof first.owned_by !== "string") {
      return null;
    }
    const metadata = {
      id: normalizeModelId(first.id),
      owned_by: normalizeModelId(first.owned_by),
      created: typeof first.created === "number" ? first.created : null
    };
    modelLookup.set(metadata.id, metadata);
    return metadata;
  } catch (error) {
    warn(
      `Unable to enrich model metadata for "${modelId}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

function triageAddedModel(modelId, metadata, modelCatalog, sourceCorpus) {
  const exactTerms = collectExactTerms(modelId, metadata);
  const predecessorTerms = collectFamilyTerms(modelId, modelCatalog);
  return {
    exactMentions: findMentions(sourceCorpus, exactTerms),
    predecessorMentions: findMentions(sourceCorpus, predecessorTerms)
  };
}

function triageRemovedModel(modelId, modelCatalog, sourceCorpus) {
  const exactTerms = new Set([modelId]);
  for (const model of modelCatalog) {
    if (model.id === modelId) {
      exactTerms.add(`${model.owned_by}/${model.id}`);
    }
  }
  return {
    exactMentions: findMentions(sourceCorpus, Array.from(exactTerms)),
    predecessorMentions: []
  };
}

function triageRenamedModel(event, metadata, modelCatalog, sourceCorpus) {
  const exactTerms = new Set([
    ...collectExactTerms(event.from, null),
    ...collectExactTerms(event.to, metadata)
  ]);
  const predecessorTerms = new Set([
    ...collectFamilyTerms(event.to, modelCatalog),
    ...collectFamilyTerms(event.from, modelCatalog)
  ]);
  predecessorTerms.delete(event.from);
  predecessorTerms.delete(event.to);
  return {
    exactMentions: findMentions(sourceCorpus, Array.from(exactTerms)),
    predecessorMentions: findMentions(sourceCorpus, Array.from(predecessorTerms))
  };
}

function collectExactTerms(modelId, metadata) {
  const terms = [modelId];
  if (metadata?.owned_by) {
    terms.push(`${metadata.owned_by}/${modelId}`);
  }
  return terms;
}

function collectFamilyTerms(modelId, modelCatalog) {
  const familyKey = buildFamilyKey(modelId);
  if (!familyKey) {
    return [];
  }

  const terms = [];
  for (const entry of modelCatalog) {
    if (entry.id === modelId) {
      continue;
    }
    if (buildFamilyKey(entry.id) !== familyKey) {
      continue;
    }
    terms.push(entry.id);
    terms.push(`${entry.owned_by}/${entry.id}`);
  }
  return terms;
}

function buildFamilyKey(modelId) {
  const parts = modelId
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);

  while (parts.length > 1 && isVersionToken(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts.join("-");
}

function isVersionToken(token) {
  const lower = token.toLowerCase();
  if (lower.startsWith("v") && hasNumber(lower.slice(1))) {
    return true;
  }
  return hasNumber(lower) && !hasLetterOutsideVPrefix(lower);
}

function hasNumber(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      return true;
    }
  }
  return false;
}

function hasLetterOutsideVPrefix(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isLower = code >= 97 && code <= 122;
    const isUpper = code >= 65 && code <= 90;
    if (!isLower && !isUpper) {
      continue;
    }
    if (index === 0 && (value[index] === "v" || value[index] === "V")) {
      continue;
    }
    return true;
  }
  return false;
}

function loadSourceCorpus(readDir, readText, stat) {
  const rootDir = "src";
  const corpus = [];

  function walk(currentDir) {
    for (const entry of readDir(currentDir, { withFileTypes: true })) {
      const absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = extname(entry.name);
      if (!SOURCE_EXTENSIONS.has(extension)) {
        continue;
      }

      const fileStat = stat(absolutePath);
      if (!fileStat.isFile()) {
        continue;
      }

      const content = readText(absolutePath, "utf8").toLowerCase();
      corpus.push({
        path: relative(process.cwd(), absolutePath),
        content
      });
    }
  }

  walk(rootDir);
  return corpus;
}

function findMentions(sourceCorpus, rawTerms) {
  const terms = Array.from(
    new Set(rawTerms.map((term) => normalizeModelId(term)).filter(Boolean))
  );
  if (terms.length === 0) {
    return [];
  }

  const mentions = [];
  for (const term of terms) {
    for (const file of sourceCorpus) {
      const index = file.content.indexOf(term);
      if (index < 0) {
        continue;
      }
      const line = lineNumberAt(file.content, index);
      mentions.push(`${file.path}:${line} (${term})`);
      if (mentions.length >= 25) {
        return mentions;
      }
    }
  }
  return mentions;
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content[cursor] === "\n") {
      line += 1;
    }
  }
  return line;
}

async function createTrackingIssue({
  fetchFn,
  token,
  owner,
  repo,
  title,
  body,
  labels
}) {
  const response = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      title,
      body,
      labels
    })
  });

  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(`Failed to create issue "${title}": ${message}`);
  }
  const issue = await response.json();
  return {
    number: issue.number,
    node_id: issue.node_id
  };
}

async function closeIssue(fetchFn, token, owner, repo, issueNumber) {
  const response = await fetchFn(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: githubHeaders(token),
      body: JSON.stringify({ state: "closed" })
    }
  );
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(`Failed to close issue #${issueNumber}: ${message}`);
  }
}

function renderResolverContext(eventType, modelId, previousModelId) {
  if (eventType === "added") {
    return [
      `A new Poe model was added: \`${modelId}\`.`,
      "Does any existing model mention need updating because of this addition?",
      `If yes, make the update. Update only the references that should now point to \`${modelId}\`.`
    ];
  }

  if (eventType === "removed") {
    return [
      `A Poe model was removed: \`${modelId}\`.`,
      "Does any mention of this removed model need to be removed or replaced?",
      `If yes, make the update. Update only the references that still depend on \`${modelId}\`.`
    ];
  }

  return [
    `The Poe model \`${previousModelId}\` was renamed to \`${modelId}\`.`,
    `Does any model mention need updating from \`${previousModelId}\` to \`${modelId}\`?`,
    `If yes, make the update. Update only the references that should now use \`${modelId}\`.`
  ];
}

export function renderIssueBody({
  eventType,
  modelId,
  previousModelId = null,
  metadata,
  triage,
  needsChanges
}) {
  const decision = needsChanges
    ? "Changes appear to be required in `src/`."
    : "No matching references found in `src/`; closed as tracking-only.";

  const metadataBlock = metadata
    ? yamlStringify(metadata)
    : "available: false\nreason: metadata lookup failed or model not listed\n";
  const triageBlock = yamlStringify({
    exact_mentions: triage.exactMentions,
    predecessor_mentions: triage.predecessorMentions
  });

  return [
    "## Event",
    "",
    `- type: ${eventType}`,
    ...(previousModelId ? [`- previous_model: ${previousModelId}`] : []),
    `- model: ${modelId}`,
    "",
    "## Resolver Context",
    "",
    ...renderResolverContext(eventType, modelId, previousModelId),
    "",
    "## Metadata",
    "",
    "```yaml",
    metadataBlock.trimEnd(),
    "```",
    "",
    "## Triage Evidence (fixed-string checks in `src/`)",
    "",
    "```yaml",
    triageBlock.trimEnd(),
    "```",
    "",
    "## Decision",
    "",
    decision,
    ""
  ].join("\n");
}

function writeWorkflowOutputs(outputPath, actionableIssueNumbers) {
  if (!outputPath) {
    return;
  }
  appendFileSync(
    outputPath,
    `actionable_issue_numbers=${JSON.stringify(actionableIssueNumbers)}\n`
  );
  appendFileSync(
    outputPath,
    `actionable_issue_count=${actionableIssueNumbers.length}\n`
  );
}

async function fetchJson(fetchFn, url) {
  const response = await fetchFn(url);
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(`Failed to fetch ${url}: ${message}`);
  }
  return await response.json();
}

async function githubRequest(fetchFn, token, url) {
  const response = await fetchFn(url, {
    headers: githubHeaders(token)
  });
  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(`GitHub API request failed: ${message}`);
  }
  return response;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "poe-code",
    Accept: "application/vnd.github+json"
  };
}

async function safeReadError(response) {
  try {
    const payload = await response.json();
    if (payload && typeof payload.message === "string") {
      return `${response.status} ${response.statusText}: ${payload.message}`;
    }
  } catch {
    // Ignore parse errors.
  }
  return `${response.status} ${response.statusText}`;
}

async function main() {
  await runDiscovery();
}

const currentFilePath = fileURLToPath(import.meta.url);
const entryFilePath = process.argv[1]
  ? fileURLToPath(pathToFileURL(process.argv[1]))
  : "";

if (entryFilePath && currentFilePath === entryFilePath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
