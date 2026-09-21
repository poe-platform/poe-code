import * as fsPromises from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { native } from "./native.js";
import { extractToolCallSummariesFromSessionUpdateStream, streamUpdate } from "./stream-helpers.js";
function normalizeTime(value, now, field) {
  if (value === undefined) return now().toISOString();
  const date =
    value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  if (date !== undefined && !Number.isNaN(date.getTime())) return date.toISOString();
  throw new Error(`${field} must be a valid date.`);
}
function encodedOutput(value) {
  if (value instanceof Error && value.message.length > 0) return value.message;
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? undefined : JSON.parse(encoded);
  } catch {
    return undefined;
  }
}
export async function generateRunReportFromSessionUpdateStream(stream, options = {}) {
  const collector = new native.NativeAcpCollector(),
    entries = [];
  for await (const entry of stream) {
    entries.push(entry);
    const session =
      typeof entry.jsonrpc === "string" && entry.method === "session/update"
        ? entry.params?.sessionId
        : undefined;
    const update = streamUpdate(entry);
    if (update.sessionUpdate === "usage_update") {
      native.acpValidateUsage(update.used, update.size, update.cost != null, update.cost?.amount);
      collector.push(
        JSON.stringify(
          session === undefined
            ? update
            : {
                jsonrpc: entry.jsonrpc,
                method: entry.method,
                params: { sessionId: session, update }
              }
        )
      );
    } else if (session !== undefined)
      collector.push(
        JSON.stringify({
          jsonrpc: entry.jsonrpc,
          method: entry.method,
          params: { sessionId: session, update: { sessionUpdate: "session_info_update" } }
        })
      );
  }
  if (
    !(typeof options.runId === "string" && options.runId.trim().length > 0) &&
    collector.session() === null
  )
    throw new Error("Run id is required via options.runId or session/update stream items");
  const now = options.now ?? (() => new Date()),
    startTime = normalizeTime(options.startTime, now, "startTime"),
    endTime = normalizeTime(options.endTime, now, "endTime");
  const tools = await extractToolCallSummariesFromSessionUpdateStream(entries);
  for (const tool of tools) {
    collector.push(
      JSON.stringify({
        ...tool,
        sessionUpdate: "tool_call",
        rawInput: undefined,
        rawOutput: encodedOutput(tool.rawOutput)
      })
    );
  }
  const report = collector.report(
    JSON.stringify({
      runId: options.runId,
      startTime,
      endTime,
      exitStatus: options.exitStatus,
      errors: options.errors
    })
  );
  report.toolCalls = tools;
  return report;
}
export function formatRunReportSummary(report) {
  const start = Date.parse(report.startTime),
    end = Date.parse(report.endTime);
  const duration =
    Number.isNaN(start) || Number.isNaN(end) || end < start
      ? "unknown"
      : `${Number(((end - start) / 1000).toFixed(3))}s`;
  return native.acpReportSummary(
    JSON.stringify(report, (key, value) =>
      key === "rawInput" || key === "rawOutput" ? undefined : value
    ),
    duration
  );
}
async function writeFile(fs, target, content) {
  if (fs.rename === undefined) {
    await fs.writeFile(target, content, { encoding: "utf8" });
    return;
  }
  for (let attempt = 0; attempt < 10; attempt++) {
    const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
    let created = false;
    try {
      await fs.writeFile(temp, content, { encoding: "utf8", flag: "wx" });
      created = true;
      await fs.rename(temp, target);
      return;
    } catch (error) {
      const exists =
        error !== null &&
        typeof error === "object" &&
        Object.hasOwn(error, "code") &&
        error.code === "EEXIST";
      if (exists && !created) continue;
      if (created || !exists) await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error(`Unable to create temporary run report file for ${target}.`);
}
export async function saveRunReport(report, options = {}) {
  const fs = options.fs ?? fsPromises,
    now = options.now ?? (() => new Date()),
    home = options.homeDir ?? homedir(),
    reportsDir = join(home, ".poe-code", "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  if (fs.realpath !== undefined) {
    const [canonicalHome, canonicalReports] = await Promise.all([
        fs.realpath(home),
        fs.realpath(reportsDir)
      ]),
      path = relative(canonicalHome, canonicalReports);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path))
      throw new Error("The reports directory must remain inside home state.");
  }
  const date = now(),
    pad = (value, size) => String(value).padStart(size, "0");
  const timestamp =
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    "-" +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    "-" +
    pad(date.getUTCMilliseconds(), 3);
  const safe = native.acpSafeSegment(report.runId),
    id =
      safe === report.runId
        ? safe
        : `${safe}-${createHash("sha256").update(report.runId).digest("hex").slice(0, 10)}`;
  const jsonPath = join(reportsDir, `${timestamp}-${id}.json`),
    summaryPath = join(reportsDir, `${timestamp}-${id}.txt`);
  let saved = report;
  if (options.includeRawContent !== true) {
    const projection = {
      ...report,
      toolCalls: report.toolCalls.map((tool) => ({
        ...tool,
        ...(tool.rawInput === undefined ? {} : { rawInput: null }),
        ...(tool.rawOutput === undefined ? {} : { rawOutput: null })
      }))
    };
    saved = native.acpRedactReport(JSON.stringify(projection));
  }
  await writeFile(fs, jsonPath, JSON.stringify(saved, null, 2));
  try {
    await writeFile(fs, summaryPath, formatRunReportSummary(saved));
  } catch (error) {
    await fs.rm(jsonPath);
    throw error;
  }
  return { reportsDir, jsonPath, summaryPath };
}
