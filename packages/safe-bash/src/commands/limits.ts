import { settings, type ArchiveLimits } from "./archive/internal.js";
import { settings as htmlSettings, type HtmlToMarkdownLimits } from "./html-to-markdown/options.js";
import { settings as splitSettings, type SplitLimits } from "./split/options.js";

/** Invocation ceilings; command registration may impose tighter limits. */
export interface CommandFamilyLimits {
  readonly archive?: Partial<ArchiveLimits>;
  readonly htmlToMarkdown?: Partial<HtmlToMarkdownLimits>;
  readonly split?: Partial<SplitLimits>;
}

export function resolveCommandLimits(...profiles: (CommandFamilyLimits | undefined)[]): CommandFamilyLimits | undefined {
  let archive: Partial<ArchiveLimits> | undefined;
  let htmlToMarkdown: Partial<HtmlToMarkdownLimits> | undefined;
  let split: Partial<SplitLimits> | undefined;
  for (const profile of profiles) {
    if (profile === undefined) continue;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)
      || Object.keys(profile).some(key => key !== "archive" && key !== "htmlToMarkdown" && key !== "split")) throw new RangeError("Invalid command-family limits");
    if (profile.split !== undefined) {
      if (!profile.split || typeof profile.split !== "object" || Array.isArray(profile.split)) throw new RangeError("Invalid split limits");
      splitSettings({ limits: profile.split });
      split = { ...split, ...profile.split };
    }
    if (profile.htmlToMarkdown !== undefined) {
      if (!profile.htmlToMarkdown || typeof profile.htmlToMarkdown !== "object" || Array.isArray(profile.htmlToMarkdown)) throw new RangeError("Invalid html-to-markdown limits");
      htmlSettings({ limits: profile.htmlToMarkdown });
      htmlToMarkdown = { ...htmlToMarkdown, ...profile.htmlToMarkdown };
    }
    if (profile.archive === undefined) continue;
    if (!profile.archive || typeof profile.archive !== "object" || Array.isArray(profile.archive)) throw new RangeError("Invalid archive limits");
    settings({ limits: profile.archive });
    archive = { ...archive, ...profile.archive };
  }
  return archive === undefined && htmlToMarkdown === undefined && split === undefined ? undefined : Object.freeze({
    ...(split === undefined ? {} : { split: Object.freeze(split) }),
    ...(archive === undefined ? {} : { archive: Object.freeze(archive) }),
    ...(htmlToMarkdown === undefined ? {} : { htmlToMarkdown: Object.freeze(htmlToMarkdown) }),
  });
}
