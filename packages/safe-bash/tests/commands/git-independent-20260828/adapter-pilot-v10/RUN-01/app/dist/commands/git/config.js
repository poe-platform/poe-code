import { GIT_LIMITS, demand } from "./limits.js";
function boolean(value) {
    const normalized = value.toLowerCase();
    demand(["true", "false", "yes", "no", "on", "off", "1", "0", ""].includes(normalized), "invalid Git config boolean");
    return ["true", "yes", "on", "1"].includes(normalized);
}
function unquote(value) {
    let output = "";
    let quoted = false;
    for (let offset = 0; offset < value.length; offset++) {
        const character = value[offset];
        if (character === "\\") {
            const next = value[++offset];
            demand(next !== undefined && ['n', 't', 'b', '"', '\\'].includes(next), "unsupported Git config escape/continuation");
            output += next === "n" ? "\n" : next === "t" ? "\t" : next === "b" ? "\b" : next;
        }
        else if (character === '"')
            quoted = !quoted;
        else if (!quoted && (character === "#" || character === ";"))
            break;
        else
            output += character;
    }
    demand(!quoted, "unterminated Git config quote");
    return output.trim();
}
export async function configuration(session, gitdir, bare) {
    const bytes = await session.read(session.path(gitdir, "config"), GIT_LIMITS.maxMetadataBytes, true, true);
    let fileMode = true;
    if (!bytes)
        return { bare, fileMode };
    try {
        const text = session.text(bytes);
        demand(!text.includes("\0"), "NUL in Git config");
        session.reserve(bytes.length * 2);
        const values = new Map();
        let section = "";
        for (const raw of text.split("\n")) {
            await session.step(raw.length + 1);
            demand(raw.length <= GIT_LIMITS.maxPathBytes, "Git config line too long");
            const line = raw.trim();
            if (!line || line.startsWith("#") || line.startsWith(";"))
                continue;
            if (line.startsWith("[")) {
                const match = /^\[([A-Za-z][A-Za-z0-9-]*)(?:[ \t]+"([^"\r\n]+)")?\][ \t]*(?:[#;].*)?$/.exec(line);
                demand(match, "unsupported Git config section");
                section = match[1].toLowerCase() + (match[2] === undefined ? "" : "." + match[2]);
            }
            else {
                const match = /^([A-Za-z][A-Za-z0-9-]*)(?:[ \t]*=[ \t]*(.*))?$/.exec(line);
                demand(section && match, "invalid Git config key");
                values.set(section + "." + match[1].toLowerCase(), match[2] === undefined ? "true" : unquote(match[2]));
            }
        }
        for (const [key, value] of values) {
            await session.step();
            if (key === "core.repositoryformatversion")
                demand(value === "0", "unsupported Git repository format");
            else if (key === "core.bare")
                demand(boolean(value) === bare, "Git bare/layout mismatch");
            else if (key === "core.filemode")
                fileMode = boolean(value);
            else if (["core.symlinks", "core.quotepath", "status.relativepaths"].includes(key))
                demand(boolean(value), `unsupported Git ${key}`);
            else if (["core.ignorecase", "core.precomposeunicode", "core.autocrlf", "core.safecrlf", "diff.renames", "status.renames"].includes(key))
                demand(!boolean(value), `unsupported Git ${key}`);
            else if (key === "core.eol")
                demand(value === "lf", "unsupported Git core.eol");
            else if (key === "core.abbrev")
                demand(value === "7", "unsupported Git core.abbrev");
            else if (key === "diff.context")
                demand(value === "3", "unsupported Git diff.context");
            else if (key === "core.logallrefupdates")
                boolean(value);
            else if (key === "user.name" || key === "user.email" || /^remote\..+\.(url|fetch|pushurl)$/.test(key) || /^branch\..+\.(remote|merge|description)$/.test(key))
                continue;
            else
                demand(false, `unsupported Git config: ${key}`);
        }
        return { bare, fileMode };
    }
    finally {
        session.release(bytes);
    }
}
export function environment(values) {
    for (const key of Object.keys(values)) {
        if (!key.startsWith("GIT_"))
            continue;
        const value = values[key];
        if (key === "GIT_OPTIONAL_LOCKS" && (value === "0" || value === "1"))
            continue;
        if (key === "GIT_PAGER" && (value === "" || value === "cat"))
            continue;
        if (key === "GIT_TERMINAL_PROMPT" && value === "0")
            continue;
        demand(false, `unsupported virtual Git environment: ${key}`);
    }
}
//# sourceMappingURL=config.js.map