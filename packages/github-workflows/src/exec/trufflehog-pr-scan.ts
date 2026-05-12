import { appendFile, readFile, writeFile } from "node:fs/promises";
import { UserError } from "toolcraft";
import type { CommandRunner } from "@poe-code/agent-spawn";
import { runCommand } from "@poe-code/agent-spawn";

const DEFAULT_RESULTS_FILE = "/tmp/trufflehog-results.jsonl";
const DEFAULT_STDERR_FILE = "/tmp/trufflehog-stderr.log";
const COMMENT_MARKER = "<!-- trufflehog-pr-scan -->";
const FIX_MESSAGE = "Fix: remove the value, rotate it if it was real, and push a cleanup commit.";

export type TruffleHogFindingStatus = "verified" | "unverified" | "unknown";

export interface TruffleHogFinding {
  detector: string;
  filePath: string;
  lineNumber: number;
  status: TruffleHogFindingStatus;
}

interface EnvReader {
  get(key: string): string | undefined;
}

export type TruffleHogPrScanCommand =
  | "scan-for-secrets"
  | "report-advisory-result"
  | "clear-stale-advisory-result";

export async function runTruffleHogPrScanCommand(
  command: TruffleHogPrScanCommand,
  env: EnvReader,
  options: { cwd?: string; runner?: CommandRunner } = {}
): Promise<null> {
  const runner = options.runner ?? runCommand;
  const cwd = options.cwd ?? process.cwd();

  if (command === "scan-for-secrets") {
    await scanForSecrets(env, cwd, runner);
    return null;
  }

  if (command === "report-advisory-result") {
    await reportAdvisoryResult(env, runner);
    return null;
  }

  await clearStaleAdvisoryResult(env, runner);
  return null;
}

export function parseTruffleHogFindings(jsonl: string): TruffleHogFinding[] {
  const findings: TruffleHogFinding[] = [];

  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") {
      continue;
    }

    const parsed = parseJsonObject(line);
    const detector = stringValue(parsed.DetectorName);
    if (detector === undefined) {
      continue;
    }

    findings.push({
      detector,
      filePath: readFilePath(parsed),
      lineNumber: readLineNumber(parsed),
      status: readStatus(parsed)
    });
  }

  return findings;
}

export function uniqueTruffleHogFindings(findings: TruffleHogFinding[]): TruffleHogFinding[] {
  const unique = new Map<string, TruffleHogFinding>();

  for (const finding of findings) {
    const key = [finding.status, finding.detector, finding.filePath, String(finding.lineNumber)].join("\u0000");
    if (!unique.has(key)) {
      unique.set(key, finding);
    }
  }

  return [...unique.values()];
}

export function renderTruffleHogFindingsTable(
  findings: TruffleHogFinding[],
  options: { repository: string; headSha: string; maxFindings: number }
): string {
  const uniqueFindings = uniqueTruffleHogFindings(findings);
  const rows = [
    "| Detector | Location | Verification |",
    "| --- | --- | --- |",
    ...uniqueFindings
      .slice(0, options.maxFindings)
      .map((finding) => `| ${md(finding.detector)} | ${renderLocation(finding, options)} | ${md(finding.status)} |`)
  ];

  if (uniqueFindings.length > options.maxFindings) {
    rows.push("", `_Showing first ${options.maxFindings} of ${uniqueFindings.length} findings._`);
  }

  return rows.join("\n");
}

export function renderTruffleHogComment(
  findings: TruffleHogFinding[],
  options: { repository: string; headSha: string; maxFindings: number }
): string {
  const uniqueFindings = uniqueTruffleHogFindings(findings);
  const heading =
    uniqueFindings.length === 1
      ? "TruffleHog found a possible secret"
      : `TruffleHog found ${uniqueFindings.length} possible secrets`;

  return [
    COMMENT_MARKER,
    "",
    `### ${heading}`,
    "",
    renderTruffleHogFindingsTable(findings, options),
    "",
    FIX_MESSAGE
  ].join("\n");
}

