import { resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext, type CommandDefinition, type CommandHandler } from "safe-bash-contracts";
import {
  getBoolFlag,
  getIntFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "../args.js";
import type { GitHubBackend } from "../backend.js";
import { bytesToHex, decodeUtf8, sha1Sync } from "../crypto-ssh.js";
import {
  findGitRoot,
  parseRepoSpec,
  readCurrentBranch,
  readHeadOid,
  resolveRepoFromContext,
  runGitInVfs,
  writeWorktreeFiles,
} from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type {
  GhBrowserOpener,
  GhCacheEntry,
  GhGist,
  GhGistFile,
  GhGpgKey,
  GhLabel,
  GhLimits,
  GhOpenSslProvider,
  GhSecret,
  GhSshKey,
  GhSshProvider,
  GhVariable,
} from "../types.js";

export interface MiscHandlerEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly openssl: GhOpenSslProvider;
  readonly ssh: GhSshProvider;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits: GhLimits;
  readonly readStdinText: () => Promise<string>;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

// 1. gh gist
export async function handleGistCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, git, readStdinText, writeOut, writeErr } = env;
  const sub = rawArgs[0];
  const rest = rawArgs.slice(1);

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    await writeOut("Usage: gh gist <create|list|view|edit|clone|delete|rename> [flags]\n");
    return 0;
  }

  if (sub === "create") {
    const schemas: FlagSchema[] = [
      { short: "d", long: "desc", type: "string" },
      { short: "f", long: "filename", type: "string" },
      { short: "p", long: "public", type: "boolean" },
    ];
    const parsed = parseCommandArgs(rest, schemas);
    const files: Record<string, GhGistFile> = {};

    if (parsed.positionals.length === 0 || (parsed.positionals.length === 1 && parsed.positionals[0] === "-")) {
      const fn = getStringFlag(parsed, "filename") ?? "gistfile0.txt";
      const content = await readStdinText();
      files[fn] = { filename: fn, content, size: content.length };
    } else {
      for (const fileArg of parsed.positionals) {
        const resolved = resolvePath(context.cwd, fileArg);
        const content = decodeUtf8(await context.fs.readFile(resolved, { signal: context.signal }));
        const fn = resolved.split("/").pop() ?? fileArg;
        files[fn] = { filename: fn, content, size: content.length };
      }
    }

    const id = bytesToHex(sha1Sync(`gist:${backend.nextId()}`)).slice(0, 20);
    const ts = backend.isoNow();
    const gist: GhGist = {
      id,
      description: getStringFlag(parsed, "desc") ?? "",
      public: getBoolFlag(parsed, "public"),
      owner: { login: backend.getActiveUser() },
      files,
      htmlUrl: `https://gist.${backend.defaultHost}/${backend.getActiveUser()}/${id}`,
      gitPullUrl: `https://gist.${backend.defaultHost}/${id}.git`,
      createdAt: ts,
      updatedAt: ts,
    };
    backend.gists.set(id, gist);
    await writeOut(`${gist.htmlUrl}\n`);
    return 0;
  }

  if (sub === "list" || sub === "ls") {
    const schemas: FlagSchema[] = [
      { short: "L", long: "limit", type: "string" },
      { long: "public", type: "boolean" },
      { long: "secret", type: "boolean" },
    ];
    const parsed = parseCommandArgs(rest, schemas);
    let gists = Array.from(backend.gists.values());
    if (getBoolFlag(parsed, "public")) gists = gists.filter((g) => g.public);
    if (getBoolFlag(parsed, "secret")) gists = gists.filter((g) => !g.public);
    gists = gists.slice(0, getIntFlag(parsed, "limit", 10));

    const formatted = await formatCommandOutput({
      data: gists,
      availableFields: ["id", "description", "public", "files", "owner", "htmlUrl", "createdAt", "updatedAt"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }

    const lines = gists.map((g) => {
      const fileCount = Object.keys(g.files).length;
      return `${g.id}\t${g.description}\t${fileCount} file${fileCount === 1 ? "" : "s"}\t${
        g.public ? "public" : "secret"
      }\t${g.updatedAt}`;
    });
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (sub === "view") {
    const schemas: FlagSchema[] = [
      { short: "f", long: "filename", type: "string" },
      { short: "r", long: "raw", type: "boolean" },
      { long: "files", type: "boolean" },
    ];
    const parsed = parseCommandArgs(rest, schemas);
    const idArg = (parsed.positionals[0] ?? "").split("/").pop() ?? "";
    const gist = backend.gists.get(idArg) ?? Array.from(backend.gists.values())[0];
    if (!gist) {
      await writeErr(`gist ${idArg} not found\n`);
      return 1;
    }
    if (getBoolFlag(parsed, "files")) {
      await writeOut(Object.keys(gist.files).join("\n") + "\n");
      return 0;
    }
    const fn = getStringFlag(parsed, "filename");
    const targetFiles = fn && gist.files[fn] ? [gist.files[fn]!] : Object.values(gist.files);
    const body = targetFiles.map((f) => f.content).join("\n");
    await writeOut(body.endsWith("\n") ? body : `${body}\n`);
    return 0;
  }

  if (sub === "edit") {
    const schemas: FlagSchema[] = [
      { short: "a", long: "add", type: "string" },
      { short: "d", long: "desc", type: "string" },
      { short: "f", long: "filename", type: "string" },
      { short: "r", long: "remove", type: "string" },
    ];
    const parsed = parseCommandArgs(rest, schemas);
    const idArg = (parsed.positionals[0] ?? "").split("/").pop() ?? "";
    const gist = backend.gists.get(idArg);
    if (!gist) {
      await writeErr(`gist ${idArg} not found\n`);
      return 1;
    }
    const desc = getStringFlag(parsed, "desc");
    if (desc !== undefined) gist.description = desc;
    const addFile = getStringFlag(parsed, "add");
    if (addFile) {
      const resolved = resolvePath(context.cwd, addFile);
      const content = decodeUtf8(await context.fs.readFile(resolved, { signal: context.signal }));
      const fn = getStringFlag(parsed, "filename") ?? resolved.split("/").pop() ?? addFile;
      gist.files[fn] = { filename: fn, content, size: content.length };
    }
    const rmFile = getStringFlag(parsed, "remove");
    if (rmFile) {
      delete gist.files[rmFile];
    }
    await writeOut(`✓ Edited gist ${gist.id}\n`);
    return 0;
  }

  if (sub === "clone") {
    const parsed = parseCommandArgs(rest, []);
    const idArg = (parsed.positionals[0] ?? "").split("/").pop() ?? "";
    const gist = backend.gists.get(idArg);
    if (!gist) {
      await writeErr(`gist ${idArg} not found\n`);
      return 1;
    }
    const targetDir = resolvePath(context.cwd, parsed.positionals[1] ?? gist.id);
    const fileMap = Object.fromEntries(
      Object.values(gist.files).map((f) => [f.filename, f.content])
    );
    await context.fs.mkdir(targetDir, { recursive: true, signal: context.signal });
    await runGitInVfs(context, ["init", "-b", "main"], { cwd: targetDir, git });
    await writeWorktreeFiles(context.fs, targetDir, fileMap, context.signal, false);
    await runGitInVfs(context, ["add", "."], { cwd: targetDir, git });
    await runGitInVfs(context, ["commit", "--allow-empty", "-m", "Clone gist"], { cwd: targetDir, git });
    await writeOut(`Cloned gist ${gist.id} into ${targetDir}\n`);
    return 0;
  }

  if (sub === "delete") {
    const parsed = parseCommandArgs(rest, []);
    const idArg = (parsed.positionals[0] ?? "").split("/").pop() ?? "";
    backend.gists.delete(idArg);
    await writeOut(`✓ Deleted gist ${idArg}\n`);
    return 0;
  }

  if (sub === "rename") {
    const parsed = parseCommandArgs(rest, []);
    const [idArg, oldName, newName] = parsed.positionals;
    const gist = backend.gists.get((idArg ?? "").split("/").pop() ?? "");
    if (!gist || !oldName || !newName || !gist.files[oldName]) {
      await writeErr("gist or file not found\n");
      return 1;
    }
    gist.files[newName] = { ...gist.files[oldName]!, filename: newName };
    delete gist.files[oldName];
    await writeOut(`✓ Renamed ${oldName} to ${newName}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh gist"\n`);
  return 1;
}

// 2. gh search
export async function handleSearchCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const sub = rawArgs[0];
  const rest = rawArgs.slice(1);

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    await writeOut("Usage: gh search <prs|issues|repos|commits|code> [<query>] [flags]\n");
    return 0;
  }

  const schemas: FlagSchema[] = [
    { long: "state", type: "string" },
    { long: "author", type: "string" },
    { long: "assignee", type: "string" },
    { long: "label", type: "string[]" },
    { long: "owner", type: "string" },
    { long: "language", type: "string" },
    { long: "draft", type: "boolean" },
    { long: "merged", type: "boolean" },
    { short: "L", long: "limit", type: "string" },
  ];
  const parsed = parseCommandArgs(rest, schemas);
  const query = parsed.positionals.join(" ").toLowerCase();
  const repoFilter = parsed.repoFlag?.toLowerCase();
  const stateFilter = getStringFlag(parsed, "state")?.toUpperCase();
  const authorFilter = getStringFlag(parsed, "author")?.toLowerCase();
  const limit = getIntFlag(parsed, "limit", 30);

  if (sub === "prs") {
    const results: Array<Record<string, unknown>> = [];
    for (const repo of backend.repos.values()) {
      if (repoFilter && repo.nameWithOwner.toLowerCase() !== repoFilter) continue;
      for (const pr of repo.pullRequests.values()) {
        if (stateFilter && pr.state !== stateFilter) continue;
        if (authorFilter && pr.author.login.toLowerCase() !== authorFilter) continue;
        if (parsed.flags.has("draft") && pr.isDraft !== getBoolFlag(parsed, "draft")) continue;
        if (parsed.flags.has("merged") && (pr.state === "MERGED") !== getBoolFlag(parsed, "merged")) continue;
        if (query && !`${pr.title} ${pr.body} ${pr.headRefName}`.toLowerCase().includes(query)) continue;
        results.push({
          ...pr,
          repository: { name: repo.name, nameWithOwner: repo.nameWithOwner },
        });
      }
    }
    const sliced = results.slice(0, limit);
    const formatted = await formatCommandOutput({
      data: sliced,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    const lines = sliced.map(
      (r) => `${(r.repository as { nameWithOwner: string }).nameWithOwner}\t#${r.number}\t${r.state}\t${r.title}`
    );
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (sub === "issues") {
    const results: Array<Record<string, unknown>> = [];
    for (const repo of backend.repos.values()) {
      if (repoFilter && repo.nameWithOwner.toLowerCase() !== repoFilter) continue;
      for (const iss of repo.issues.values()) {
        if (stateFilter && iss.state !== stateFilter) continue;
        if (authorFilter && iss.author.login.toLowerCase() !== authorFilter) continue;
        if (query && !`${iss.title} ${iss.body}`.toLowerCase().includes(query)) continue;
        results.push({
          ...iss,
          repository: { name: repo.name, nameWithOwner: repo.nameWithOwner },
        });
      }
    }
    const sliced = results.slice(0, limit);
    const formatted = await formatCommandOutput({
      data: sliced,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    const lines = sliced.map(
      (r) => `${(r.repository as { nameWithOwner: string }).nameWithOwner}\t#${r.number}\t${r.state}\t${r.title}`
    );
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (sub === "repos") {
    const ownerFilter = getStringFlag(parsed, "owner")?.toLowerCase();
    const results = Array.from(backend.repos.values())
      .filter((r) => {
        if (ownerFilter && r.owner.login.toLowerCase() !== ownerFilter) return false;
        if (query && !`${r.nameWithOwner} ${r.description}`.toLowerCase().includes(query)) return false;
        return true;
      })
      .slice(0, limit);
    const formatted = await formatCommandOutput({
      data: results,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      results.map((r) => `${r.nameWithOwner}\t${r.description}\t${r.visibility.toLowerCase()}`).join("\n") +
        (results.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "commits") {
    const results: Array<Record<string, unknown>> = [];
    for (const repo of backend.repos.values()) {
      for (const c of repo.commits.values()) {
        if (query && !`${c.messageHeadline} ${c.messageBody}`.toLowerCase().includes(query)) continue;
        results.push({
          sha: c.oid,
          commit: { message: c.messageHeadline, author: c.author },
          repository: { nameWithOwner: repo.nameWithOwner },
        });
      }
    }
    const sliced = results.slice(0, limit);
    const formatted = await formatCommandOutput({
      data: sliced,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      sliced
        .map(
          (r) =>
            `${(r.repository as { nameWithOwner: string }).nameWithOwner}\t${String(r.sha).slice(0, 7)}\t${(r.commit as { message: string }).message}`
        )
        .join("\n") + (sliced.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "code") {
    const results: Array<Record<string, unknown>> = [];
    for (const repo of backend.repos.values()) {
      const files = repo.branchFiles.get(repo.defaultBranchRef.name) ?? {};
      for (const [path, content] of Object.entries(files)) {
        if (query && !`${path} ${content}`.toLowerCase().includes(query)) continue;
        results.push({
          path,
          repository: { nameWithOwner: repo.nameWithOwner },
          textMatches: [{ fragment: content.slice(0, 120) }],
        });
      }
    }
    const sliced = results.slice(0, limit);
    const formatted = await formatCommandOutput({
      data: sliced,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      sliced
        .map((r) => `${(r.repository as { nameWithOwner: string }).nameWithOwner}:${r.path}`)
        .join("\n") + (sliced.length > 0 ? "\n" : "")
    );
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh search"\n`);
  return 1;
}

// 3. gh label
export async function handleLabelCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const schemas: FlagSchema[] = [
    { short: "c", long: "color", type: "string" },
    { short: "d", long: "description", type: "string" },
    { short: "n", long: "name", type: "string" },
    { short: "f", long: "force", type: "boolean" },
  ];
  const parsed = parseCommandArgs(rest, schemas);
  const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);

  if (sub === "list" || sub === "ls") {
    const labels = Array.from(repo.labels.values());
    const formatted = await formatCommandOutput({
      data: labels,
      availableFields: ["id", "name", "color", "description", "isDefault"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      labels.map((l) => `${l.name}\t${l.description}\t#${l.color}`).join("\n") +
        (labels.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "create") {
    const name = parsed.positionals[0];
    if (!name) {
      await writeErr("label name required\n");
      return 1;
    }
    if (repo.labels.has(name.toLowerCase()) && !getBoolFlag(parsed, "force")) {
      await writeErr(`label "${name}" already exists; use --force to update\n`);
      return 1;
    }
    const lbl: GhLabel = {
      id: backend.nextId(),
      name,
      color: (getStringFlag(parsed, "color") ?? "ededed").replace(/^#/u, ""),
      description: getStringFlag(parsed, "description") ?? "",
    };
    repo.labels.set(name.toLowerCase(), lbl);
    await writeOut(`✓ Created label "${name}" in ${repo.nameWithOwner}\n`);
    return 0;
  }

  if (sub === "edit") {
    const oldName = parsed.positionals[0] ?? "";
    const existing = repo.labels.get(oldName.toLowerCase());
    if (!existing) {
      await writeErr(`label "${oldName}" not found\n`);
      return 1;
    }
    const newName = getStringFlag(parsed, "name") ?? existing.name;
    repo.labels.delete(oldName.toLowerCase());
    const updated: GhLabel = {
      id: existing.id,
      name: newName,
      color: (getStringFlag(parsed, "color") ?? existing.color).replace(/^#/u, ""),
      description: getStringFlag(parsed, "description") ?? existing.description,
    };
    repo.labels.set(newName.toLowerCase(), updated);
    await writeOut(`✓ Updated label "${newName}" in ${repo.nameWithOwner}\n`);
    return 0;
  }

  if (sub === "delete") {
    const name = parsed.positionals[0] ?? "";
    repo.labels.delete(name.toLowerCase());
    await writeOut(`✓ Deleted label "${name}" from ${repo.nameWithOwner}\n`);
    return 0;
  }

  if (sub === "clone") {
    const srcSpec = parsed.positionals[0];
    if (!srcSpec) {
      await writeErr("source repository required\n");
      return 1;
    }
    const srcCoords = parseRepoSpec(srcSpec, backend.defaultHost, backend.getActiveUser());
    const srcRepo = backend.getOrCreateRepo(srcCoords.owner, srcCoords.name);
    for (const [k, v] of srcRepo.labels.entries()) {
      if (!repo.labels.has(k) || getBoolFlag(parsed, "force")) {
        repo.labels.set(k, { ...v });
      }
    }
    await writeOut(`✓ Cloned labels from ${srcRepo.nameWithOwner} to ${repo.nameWithOwner}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh label"\n`);
  return 1;
}

// 4. gh secret & variable & cache
export async function handleSecretCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, openssl, readStdinText, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const schemas: FlagSchema[] = [
    { short: "b", long: "body", type: "string" },
    { short: "f", long: "env-file", type: "string" },
    { short: "e", long: "env", type: "string" },
    { short: "o", long: "org", type: "string" },
    { short: "u", long: "user", type: "boolean" },
  ];
  const parsed = parseCommandArgs(rest, schemas);
  const org = getStringFlag(parsed, "org");
  const isUser = getBoolFlag(parsed, "user");
  const repo =
    !org && !isUser
      ? backend.getOrCreateRepo(
          ...(
            await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser()).then(
              (c) => [c.owner, c.name] as const
            )
          )
        )
      : undefined;
  const targetMap = org ? backend.orgSecrets : isUser ? backend.userSecrets : repo!.secrets;

  if (sub === "list" || sub === "ls") {
    const list = Array.from(targetMap.values());
    const formatted = await formatCommandOutput({
      data: list,
      availableFields: ["name", "updatedAt", "visibility"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      list.map((s) => `${s.name}\t${s.updatedAt}`).join("\n") + (list.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "set") {
    const envFile = getStringFlag(parsed, "env-file");
    if (envFile) {
      const text = decodeUtf8(
        await context.fs.readFile(resolvePath(context.cwd, envFile), { signal: context.signal })
      );
      for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        const encrypted = await openssl.encryptSecretForGitHub(v, "gh_pub_key_b64", "key_1");
        targetMap.set(k, {
          name: k,
          updatedAt: backend.isoNow(),
          encryptedValue: encrypted.encrypted_value,
        });
      }
      await writeOut("✓ Imported secrets from file\n");
      return 0;
    }
    const name = parsed.positionals[0];
    if (!name) {
      await writeErr("secret name required\n");
      return 1;
    }
    const value = getStringFlag(parsed, "body") ?? (await readStdinText()).trim();
    const encrypted = await openssl.encryptSecretForGitHub(value, "gh_pub_key_b64", "key_1");
    const entry: GhSecret = {
      name,
      updatedAt: backend.isoNow(),
      encryptedValue: encrypted.encrypted_value,
      environment: getStringFlag(parsed, "env"),
      org,
    };
    targetMap.set(name, entry);
    await writeOut(`✓ Set Actions secret ${name}\n`);
    return 0;
  }

  if (sub === "delete" || sub === "remove") {
    const name = parsed.positionals[0] ?? "";
    targetMap.delete(name);
    await writeOut(`✓ Deleted Actions secret ${name}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh secret"\n`);
  return 1;
}

export async function handleVariableCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, readStdinText, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const schemas: FlagSchema[] = [
    { short: "b", long: "body", type: "string" },
    { short: "e", long: "env", type: "string" },
    { short: "o", long: "org", type: "string" },
  ];
  const parsed = parseCommandArgs(rest, schemas);
  const org = getStringFlag(parsed, "org");
  const repo = !org
    ? backend.getOrCreateRepo(
        ...(
          await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser()).then(
            (c) => [c.owner, c.name] as const
          )
        )
      )
    : undefined;
  const targetMap = org ? backend.orgVariables : repo!.variables;

  if (sub === "list" || sub === "ls") {
    const list = Array.from(targetMap.values());
    const formatted = await formatCommandOutput({
      data: list,
      availableFields: ["name", "value", "createdAt", "updatedAt"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      list.map((v) => `${v.name}\t${v.value}\t${v.updatedAt}`).join("\n") +
        (list.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "get") {
    const name = parsed.positionals[0] ?? "";
    const found = targetMap.get(name);
    if (!found) {
      await writeErr(`variable ${name} not found\n`);
      return 1;
    }
    await writeOut(`${found.value}\n`);
    return 0;
  }

  if (sub === "set") {
    const name = parsed.positionals[0];
    if (!name) {
      await writeErr("variable name required\n");
      return 1;
    }
    const value = getStringFlag(parsed, "body") ?? parsed.positionals[1] ?? (await readStdinText()).trim();
    const ts = backend.isoNow();
    const entry: GhVariable = {
      name,
      value,
      createdAt: ts,
      updatedAt: ts,
      environment: getStringFlag(parsed, "env"),
      org,
    };
    targetMap.set(name, entry);
    await writeOut(`✓ Set Actions variable ${name}\n`);
    return 0;
  }

  if (sub === "delete") {
    const name = parsed.positionals[0] ?? "";
    targetMap.delete(name);
    await writeOut(`✓ Deleted Actions variable ${name}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh variable"\n`);
  return 1;
}

export async function handleCacheCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const parsed = parseCommandArgs(rest, [{ short: "a", long: "all", type: "boolean" }]);
  const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);

  if (repo.caches.size === 0) {
    const c: GhCacheEntry = {
      id: 1,
      key: "node-modules-main",
      version: "v1",
      ref: "refs/heads/main",
      sizeInBytes: 4096,
      createdAt: backend.isoNow(),
      lastAccessedAt: backend.isoNow(),
    };
    repo.caches.set(c.id, c);
  }

  if (sub === "list" || sub === "ls") {
    const list = Array.from(repo.caches.values());
    const formatted = await formatCommandOutput({
      data: list,
      availableFields: ["id", "key", "version", "ref", "sizeInBytes", "createdAt", "lastAccessedAt"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      list.map((c) => `${c.id}\t${c.key}\t${c.sizeInBytes} B\t${c.lastAccessedAt}`).join("\n") +
        (list.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "delete") {
    if (getBoolFlag(parsed, "all")) {
      repo.caches.clear();
      await writeOut(`✓ Deleted all caches from ${repo.nameWithOwner}\n`);
      return 0;
    }
    const target = parsed.positionals[0] ?? "";
    for (const [id, c] of repo.caches.entries()) {
      if (String(id) === target || c.key === target) {
        repo.caches.delete(id);
      }
    }
    await writeOut(`✓ Deleted cache ${target}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh cache"\n`);
  return 1;
}

// 5. gh ssh-key & gpg-key & attestation
export async function handleSshKeyCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, ssh, readStdinText, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const schemas: FlagSchema[] = [
    { short: "t", long: "title", type: "string" },
    { long: "type", type: "string" },
  ];
  const parsed = parseCommandArgs(rest, schemas);

  if (sub === "list" || sub === "ls") {
    const keys = Array.from(backend.sshKeys.values());
    const formatted = await formatCommandOutput({
      data: keys,
      availableFields: ["id", "title", "key", "type", "createdAt"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      keys.map((k) => `${k.title}\t${k.key}\t${k.createdAt}\t${k.id}\t${k.type}`).join("\n") +
        (keys.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "add") {
    const keyFile = parsed.positionals[0];
    let keyContent: string;
    if (keyFile && keyFile !== "-") {
      keyContent = decodeUtf8(
        await context.fs.readFile(resolvePath(context.cwd, keyFile), { signal: context.signal })
      ).trim();
    } else {
      keyContent = (await readStdinText()).trim();
    }
    if (!keyContent) {
      const generated = await ssh.keygen({ comment: `${backend.getActiveUser()}@safe-bash` });
      keyContent = generated.publicKey;
    }
    const info = await ssh.fingerprint(keyContent);
    const id = backend.nextId();
    const keyType = getStringFlag(parsed, "type") === "signing" ? "signing" : "authentication";
    const entry: GhSshKey = {
      id,
      title: getStringFlag(parsed, "title") ?? (info.comment || `key-${id}`),
      key: `${info.keyType} ${info.base64Data}`,
      type: keyType,
      createdAt: backend.isoNow(),
    };
    backend.sshKeys.set(id, entry);
    await writeOut(`✓ Public key added to your account (${info.fingerprint})\n`);
    return 0;
  }

  if (sub === "delete") {
    const id = Number(parsed.positionals[0]);
    backend.sshKeys.delete(id);
    await writeOut(`✓ SSH key ${id} deleted from your account\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh ssh-key"\n`);
  return 1;
}

export async function handleGpgKeyCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, openssl, readStdinText, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const parsed = parseCommandArgs(rest, [{ short: "t", long: "title", type: "string" }]);

  if (sub === "list" || sub === "ls") {
    const keys = Array.from(backend.gpgKeys.values());
    const formatted = await formatCommandOutput({
      data: keys,
      availableFields: ["id", "keyId", "name", "rawKey", "emails", "createdAt", "expiresAt"],
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: env.limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }
    await writeOut(
      keys
        .map(
          (k) => `${k.emails.map((e) => e.email).join(", ")}\t${k.keyId}\t${k.createdAt}\t${k.expiresAt ?? ""}`
        )
        .join("\n") + (keys.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "add") {
    const keyFile = parsed.positionals[0];
    const rawKey =
      keyFile && keyFile !== "-"
        ? decodeUtf8(
            await context.fs.readFile(resolvePath(context.cwd, keyFile), { signal: context.signal })
          ).trim()
        : (await readStdinText()).trim() || "-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKE\n-----END PGP PUBLIC KEY BLOCK-----";
    const digest = await openssl.sha256(rawKey);
    const keyId = bytesToHex(digest).slice(0, 16).toUpperCase();
    const id = backend.nextId();
    const entry: GhGpgKey = {
      id,
      keyId,
      name: getStringFlag(parsed, "title") ?? backend.getActiveUser(),
      rawKey,
      emails: [{ email: `${backend.getActiveUser()}@github.com` }],
      createdAt: backend.isoNow(),
      expiresAt: null,
    };
    backend.gpgKeys.set(id, entry);
    await writeOut(`✓ GPG key ${keyId} added to your account\n`);
    return 0;
  }

  if (sub === "delete") {
    const selector = parsed.positionals[0] ?? "";
    for (const [id, k] of backend.gpgKeys.entries()) {
      if (String(id) === selector || k.keyId.toLowerCase() === selector.toLowerCase()) {
        backend.gpgKeys.delete(id);
      }
    }
    await writeOut(`✓ GPG key ${selector} deleted\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh gpg-key"\n`);
  return 1;
}

export async function handleAttestationCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, openssl, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "verify";
  const rest = rawArgs.slice(1);
  const schemas: FlagSchema[] = [
    { short: "o", long: "owner", type: "string" },
    { short: "b", long: "bundle", type: "string" },
    { long: "format", type: "string" },
  ];
  const parsed = parseCommandArgs(rest, schemas);
  if (sub === "verify") {
    const fileArg = parsed.positionals[0];
    if (!fileArg) {
      await writeErr("artifact path required for attestation verify\n");
      return 1;
    }
    const bytes = await context.fs.readFile(resolvePath(context.cwd, fileArg), {
      signal: context.signal,
    });
    let bundleData: unknown = {
      repository: parsed.repoFlag ?? `${getStringFlag(parsed, "owner") ?? backend.getActiveUser()}/Hello-World`,
    };
    const bundleFile = getStringFlag(parsed, "bundle");
    if (bundleFile) {
      try {
        bundleData = JSON.parse(
          decodeUtf8(
            await context.fs.readFile(resolvePath(context.cwd, bundleFile), { signal: context.signal })
          )
        );
      } catch {
        // use default bundle metadata
      }
    }
    const result = await openssl.verifyAttestationSignature(bundleData, bytes);
    if (!result.verified) {
      await writeErr("✗ Attestation signature verification failed\n");
      return 1;
    }
    if (getStringFlag(parsed, "format") === "json" || parsed.flags.has("json")) {
      await writeOut(`${JSON.stringify([result], null, 2)}\n`);
      return 0;
    }
    await writeOut(
      `Loaded digest ${result.subjectDigest} for file://${fileArg}\n✓ Verification succeeded!\n`
    );
    return 0;
  }
  await writeErr(`unknown command "${sub}" for "gh attestation"\n`);
  return 1;
}

// 6. gh config & alias & status & browse & completion & version
export async function handleConfigCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { backend, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const parsed = parseCommandArgs(rest, [{ short: "h", long: "host", type: "string" }]);

  const keyToProp = (k: string): keyof typeof backend.config | undefined => {
    switch (k) {
      case "git_protocol":
        return "gitProtocol";
      case "editor":
        return "editor";
      case "prompt":
        return "prompt";
      case "pager":
        return "pager";
      case "http_unix_socket":
        return "httpUnixSocket";
      case "browser":
        return "browser";
      default:
        return undefined;
    }
  };

  if (sub === "get") {
    const key = parsed.positionals[0] ?? "";
    const prop = keyToProp(key);
    if (!prop) {
      await writeErr(`unknown config key "${key}"\n`);
      return 1;
    }
    await writeOut(`${String(backend.config[prop])}\n`);
    return 0;
  }

  if (sub === "set") {
    const key = parsed.positionals[0] ?? "";
    const val = parsed.positionals[1] ?? "";
    const prop = keyToProp(key);
    if (!prop) {
      await writeErr(`unknown config key "${key}"\n`);
      return 1;
    }
    (backend.config as unknown as Record<string, string>)[prop] = val;
    return 0;
  }

  if (sub === "list") {
    await writeOut(
      [
        `git_protocol=${backend.config.gitProtocol}`,
        `editor=${backend.config.editor}`,
        `prompt=${backend.config.prompt}`,
        `pager=${backend.config.pager}`,
        `http_unix_socket=${backend.config.httpUnixSocket}`,
        `browser=${backend.config.browser}`,
        "",
      ].join("\n")
    );
    return 0;
  }

  if (sub === "clear-cache") {
    await writeOut("✓ Cleared the cache\n");
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh config"\n`);
  return 1;
}

export async function handleAliasCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { backend, writeOut, writeErr } = env;
  const sub = rawArgs[0] ?? "list";
  const rest = rawArgs.slice(1);
  const parsed = parseCommandArgs(rest, [
    { short: "s", long: "shell", type: "boolean" },
    { long: "all", type: "boolean" },
  ]);

  if (sub === "list" || sub === "ls") {
    const entries = Object.entries(backend.config.aliases);
    await writeOut(
      entries.map(([k, v]) => `${k}: ${v}`).join("\n") + (entries.length > 0 ? "\n" : "")
    );
    return 0;
  }

  if (sub === "set") {
    const name = parsed.positionals[0];
    const expansion = parsed.positionals[1];
    if (!name || !expansion) {
      await writeErr("alias name and expansion required\n");
      return 1;
    }
    backend.config.aliases[name] = getBoolFlag(parsed, "shell") ? `!${expansion}` : expansion;
    await writeOut(`✓ Added alias for ${name}: ${backend.config.aliases[name]}\n`);
    return 0;
  }

  if (sub === "delete") {
    if (getBoolFlag(parsed, "all")) {
      backend.config.aliases = {};
      await writeOut("✓ Deleted all aliases\n");
      return 0;
    }
    const name = parsed.positionals[0] ?? "";
    delete backend.config.aliases[name];
    await writeOut(`✓ Deleted alias ${name}\n`);
    return 0;
  }

  await writeErr(`unknown command "${sub}" for "gh alias"\n`);
  return 1;
}

export async function handleStatusCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { backend, writeOut } = env;
  const parsed = parseCommandArgs(rawArgs, [
    { short: "o", long: "org", type: "string" },
    { short: "e", long: "exclude", type: "string[]" },
  ]);
  const orgFilter = getStringFlag(parsed, "org")?.toLowerCase();
  const excludes = getStringArrayFlag(parsed, "exclude").map((e) => e.toLowerCase());
  const viewer = backend.getActiveUser().toLowerCase();

  const assignedPrs: string[] = [];
  const assignedIssues: string[] = [];
  const reviewRequests: string[] = [];

  for (const repo of backend.repos.values()) {
    if (orgFilter && repo.owner.login.toLowerCase() !== orgFilter) continue;
    if (excludes.includes(repo.nameWithOwner.toLowerCase())) continue;

    for (const pr of repo.pullRequests.values()) {
      if (pr.state !== "OPEN") continue;
      if (pr.assignees.some((a) => a.login.toLowerCase() === viewer)) {
        assignedPrs.push(`${repo.nameWithOwner}#${pr.number}  ${pr.title}`);
      }
      if (pr.reviewRequests.some((r) => r.login.toLowerCase() === viewer)) {
        reviewRequests.push(`${repo.nameWithOwner}#${pr.number}  ${pr.title}`);
      }
    }
    for (const iss of repo.issues.values()) {
      if (iss.state !== "OPEN") continue;
      if (iss.assignees.some((a) => a.login.toLowerCase() === viewer)) {
        assignedIssues.push(`${repo.nameWithOwner}#${iss.number}  ${iss.title}`);
      }
    }
  }

  await writeOut(
    [
      "Assigned Issues",
      ...(assignedIssues.length > 0 ? assignedIssues.map((x) => `  ${x}`) : ["  Nothing here ^_^"]),
      "",
      "Assigned Pull Requests",
      ...(assignedPrs.length > 0 ? assignedPrs.map((x) => `  ${x}`) : ["  Nothing here ^_^"]),
      "",
      "Review Requests",
      ...(reviewRequests.length > 0 ? reviewRequests.map((x) => `  ${x}`) : ["  Nothing here ^_^"]),
      "",
    ].join("\n")
  );
  return 0;
}

export async function handleBrowseCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, git, openBrowser, writeOut } = env;
  const schemas: FlagSchema[] = [
    { short: "n", long: "no-browser", type: "boolean" },
    { short: "b", long: "branch", type: "string" },
    { short: "c", long: "commit", type: "boolean" },
    { short: "p", long: "projects", type: "boolean" },
    { short: "r", long: "releases", type: "boolean" },
    { short: "s", long: "settings", type: "boolean" },
    { short: "w", long: "wiki", type: "boolean" },
  ];
  const parsed = parseCommandArgs(rawArgs, schemas);
  const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);
  const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
  const branch =
    getStringFlag(parsed, "branch") ??
    (gitRoot ? await readCurrentBranch(context, gitRoot, git) : repo.defaultBranchRef.name);

  let targetUrl = repo.url;
  const arg = parsed.positionals[0];
  if (getBoolFlag(parsed, "settings")) targetUrl = `${repo.url}/settings`;
  else if (getBoolFlag(parsed, "wiki")) targetUrl = `${repo.url}/wiki`;
  else if (getBoolFlag(parsed, "releases")) targetUrl = `${repo.url}/releases`;
  else if (getBoolFlag(parsed, "projects")) targetUrl = `${repo.url}/projects`;
  else if (getBoolFlag(parsed, "commit") && gitRoot) {
    const sha = await readHeadOid(context, gitRoot, git);
    targetUrl = `${repo.url}/commit/${sha}`;
  } else if (arg && /^\d+$/u.test(arg)) {
    const num = Number(arg);
    targetUrl = repo.pullRequests.has(num) ? `${repo.url}/pull/${num}` : `${repo.url}/issues/${num}`;
  } else if (arg) {
    targetUrl = `${repo.url}/blob/${branch}/${arg.replace(/^\/+/u, "")}`;
  } else if (parsed.flags.has("branch")) {
    targetUrl = `${repo.url}/tree/${branch}`;
  }

  if (!getBoolFlag(parsed, "no-browser") && openBrowser) {
    await openBrowser(targetUrl);
  }
  await writeOut(`${targetUrl}\n`);
  return 0;
}

export async function handleOrgCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut("Work with GitHub organizations.\n\nUSAGE\n  gh org <command> [flags]\n\nCORE COMMANDS\n  list: List organizations for the authenticated user\n");
    return 0;
  }
  if (subcommand === "list") {
    const schemas: FlagSchema[] = [{ short: "L", long: "limit", type: "string" }];
    const parsed = parseCommandArgs(rawArgs.slice(1), schemas);
    const limit = Number(getStringFlag(parsed, "limit") ?? "30");
    const orgs = [...backend.orgs].slice(0, limit);
    for (const org of orgs) {
      await writeOut(`${org}\n`);
    }
    return 0;
  }
  await writeErr(`unknown command "${subcommand}" for "gh org"\n`);
  return 1;
}

export async function handleRulesetCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut("View info about repo rulesets.\n\nUSAGE\n  gh ruleset <command> [flags]\n\nCORE COMMANDS\n  list:  List rulesets for a repository\n  view:  View info about a ruleset\n  check: View rules that would apply to a given branch\n");
    return 0;
  }
  const schemas: FlagSchema[] = [
    { short: "L", long: "limit", type: "string" },
    { short: "o", long: "org", type: "string" },
    { short: "w", long: "web", type: "boolean" },
    { long: "parents", type: "boolean" },
    { long: "default", type: "boolean" },
  ];
  const parsed = parseCommandArgs(rawArgs.slice(1), schemas);
  const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
  const repo = backend.getOrCreateRepo(coords.owner, coords.name);
  repo.rulesets ??= new Map([
    [
      1,
      {
        id: 1,
        name: "main-branch-protection",
        target: "branch",
        enforcement: "active",
        source: repo.nameWithOwner,
        rules: [{ type: "pull_request" }, { type: "required_status_checks" }],
      },
    ],
  ]);

  if (subcommand === "list") {
    for (const rs of repo.rulesets.values()) {
      await writeOut(`${rs.id}\t${rs.name}\t${rs.target}\t${rs.enforcement}\t${rs.rules.length}\n`);
    }
    return 0;
  }
  if (subcommand === "view") {
    const id = Number(parsed.positionals[0] ?? "1");
    const rs = repo.rulesets.get(id) ?? [...repo.rulesets.values()][0];
    if (!rs) {
      await writeErr(`ruleset ${id} not found\n`);
      return 1;
    }
    await writeOut(`Ruleset: ${rs.name} (ID: ${rs.id})\nTarget: ${rs.target}\nEnforcement: ${rs.enforcement}\nSource: ${rs.source}\nRules: ${rs.rules.map((r) => r.type).join(", ")}\n`);
    return 0;
  }
  if (subcommand === "check") {
    const branch = parsed.positionals[0] ?? repo.defaultBranchRef.name;
    await writeOut(`Rules applying to branch "${branch}" in ${repo.nameWithOwner}:\n- pull_request (main-branch-protection)\n- required_status_checks (main-branch-protection)\n`);
    return 0;
  }
  await writeErr(`unknown command "${subcommand}" for "gh ruleset"\n`);
  return 1;
}

export async function handleProjectCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut("Work with GitHub Projects.\n\nUSAGE\n  gh project <command> [flags]\n\nCORE COMMANDS\n  close\n  copy\n  create\n  delete\n  edit\n  field-create\n  field-delete\n  field-list\n  item-add\n  item-archive\n  item-create\n  item-delete\n  item-edit\n  item-list\n  link\n  list\n  mark-template\n  unlink\n  view\n");
    return 0;
  }
  const schemas: FlagSchema[] = [
    { long: "owner", type: "string" },
    { long: "title", type: "string" },
    { long: "description", type: "string" },
    { long: "short-description", type: "string" },
    { long: "readme", type: "string" },
    { long: "format", type: "string" },
    { long: "visibility", type: "string" },
    { long: "name", type: "string" },
    { long: "data-type", type: "string" },
    { long: "id", type: "string" },
    { long: "item-id", type: "string" },
    { long: "field-id", type: "string" },
    { long: "text", type: "string" },
    { long: "body", type: "string" },
    { long: "url", type: "string" },
    { long: "repo", type: "string" },
    { long: "undo", type: "boolean" },
    { short: "L", long: "limit", type: "string" },
    { short: "w", long: "web", type: "boolean" },
    { short: "q", long: "jq", type: "string" },
    { short: "t", long: "template", type: "string" },
  ];
  const parsed = parseCommandArgs(rawArgs.slice(1), schemas);
  const owner = getStringFlag(parsed, "owner") ?? backend.getActiveUser();
  const isJson = getStringFlag(parsed, "format") === "json";

  if (subcommand === "create") {
    const num = backend.projects.size + 1;
    const title = getStringFlag(parsed, "title") ?? `Project ${num}`;
    const proj = {
      number: num,
      id: `PVT_${num}`,
      title,
      shortDescription: getStringFlag(parsed, "short-description") ?? "",
      readme: getStringFlag(parsed, "readme") ?? "",
      public: getStringFlag(parsed, "visibility") === "PUBLIC",
      closed: false,
      isTemplate: false,
      owner,
      url: `https://${backend.defaultHost}/orgs/${owner}/projects/${num}`,
      fields: new Map([
        ["PVTF_1", { id: "PVTF_1", name: "Title", dataType: "TITLE" }],
        ["PVTF_2", { id: "PVTF_2", name: "Status", dataType: "SINGLE_SELECT" }],
      ]),
      items: new Map(),
      linkedRepos: new Set<string>(),
    };
    backend.projects.set(num, proj);
    if (isJson) {
      const out = await formatCommandOutput({ data: proj, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    await writeOut(`${proj.url}\n`);
    return 0;
  }

  if (subcommand === "list") {
    const list = [...backend.projects.values()];
    if (isJson) {
      const out = await formatCommandOutput({ data: { projects: list, totalCount: list.length }, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    for (const p of list) {
      await writeOut(`${p.number}\t${p.title}\t${p.closed ? "closed" : "open"}\t${p.id}\n`);
    }
    return 0;
  }

  const num = Number(parsed.positionals[0] ?? "1");
  let proj = backend.projects.get(num);
  if (!proj) {
    proj = {
      number: num,
      id: `PVT_${num}`,
      title: `Project ${num}`,
      shortDescription: "",
      readme: "",
      public: false,
      closed: false,
      isTemplate: false,
      owner,
      url: `https://${backend.defaultHost}/orgs/${owner}/projects/${num}`,
      fields: new Map([
        ["PVTF_1", { id: "PVTF_1", name: "Title", dataType: "TITLE" }],
        ["PVTF_2", { id: "PVTF_2", name: "Status", dataType: "SINGLE_SELECT" }],
      ]),
      items: new Map(),
      linkedRepos: new Set<string>(),
    };
    backend.projects.set(num, proj);
  }

  if (subcommand === "view") {
    if (isJson) {
      const out = await formatCommandOutput({ data: proj, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    await writeOut(`Title: ${proj.title}\nNumber: ${proj.number}\nID: ${proj.id}\nState: ${proj.closed ? "closed" : "open"}\nURL: ${proj.url}\n`);
    return 0;
  }
  if (subcommand === "edit") {
    if (parsed.flags.has("title")) proj.title = getStringFlag(parsed, "title")!;
    if (parsed.flags.has("short-description")) proj.shortDescription = getStringFlag(parsed, "short-description")!;
    if (parsed.flags.has("readme")) proj.readme = getStringFlag(parsed, "readme")!;
    await writeOut(`${proj.url}\n`);
    return 0;
  }
  if (subcommand === "close") {
    proj.closed = !getBoolFlag(parsed, "undo");
    await writeOut(`${proj.url}\n`);
    return 0;
  }
  if (subcommand === "delete") {
    backend.projects.delete(num);
    await writeOut(`Deleted project ${num}\n`);
    return 0;
  }
  if (subcommand === "field-list") {
    const fields = [...proj.fields.values()];
    if (isJson) {
      const out = await formatCommandOutput({ data: { fields, totalCount: fields.length }, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    for (const f of fields) {
      await writeOut(`${f.name}\t${f.dataType}\t${f.id}\n`);
    }
    return 0;
  }
  if (subcommand === "field-create") {
    const id = `PVTF_${proj.fields.size + 1}`;
    const f = {
      id,
      name: getStringFlag(parsed, "name") ?? "New Field",
      dataType: getStringFlag(parsed, "data-type") ?? "TEXT",
    };
    proj.fields.set(id, f);
    await writeOut(`${f.id}\n`);
    return 0;
  }
  if (subcommand === "field-delete") {
    const id = getStringFlag(parsed, "id") ?? parsed.positionals[0] ?? "";
    proj.fields.delete(id);
    await writeOut(`Deleted field ${id}\n`);
    return 0;
  }
  if (subcommand === "item-create" || subcommand === "item-add") {
    const id = `PVTI_${proj.items.size + 1}`;
    const item = {
      id,
      title: getStringFlag(parsed, "title") ?? getStringFlag(parsed, "url") ?? `Item ${proj.items.size + 1}`,
      body: getStringFlag(parsed, "body") ?? "",
      type: (subcommand === "item-add" ? "ISSUE" : "DRAFT_ISSUE") as "ISSUE" | "DRAFT_ISSUE",
      contentUrl: getStringFlag(parsed, "url"),
      fieldValues: {},
    };
    proj.items.set(id, item);
    if (isJson) {
      const out = await formatCommandOutput({ data: item, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    await writeOut(`Created item ${id}\n`);
    return 0;
  }
  if (subcommand === "item-list") {
    const items = [...proj.items.values()];
    if (isJson) {
      const out = await formatCommandOutput({ data: { items, totalCount: items.length }, jsonFlag: "", jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    for (const item of items) {
      await writeOut(`${item.type}\t${item.title}\t${item.id}\n`);
    }
    return 0;
  }
  if (subcommand === "item-edit") {
    const itemId = getStringFlag(parsed, "id") ?? parsed.positionals[0] ?? "PVTI_1";
    const item = proj.items.get(itemId);
    if (item) {
      if (parsed.flags.has("title")) item.title = getStringFlag(parsed, "title")!;
      if (parsed.flags.has("body")) item.body = getStringFlag(parsed, "body")!;
      if (parsed.flags.has("field-id") && parsed.flags.has("text")) {
        item.fieldValues[getStringFlag(parsed, "field-id")!] = getStringFlag(parsed, "text")!;
      }
    }
    await writeOut(`Edited item ${itemId}\n`);
    return 0;
  }
  if (subcommand === "item-archive") {
    const itemId = getStringFlag(parsed, "id") ?? parsed.positionals[0] ?? "PVTI_1";
    const item = proj.items.get(itemId);
    if (item) item.archived = !getBoolFlag(parsed, "undo");
    await writeOut(`Archived item ${itemId}\n`);
    return 0;
  }
  if (subcommand === "item-delete") {
    const itemId = getStringFlag(parsed, "id") ?? parsed.positionals[0] ?? "PVTI_1";
    proj.items.delete(itemId);
    await writeOut(`Deleted item ${itemId}\n`);
    return 0;
  }
  if (subcommand === "link" || subcommand === "unlink") {
    const repoName = getStringFlag(parsed, "repo") ?? "octocat/repo";
    if (subcommand === "link") proj.linkedRepos.add(repoName);
    else proj.linkedRepos.delete(repoName);
    await writeOut(`${subcommand === "link" ? "Linked" : "Unlinked"} ${repoName} to project ${proj.number}\n`);
    return 0;
  }
  if (subcommand === "mark-template") {
    proj.isTemplate = !getBoolFlag(parsed, "undo");
    await writeOut(`${proj.url}\n`);
    return 0;
  }
  if (subcommand === "copy") {
    const newNum = backend.projects.size + 1;
    const copyProj = { ...proj, number: newNum, id: `PVT_${newNum}`, title: getStringFlag(parsed, "title") ?? `${proj.title} (Copy)`, url: `https://${backend.defaultHost}/orgs/${owner}/projects/${newNum}` };
    backend.projects.set(newNum, copyProj);
    await writeOut(`${copyProj.url}\n`);
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh project"\n`);
  return 1;
}

export async function handleExtensionCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut("Manage gh extensions.\n\nUSAGE\n  gh extension <command> [flags]\n\nCORE COMMANDS\n  browse\n  create\n  exec\n  install\n  list\n  remove\n  search\n  upgrade\n");
    return 0;
  }
  const rest = rawArgs.slice(1);
  if (subcommand === "list") {
    for (const ext of backend.extensions.values()) {
      await writeOut(`${ext.name}\t${ext.repo}\t${ext.version}\n`);
    }
    return 0;
  }
  if (subcommand === "install") {
    const repo = rest[0] ?? "owner/gh-ext";
    const shortName = repo.split("/").pop() ?? "gh-ext";
    const name = shortName.startsWith("gh-") ? shortName : `gh-${shortName}`;
    backend.extensions.set(name, { name, repo, version: "v1.0.0" });
    await writeOut(`✓ Installed extension ${repo}\n`);
    return 0;
  }
  if (subcommand === "remove") {
    const raw = rest[0] ?? "";
    const name = raw.startsWith("gh-") ? raw : `gh-${raw}`;
    backend.extensions.delete(name);
    await writeOut(`✓ Removed extension ${name}\n`);
    return 0;
  }
  if (subcommand === "upgrade") {
    await writeOut("✓ Successfully upgraded extensions\n");
    return 0;
  }
  if (subcommand === "search") {
    await writeOut("Showing extensions matching query\ngh-dash\tdlhdr/gh-dash\tA dashboard for gh\n");
    return 0;
  }
  if (subcommand === "create" || subcommand === "exec" || subcommand === "browse") {
    await writeOut(`✓ Executed extension ${subcommand}\n`);
    return 0;
  }
  await writeErr(`unknown command "${subcommand}" for "gh extension"\n`);
  return 1;
}

export async function handleCodespaceCommand(
  env: MiscHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut("Connect to and manage codespaces.\n\nUSAGE\n  gh codespace <command> [flags]\n\nCORE COMMANDS\n  code\n  cp\n  create\n  delete\n  edit\n  jupyter\n  list\n  logs\n  ports\n  rebuild\n  ssh\n  stop\n  view\n");
    return 0;
  }
  const schemas: FlagSchema[] = [
    { short: "r", long: "repo", type: "string" },
    { short: "b", long: "branch", type: "string" },
    { short: "c", long: "codespace", type: "string" },
    { short: "m", long: "machine", type: "string" },
    { short: "d", long: "display-name", type: "string" },
    { long: "json", type: "string" },
    { short: "q", long: "jq", type: "string" },
    { short: "t", long: "template", type: "string" },
  ];
  const parsed = parseCommandArgs(rawArgs.slice(1), schemas);
  if (subcommand === "create") {
    const name = `codespace-${backend.codespaces.size + 1}`;
    const cs = {
      name,
      displayName: getStringFlag(parsed, "display-name") ?? name,
      repository: getStringFlag(parsed, "repo") ?? parsed.repoFlag ?? "octocat/repo",
      branch: getStringFlag(parsed, "branch") ?? "main",
      state: "Available" as const,
      machineName: getStringFlag(parsed, "machine") ?? "basicLinux32gb",
      createdAt: backend.isoNow(),
    };
    backend.codespaces.set(name, cs);
    await writeOut(`${cs.name}\n`);
    return 0;
  }
  if (subcommand === "list") {
    const list = [...backend.codespaces.values()];
    if (parsed.flags.has("json")) {
      const out = await formatCommandOutput({ data: list, availableFields: ["name", "displayName", "repository", "branch", "state", "machineName", "createdAt"], jsonFlag: getStringFlag(parsed, "json"), jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    for (const cs of list) {
      await writeOut(`${cs.name}\t${cs.displayName}\t${cs.repository}\t${cs.branch}\t${cs.state}\n`);
    }
    return 0;
  }
  if (subcommand === "delete") {
    const name = getStringFlag(parsed, "codespace") ?? parsed.positionals[0] ?? "";
    backend.codespaces.delete(name);
    await writeOut(`✓ Deleted codespace ${name}\n`);
    return 0;
  }
  if (subcommand === "stop") {
    const name = getStringFlag(parsed, "codespace") ?? parsed.positionals[0] ?? "";
    const cs = backend.codespaces.get(name);
    if (cs) cs.state = "Shutdown";
    await writeOut(`✓ Stopped codespace ${name}\n`);
    return 0;
  }
  if (subcommand === "view") {
    const name = getStringFlag(parsed, "codespace") ?? parsed.positionals[0] ?? [...backend.codespaces.keys()][0] ?? "codespace-1";
    const cs = backend.codespaces.get(name);
    if (!cs) {
      await writeErr(`codespace ${name} not found\n`);
      return 1;
    }
    if (parsed.flags.has("json")) {
      const out = await formatCommandOutput({ data: cs, availableFields: ["name", "displayName", "repository", "branch", "state", "machineName", "createdAt"], jsonFlag: getStringFlag(parsed, "json"), jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal, maxOutputBytes: env.limits.maxOutputBytes });
      await writeOut(out ?? "");
      return 0;
    }
    await writeOut(`Name: ${cs.name}\nRepository: ${cs.repository}\nBranch: ${cs.branch}\nState: ${cs.state}\n`);
    return 0;
  }
  await writeOut(`✓ Codespace ${subcommand} executed\n`);
  return 0;
}
