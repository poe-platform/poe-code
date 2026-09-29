import { resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext, type CommandDefinition, type CommandHandler } from "safe-bash-contracts";
import {
  getBoolFlag,
  getRawStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "../args.js";
import type { GitHubBackend } from "../backend.js";
import { decodeUtf8, encodeUtf8 } from "../crypto-ssh.js";
import { findGitRoot, readCurrentBranch, resolveRepoFromContext } from "../git-vfs.js";
import { evaluateGoTemplate, evaluateJqExpression } from "../template.js";
import type { GhHttpTransport, GhLimits } from "../types.js";

function setNestedField(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const bracketMatch = /^([^[\]]+)((?:\[[^\]]*\])+)$/u.exec(keyPath);
  if (!bracketMatch) {
    target[keyPath] = value;
    return;
  }
  const rootKey = bracketMatch[1]!;
  const segments = Array.from(bracketMatch[2]!.matchAll(/\[([^\]]*)\]/gu)).map((m) => m[1]!);

  let cursor: unknown = target;
  let currentKey = rootKey;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    const obj = cursor as Record<string, unknown>;

    if (seg === "") {
      if (!Array.isArray(obj[currentKey])) {
        obj[currentKey] = [];
      }
      const arr = obj[currentKey] as unknown[];
      if (isLast) {
        arr.push(value);
      } else {
        const nextContainer: Record<string, unknown> = {};
        arr.push(nextContainer);
        cursor = nextContainer;
      }
    } else {
      if (isLast) {
        if (!obj[currentKey] || typeof obj[currentKey] !== "object") {
          obj[currentKey] = {};
        }
        (obj[currentKey] as Record<string, unknown>)[seg] = value;
      } else {
        if (!obj[currentKey] || typeof obj[currentKey] !== "object") {
          obj[currentKey] = {};
        }
        cursor = obj[currentKey] as Record<string, unknown>;
        currentKey = seg;
      }
    }
  }
}

