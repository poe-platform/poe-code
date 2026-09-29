import { resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext } from "safe-bash-contracts";
import {
  getBoolFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "../args.js";
import type { GitHubBackend } from "../backend.js";
import { decodeUtf8, encodeUtf8 } from "../crypto-ssh.js";
import { findGitRoot } from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type { GhHostAuthEntry, GhLimits } from "../types.js";

function getGhConfigDir(context: CommandContext): string {
  if (context.env.GH_CONFIG_DIR) {
    return resolvePath(context.cwd, context.env.GH_CONFIG_DIR);
  }
  const home = context.env.HOME || "/home/user";
  return `${home.replace(/\/+$/u, "")}/.config/gh`;
}

async function persistHostsConfig(context: CommandContext, backend: GitHubBackend): Promise<void> {
  const dir = getGhConfigDir(context);
  await context.fs.mkdir(dir, { recursive: true, signal: context.signal });
  const lines: string[] = [];
  for (const [host, entries] of Object.entries(backend.config.hosts)) {
    const active = entries.find((e) => e.active) ?? entries[0];
    if (!active) continue;
    lines.push(`${host}:`);
    lines.push(`    user: ${active.user}`);
    lines.push(`    oauth_token: ${active.oauthToken}`);
    lines.push(`    git_protocol: ${active.gitProtocol}`);
  }
  await context.fs.writeFile(`${dir}/hosts.yml`, encodeUtf8(lines.join("\n") + "\n"), {
    signal: context.signal,
  });
}

export interface AuthHandlerEnv {
  readonly limits: GhLimits;
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly stdinText: string;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handleAuthCommand(
  env: AuthHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, stdinText, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "Authenticate gh and git with GitHub.",
        "",
        "USAGE",
        "  gh auth <command> [flags]",
        "",
        "AVAILABLE COMMANDS",
        "  login:       Log in to a GitHub account",
        "  logout:      Log out of a GitHub account",
        "  refresh:     Refresh stored authentication credentials",
        "  setup-git:   Setup git with GitHub CLI",
        "  status:      View authentication status",
        "  switch:      Switch active GitHub account",
        "  token:       Print the authentication token gh is configured to use",
        "",
      ].join("\n")
    );
    return 0;
  }

  if (subcommand === "login") {
    const schemas: FlagSchema[] = [
      { long: "with-token", type: "boolean" },
      { short: "h", long: "hostname", type: "string" },
      { short: "p", long: "git-protocol", type: "string" },
      { short: "s", long: "scopes", type: "string[]" },
      { short: "u", long: "user", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const protocol = (getStringFlag(parsed, "git-protocol") ?? "https") as "https" | "ssh";
    const scopes = getStringArrayFlag(parsed, "scopes");
    const user = getStringFlag(parsed, "user") ?? backend.currentUser;

    let token = "gho_authenticated_token";
    if (getBoolFlag(parsed, "with-token")) {
      token = stdinText.trim();
      if (!token) {
        await writeErr("error: token required on standard input when using --with-token\n");
        return 1;
      }
    }

    const entries = backend.config.hosts[host] ?? [];
    for (const e of entries) e.active = false;
    const existing = entries.find((e) => e.user === user);
    if (existing) {
      existing.oauthToken = token;
      existing.gitProtocol = protocol;
      if (scopes.length > 0) existing.scopes = scopes;
      existing.active = true;
    } else {
      const entry: GhHostAuthEntry = {
        user,
        oauthToken: token,
        gitProtocol: protocol,
        scopes: scopes.length > 0 ? scopes : ["repo", "read:org", "workflow", "gist"],
        active: true,
      };
      entries.push(entry);
    }
    backend.config.hosts[host] = entries;
    backend.currentUser = user;
    backend.config.gitProtocol = protocol;
    await persistHostsConfig(context, backend);
    await writeOut(`✓ Logged in as ${user} on ${host}\n`);
    return 0;
  }

  if (subcommand === "logout") {
    const schemas: FlagSchema[] = [
      { short: "h", long: "hostname", type: "string" },
      { short: "u", long: "user", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const user = getStringFlag(parsed, "user");
    const entries = backend.config.hosts[host] ?? [];
    if (entries.length === 0) {
      await writeErr(`not logged in to ${host}\n`);
      return 1;
    }
    if (user) {
      backend.config.hosts[host] = entries.filter((e) => e.user !== user);
      if (backend.config.hosts[host]!.length > 0 && !backend.config.hosts[host]!.some((e) => e.active)) {
        backend.config.hosts[host]![0]!.active = true;
      }
    } else {
      delete backend.config.hosts[host];
    }
    await persistHostsConfig(context, backend);
    await writeOut(`✓ Logged out of ${host}${user ? ` account ${user}` : ""}\n`);
    return 0;
  }

  if (subcommand === "status") {
    const schemas: FlagSchema[] = [
      { short: "h", long: "hostname", type: "string" },
      { short: "t", long: "show-token", type: "boolean" },
      { short: "a", long: "active", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const hostFilter = getStringFlag(parsed, "hostname");
    const showToken = getBoolFlag(parsed, "show-token");
    const activeOnly = getBoolFlag(parsed, "active");

    const hosts = hostFilter ? [hostFilter] : Object.keys(backend.config.hosts);
    const statusEntries: Array<Record<string, unknown>> = [];
    const lines: string[] = [];

    for (const host of hosts) {
      const entries = (backend.config.hosts[host] ?? []).filter((e) => !activeOnly || e.active);
      if (entries.length === 0) continue;
      lines.push(host);
      for (const entry of entries) {
        const envToken = context.env.GH_TOKEN ?? context.env.GITHUB_TOKEN;
        const effectiveToken = envToken ?? entry.oauthToken;
        const maskedToken = showToken
          ? effectiveToken
          : `${effectiveToken.slice(0, 4)}${"*".repeat(Math.max(4, effectiveToken.length - 4))}`;
        lines.push(
          `  ✓ Logged in to ${host} account ${entry.user} (${envToken ? "GH_TOKEN" : "keyring"})`
        );
        lines.push(`  - Active account: ${entry.active}`);
        lines.push(`  - Git operations protocol: ${entry.gitProtocol}`);
        lines.push(`  - Token: ${maskedToken}`);
        lines.push(`  - Token scopes: '${entry.scopes.join("', '")}'`);
        statusEntries.push({
          host,
          login: entry.user,
          active: entry.active,
          state: "success",
          token: showToken ? effectiveToken : "",
          scopes: entry.scopes.join(", "),
          gitProtocol: entry.gitProtocol,
        });
      }
    }

    const formatted = await formatCommandOutput({
      data: { hosts: Object.fromEntries(hosts.map((h) => [h, statusEntries.filter((s) => s.host === h)])) },
      availableFields: ["hosts"],
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

    if (lines.length === 0) {
      await writeErr("You are not logged into any GitHub hosts. To log in, run: gh auth login\n");
      return 1;
    }
    await writeOut(lines.join("\n") + "\n");
    return 0;
  }

  if (subcommand === "token") {
    const schemas: FlagSchema[] = [
      { short: "h", long: "hostname", type: "string" },
      { short: "u", long: "user", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const user = getStringFlag(parsed, "user");
    const entries = backend.config.hosts[host] ?? [];
    const matched = user
      ? entries.find((e) => e.user === user)
      : (entries.find((e) => e.active) ?? entries[0]);
    const token = context.env.GH_TOKEN ?? context.env.GITHUB_TOKEN ?? matched?.oauthToken;
    if (!token) {
      await writeErr(`no oauth token found for ${host}\n`);
      return 1;
    }
    await writeOut(`${token}\n`);
    return 0;
  }

  if (subcommand === "switch") {
    const schemas: FlagSchema[] = [
      { short: "h", long: "hostname", type: "string" },
      { short: "u", long: "user", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const user = getStringFlag(parsed, "user");
    const entries = backend.config.hosts[host] ?? [];
    if (entries.length === 0) {
      await writeErr(`not logged in to ${host}\n`);
      return 1;
    }
    const target = user
      ? entries.find((e) => e.user === user)
      : entries.find((e) => !e.active) ?? entries[0];
    if (!target) {
      await writeErr(`no account "${user}" found on ${host}\n`);
      return 1;
    }
    for (const e of entries) e.active = e.user === target.user;
    backend.currentUser = target.user;
    await persistHostsConfig(context, backend);
    await writeOut(`✓ Switched active account for ${host} to ${target.user}\n`);
    return 0;
  }

  if (subcommand === "refresh") {
    const schemas: FlagSchema[] = [
      { short: "h", long: "hostname", type: "string" },
      { short: "s", long: "scopes", type: "string[]" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const scopes = getStringArrayFlag(parsed, "scopes");
    const entries = backend.config.hosts[host] ?? [];
    const active = entries.find((e) => e.active) ?? entries[0];
    if (active && scopes.length > 0) {
      active.scopes = Array.from(new Set([...active.scopes, ...scopes]));
    }
    await persistHostsConfig(context, backend);
    await writeOut(`✓ Authentication credentials refreshed for ${host}\n`);
    return 0;
  }

  if (subcommand === "setup-git") {
    const schemas: FlagSchema[] = [{ short: "h", long: "hostname", type: "string" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    const host = getStringFlag(parsed, "hostname") ?? backend.defaultHost;
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    if (gitRoot) {
      const cfgPath = `${gitRoot === "/" ? "" : gitRoot}/.git/config`;
      let existing = "";
      try {
        existing = decodeUtf8(await context.fs.readFile(cfgPath, { signal: context.signal }));
      } catch {
        existing = "";
      }
      const section = `\n[credential "https://${host}"]\n\thelper = !gh auth git-credential\n`;
      await context.fs.writeFile(cfgPath, encodeUtf8(existing + section), { signal: context.signal });
    }
    await writeOut(`✓ Configured git credential helper for ${host}\n`);
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh auth"\n`);
  return 1;
}