async function scanForSecrets(env: EnvReader, cwd: string, runner: CommandRunner): Promise<void> {
  const baseSha = requireEnv(env, "BASE_SHA");
  const headSha = requireEnv(env, "HEAD_SHA");
  const results = requireEnv(env, "RESULTS");
  const image = requireEnv(env, "TRUFFLEHOG_IMAGE");
  const resultsFile = env.get("TRUFFLEHOG_RESULTS_FILE") ?? DEFAULT_RESULTS_FILE;
  const stderrFile = env.get("TRUFFLEHOG_STDERR_FILE") ?? DEFAULT_STDERR_FILE;

  const result = await runner(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${cwd}:/tmp`,
      "-w",
      "/tmp",
      image,
      "git",
      "file:///tmp/",
      "--since-commit",
      baseSha,
      "--branch",
      headSha,
      "--fail",
      "--no-update",
      "--json",
      `--results=${results}`
    ],
    { cwd }
  );

  await writeFile(resultsFile, result.stdout, "utf8");
  await writeFile(stderrFile, result.stderr, "utf8");
  process.stderr.write(result.stderr);

  const findingsCount = parseTruffleHogFindings(result.stdout).length;
  await setGitHubOutput(env, "exit_code", String(result.exitCode));
  await setGitHubOutput(env, "findings_count", String(findingsCount));

  if (result.exitCode !== 0 && findingsCount === 0) {
    throw new UserError(`TruffleHog exited with ${result.exitCode} without producing findings.`);
  }
}

async function reportAdvisoryResult(env: EnvReader, runner: CommandRunner): Promise<void> {
  const githubToken = requireEnv(env, "GH_TOKEN");
  const headSha = requireEnv(env, "HEAD_SHA");
  const maxFindings = numberEnv(env, "MAX_FINDINGS");
  const prNumber = requireEnv(env, "PR_NUMBER");
  const repository = requireEnv(env, "REPOSITORY");
  const resultsFile = env.get("TRUFFLEHOG_RESULTS_FILE") ?? DEFAULT_RESULTS_FILE;
  const findings = uniqueTruffleHogFindings(parseTruffleHogFindings(await readFile(resultsFile, "utf8")));
  const body = renderTruffleHogComment(findings, { repository, headSha, maxFindings });

  emitInlineAnnotations(findings, { maxFindings });

  const existingCommentId = await findExistingCommentId(runner, githubToken, repository, prNumber);
  if (existingCommentId === undefined) {
    await ghApi(runner, githubToken, ["repos", repository, "issues", prNumber, "comments"], [
      "--method",
      "POST",
      "--field",
      `body=${body}`
    ]);
  } else {
    await ghApi(runner, githubToken, ["repos", repository, "issues", "comments", existingCommentId], [
      "--method",
      "PATCH",
      "--field",
      `body=${body}`
    ]);
  }

  const heading =
    findings.length === 1
      ? "TruffleHog found a possible secret"
      : `TruffleHog found ${findings.length} possible secrets`;
  const errorTitle = findings.length === 1 ? "TruffleHog finding" : "TruffleHog findings";
  const errorMessage = findings.length === 1 ? "Possible secret detected." : "Possible secrets detected.";

  console.log(`::error title=${errorTitle}::${errorMessage}`);
  await appendStepSummary(env, [
    `### ${heading}`,
    "",
    renderTruffleHogFindingsTable(findings, { repository, headSha, maxFindings }),
    "",
    FIX_MESSAGE
  ].join("\n"));
}

async function clearStaleAdvisoryResult(env: EnvReader, runner: CommandRunner): Promise<void> {
  const githubToken = requireEnv(env, "GH_TOKEN");
  const prNumber = requireEnv(env, "PR_NUMBER");
  const repository = requireEnv(env, "REPOSITORY");
  const existingCommentId = await findExistingCommentId(runner, githubToken, repository, prNumber);

  if (existingCommentId !== undefined) {
    await ghApi(runner, githubToken, ["repos", repository, "issues", "comments", existingCommentId], [
      "--method",
      "DELETE"
    ]);
  }
}

function emitInlineAnnotations(findings: TruffleHogFinding[], options: { maxFindings: number }): void {
  for (const finding of findings.slice(0, options.maxFindings)) {
    if (finding.filePath === "" || finding.lineNumber <= 0) {
      continue;
    }

    console.log(
      `::error file=${commandValue(finding.filePath)},line=${finding.lineNumber},title=${commandValue(`TruffleHog: ${finding.detector}`)}::${messageValue(`Possible secret detected (${finding.status}). Remove it from the PR and rotate it if it was real.`)}`
    );
  }
}