export interface ApiHandlerEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly http?: GhHttpTransport | undefined;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly limits: GhLimits;
  readonly stdinBytes: Uint8Array;
  readonly stdinText: string;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handleApiCommand(
  env: ApiHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, http, git, limits, stdinBytes, stdinText, writeOut, writeErr } = env;

  const schemas: FlagSchema[] = [
    { short: "X", long: "method", type: "string" },
    { short: "f", long: "raw-field", type: "string[]" },
    { short: "F", long: "field", type: "string[]" },
    { short: "H", long: "header", type: "string[]" },
    { long: "input", type: "string" },
    { short: "i", long: "include", type: "boolean" },
    { long: "paginate", type: "boolean" },
    { long: "slurp", type: "boolean" },
    { long: "silent", type: "boolean" },
    { long: "hostname", type: "string" },
  ];
  const parsed = parseCommandArgs(rawArgs, schemas);
  if (parsed.help || parsed.positionals.length === 0) {
    await writeOut(
      [
        "Makes an authenticated HTTP request to the GitHub API and prints the response.",
        "",
        "USAGE",
        "  gh api <endpoint> [flags]",
        "",
      ].join("\n")
    );
    return parsed.help ? 0 : 1;
  }

  let endpoint = parsed.positionals[0]!;
  if (
    endpoint.includes(":owner") ||
    endpoint.includes(":repo") ||
    endpoint.includes(":branch") ||
    endpoint.includes("{owner}") ||
    endpoint.includes("{repo}") ||
    endpoint.includes("{branch}")
  ) {
    let owner = backend.getActiveUser();
    let repoName = "Hello-World";
    let branch = "main";
    try {
      const coords = await resolveRepoFromContext(
        context,
        parsed.repoFlag,
        backend.defaultHost,
        backend.getActiveUser()
      );
      owner = coords.owner;
      repoName = coords.name;
    } catch {
      // use defaults if not in git repo
    }
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    if (gitRoot) {
      branch = await readCurrentBranch(context, gitRoot, git);
    }
    endpoint = endpoint
      .replace(/:owner|\{owner\}/gu, owner)
      .replace(/:repo|\{repo\}/gu, repoName)
      .replace(/:branch|\{branch\}/gu, branch);
  }

  const rawFields = getRawStringArrayFlag(parsed, "raw-field");
  const typedFields = getRawStringArrayFlag(parsed, "field");
  const inputFlag = getStringFlag(parsed, "input");
  const hasFields = rawFields.length > 0 || typedFields.length > 0 || inputFlag !== undefined;

  const isGraphQl = endpoint === "graphql" || endpoint === "/graphql";
  const explicitMethod = getStringFlag(parsed, "method")?.toUpperCase();
  const method = explicitMethod ?? (isGraphQl || hasFields ? "POST" : "GET");

  const payload: Record<string, unknown> = {};
  for (const item of rawFields) {
    const eqIdx = item.indexOf("=");
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx);
    const val = item.slice(eqIdx + 1);
    setNestedField(payload, key, val);
  }

  for (const item of typedFields) {
    const eqIdx = item.indexOf("=");
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx);
    const rawVal = item.slice(eqIdx + 1);
    let coerced: unknown = rawVal;
    if (rawVal.startsWith("@")) {
      const fileRef = rawVal.slice(1);
      coerced =
        fileRef === "-"
          ? stdinText
          : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, fileRef), { signal: context.signal }));
    } else if (rawVal === "true") coerced = true;
    else if (rawVal === "false") coerced = false;
    else if (rawVal === "null" || rawVal === "nil") coerced = null;
    else if (/^-?\d+$/u.test(rawVal)) coerced = Number.parseInt(rawVal, 10);
    else if (/^-?\d+\.\d+$/u.test(rawVal)) coerced = Number.parseFloat(rawVal);
    setNestedField(payload, key, coerced);
  }

  const host = getStringFlag(parsed, "hostname") ?? context.env.GH_HOST ?? backend.defaultHost;
  const baseUrl =
    host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;

  let fullUrl: string;
  if (/^https?:\/\//u.test(endpoint)) {
    fullUrl = endpoint;
  } else if (isGraphQl) {
    fullUrl = host === "github.com" ? "https://api.github.com/graphql" : `https://${host}/api/graphql`;
  } else {
    fullUrl = `${baseUrl}/${endpoint.replace(/^\/+/u, "")}`;
  }

  let requestBodyBytes: Uint8Array = new Uint8Array();
  if (inputFlag !== undefined) {
    requestBodyBytes =
      inputFlag === "-"
        ? stdinBytes
        : await context.fs.readFile(resolvePath(context.cwd, inputFlag), { signal: context.signal });
  } else if (isGraphQl) {
    const query = String(payload.query ?? "");
    const variables: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k !== "query" && k !== "operationName") variables[k] = v;
    }
    requestBodyBytes = encodeUtf8(
      JSON.stringify({
        query,
        variables,
        ...(payload.operationName ? { operationName: payload.operationName } : {}),
      })
    );
  } else if (method === "GET" && Object.keys(payload).length > 0) {
    const u = new URL(fullUrl);
    for (const [k, v] of Object.entries(payload)) {
      u.searchParams.set(k, String(v));
    }
    fullUrl = u.toString();
  } else if (Object.keys(payload).length > 0) {
    requestBodyBytes = encodeUtf8(JSON.stringify(payload));
  }

  const token = backend.getActiveToken(host, context.env);
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(requestBodyBytes.length > 0 ? { "content-type": "application/json; charset=utf-8" } : {}),
  };
  for (const h of getRawStringArrayFlag(parsed, "header")) {
    const colonIdx = h.indexOf(":");
    if (colonIdx !== -1) {
      headers[h.slice(0, colonIdx).trim().toLowerCase()] = h.slice(colonIdx + 1).trim();
    }
  }

  const paginate = getBoolFlag(parsed, "paginate");
  const slurp = getBoolFlag(parsed, "slurp");
  const includeHeaders = getBoolFlag(parsed, "include");
  const silent = getBoolFlag(parsed, "silent");
  const jqFlag = getStringFlag(parsed, "jq");
  const templateFlag = getStringFlag(parsed, "template");

  const collectedPages: unknown[] = [];
  let nextUrl: string | undefined = fullUrl;
  let lastStatus = 200;
  let lastHeaders: Readonly<Record<string, string>> = {};
  let lastBodyText = "";

  while (nextUrl) {
    const response = await backend.dispatchHttp(
      {
        url: nextUrl,
        method,
        headers,
        body: requestBodyBytes,
        signal: context.signal,
      },
      http,
      limits
    );
    lastStatus = response.status;
    lastHeaders = response.headers;
    lastBodyText = decodeUtf8(response.body);

    if (lastStatus >= 400) {
      await writeErr(`gh: HTTP ${lastStatus}: ${lastBodyText}\n`);
      return 1;
    }

    if (lastBodyText.trim()) {
      try {
        const parsedPage = JSON.parse(lastBodyText);
        if (Array.isArray(parsedPage) && paginate && !slurp) {
          collectedPages.push(...parsedPage);
        } else {
          collectedPages.push(parsedPage);
        }
      } catch {
        collectedPages.push(lastBodyText);
      }
    }

    if (!paginate) break;
    const linkHeader = response.headers.link ?? response.headers.Link ?? "";
    const nextMatch = /<([^>]+)>;\s*rel="next"/u.exec(linkHeader);
    nextUrl = nextMatch ? nextMatch[1] : undefined;
  }

  if (silent) return 0;

  let outputPrefix = "";
  if (includeHeaders) {
    const headerLines = [`HTTP/2.0 ${lastStatus} OK`];
    for (const [k, v] of Object.entries(lastHeaders)) {
      headerLines.push(`${k}: ${v}`);
    }
    outputPrefix = headerLines.join("\r\n") + "\r\n\r\n";
  }

  const finalData =
    paginate
      ? slurp
        ? collectedPages
        : collectedPages.length === 1 && !Array.isArray(collectedPages[0])
          ? collectedPages[0]
          : collectedPages
      : collectedPages[0];

  if (jqFlag) {
    const jqOut = await evaluateJqExpression(finalData, jqFlag, context.signal, limits.maxOutputBytes);
    await writeOut(outputPrefix + jqOut);
    return 0;
  }

  if (templateFlag) {
    const tmplOut = evaluateGoTemplate(finalData, templateFlag);
    await writeOut(outputPrefix + (tmplOut.endsWith("\n") ? tmplOut : `${tmplOut}\n`));
    return 0;
  }

  if (finalData === undefined) {
    await writeOut(outputPrefix);
    return 0;
  }

  if (typeof finalData === "string") {
    await writeOut(outputPrefix + (finalData.endsWith("\n") ? finalData : `${finalData}\n`));
    return 0;
  }

  await writeOut(outputPrefix + `${JSON.stringify(finalData, null, 2)}\n`);
  return 0;
}