async function findExistingCommentId(
  runner: CommandRunner,
  githubToken: string,
  repository: string,
  prNumber: string
): Promise<string | undefined> {
  const output = await ghApi(runner, githubToken, ["repos", repository, "issues", prNumber, "comments"]);
  const comments = parseJsonArray(output);
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index]!;
    if (stringValue(comment.body)?.includes(COMMENT_MARKER) === true) {
      return stringValue(comment.id);
    }
  }

  return undefined;
}

async function ghApi(
  runner: CommandRunner,
  githubToken: string,
  pathParts: string[],
  args: string[] = []
): Promise<string> {
  const result = await runner("gh", ["api", pathParts.join("/"), ...args], {
    env: { GH_TOKEN: githubToken }
  });

  if (result.exitCode !== 0) {
    throw new UserError(`GitHub API call failed with exit code ${result.exitCode}: ${result.stderr}`);
  }

  return result.stdout;
}

async function setGitHubOutput(env: EnvReader, key: string, value: string): Promise<void> {
  const outputPath = env.get("GITHUB_OUTPUT");
  if (outputPath !== undefined && outputPath !== "") {
    await appendFile(outputPath, `${key}=${value}\n`, "utf8");
  }
}

async function appendStepSummary(env: EnvReader, content: string): Promise<void> {
  const summaryPath = env.get("GITHUB_STEP_SUMMARY");
  if (summaryPath !== undefined && summaryPath !== "") {
    await appendFile(summaryPath, `${content}\n`, "utf8");
  }
}

function renderLocation(
  finding: TruffleHogFinding,
  options: { repository: string; headSha: string }
): string {
  if (finding.lineNumber > 0 && finding.filePath !== "unknown") {
    return `[${finding.filePath}:${finding.lineNumber}](https://github.com/${options.repository}/blob/${options.headSha}/${finding.filePath}#L${finding.lineNumber})`;
  }

  if (finding.filePath !== "unknown") {
    return `\`${md(finding.filePath)}\``;
  }

  return "unknown";
}

function readStatus(record: Record<string, unknown>): TruffleHogFindingStatus {
  if (record.Verified === true) {
    return "verified";
  }

  const verificationError = stringValue(record.VerificationError);
  return verificationError === undefined || verificationError === "" ? "unverified" : "unknown";
}

function readFilePath(record: Record<string, unknown>): string {
  const metadata = objectValue(record.SourceMetadata);
  const gitMetadata =
    recordValue(recordValue(metadata.Data)?.Git) ??
    recordValue(metadata.Git) ??
    recordValue(metadata.git) ??
    recordValue(recordValue(metadata.data)?.git) ??
    {};
  const filesystemMetadata = recordValue(metadata.Filesystem) ?? recordValue(metadata.filesystem) ?? {};

  return (
    stringValue(gitMetadata.file) ??
    stringValue(gitMetadata.File) ??
    stringValue(filesystemMetadata.file) ??
    "unknown"
  );
}

function readLineNumber(record: Record<string, unknown>): number {
  const metadata = objectValue(record.SourceMetadata);
  const gitMetadata =
    recordValue(recordValue(metadata.Data)?.Git) ??
    recordValue(metadata.Git) ??
    recordValue(metadata.git) ??
    recordValue(recordValue(metadata.data)?.git) ??
    {};
  const filesystemMetadata = recordValue(metadata.Filesystem) ?? recordValue(metadata.filesystem) ?? {};

  return (
    numberValue(gitMetadata.line) ??
    numberValue(gitMetadata.Line) ??
    numberValue(filesystemMetadata.line) ??
    0
  );
}

function requireEnv(env: EnvReader, name: string): string {
  const value = env.get(name);
  if (value === undefined || value === "") {
    throw new UserError(`${name} is required.`);
  }

  return value;
}

function numberEnv(env: EnvReader, name: string): number {
  const value = Number(requireEnv(env, name));
  if (!Number.isFinite(value)) {
    throw new UserError(`${name} must be a number.`);
  }

  return value;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return objectValue(parsed);
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(objectValue) : [];
  } catch {
    return [];
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return recordValue(value) ?? {};
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function md(value: string): string {
  return value
    .replaceAll("|", "\\|")
    .replaceAll("`", "'")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function commandValue(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

function messageValue(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}
