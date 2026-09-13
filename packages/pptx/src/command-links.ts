import { readPackage } from "./package-reader.js";
import { parseXmlPart } from "./xml.js";
import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { linkSchemas } from "./links-schema.js";
import { listLinks, setLink, removeLink, isOrdinaryLinkUrl } from "./links.js";
import { readShapes } from "./shape-operations.js";
import { SelectionError, type SelectionQuery } from "./selectors.js";
export interface LinkArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  shape?: string;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  all?: boolean;
  allowEmpty?: boolean;
  linkEdit?: {
    url?: string;
    targetSlide?: number;
    action?: string;
    trigger?: string;
    sanitize?: boolean;
    path?: readonly number[];
  };
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateLinkCommand(
  args: LinkArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(linkSchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag))) usage("Option does not apply to links.");
  if (positionals.length !== 1 || !positionals[0]) usage("Links require exactly one input.");
  args.input = positionals[0];
  if (args.scope !== undefined && args.scope !== "slides") usage("Links support slides scope.");
  if (args.token && ["--slide", "--shape", "--scope"].some((flag) => seen.has(flag)))
    usage("Opaque and simple selectors cannot be combined.");
  if (args.shape !== undefined && args.slide === undefined)
    usage("Shape selection requires a slide.");
  const edit = args.linkEdit ?? {};
  if (edit.trigger !== undefined && !["click", "hover"].includes(edit.trigger))
    usage("Unsupported link trigger.");
  if (
    edit.path !== undefined &&
    (!Array.isArray(edit.path) ||
      edit.path.some((value) => !Number.isSafeInteger(value) || value < 0))
  )
    usage("Link path requires an array of nonnegative integer child positions.");
  if (["links.list", "links.get"].includes(args.operation)) return;
  if (!args.token && args.slide === undefined && !args.all)
    usage("Link mutation requires explicit selection.");
  if (args.operation !== "links.remove") {
    const url = edit.url !== undefined,
      slide = edit.targetSlide !== undefined;
    if (
      Number(url) +
        Number(slide) +
        Number(
          !url &&
            !slide &&
            ["next", "previous", "first", "last", "last-viewed", "end-show"].includes(
              edit.action ?? ""
            )
        ) !==
      1
    )
      usage("Provide exactly one link destination.");
    if (
      url &&
      (!isOrdinaryLinkUrl(edit.url!) || (edit.action !== undefined && edit.action !== "url"))
    )
      usage("URL action must agree with its destination.");
    if (slide && edit.action !== undefined && edit.action !== "slide")
      usage("Slide action must agree with its destination.");
  }
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
const actionNames = {
  url: "hyperlink",
  slide: "slide",
  next: "next-slide",
  previous: "previous-slide",
  first: "first-slide",
  last: "last-slide",
  "last-viewed": "last-slide-viewed",
  "end-show": "end-show"
} as const;
export async function executeLinkCommand(
  args: LinkArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  const original = await request.readInput(
    args.input!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  );
  const shapeOptions = {
    scope: "slides" as const,
    ...(args.token ? { select: args.token } : {}),
    ...(args.slide === undefined ? {} : { slide: args.slide }),
    ...(args.shape === undefined ? {} : { shape: args.shape })
  };
  const shapes = await readShapes(original, shapeOptions, context);
  const selections: SelectionQuery[] = shapes.map((shape) => ({
    kind: "object",
    scope: "slides",
    owner: shape.part,
    id: shape.location.objectId
  }));
  const edit = args.linkEdit ?? {};
  const trigger = (edit.trigger ?? "click") as "click" | "hover";
  let links =
    args.token || args.slide !== undefined || args.shape !== undefined
      ? (
          await Promise.all(
            selections.map((selection) => listLinks(original, { selection }, context))
          )
        ).flat()
      : await listLinks(original, {}, context);
  if (edit.path !== undefined)
    links = links.filter(
      (link) =>
        link.path.length - 1 === edit.path!.length &&
        link.path.slice(0, -1).every((position, i) => position === edit.path![i])
    );
  if (edit.trigger !== undefined) links = links.filter((link) => link.trigger === trigger);
  if (["links.list", "links.get"].includes(args.operation)) {
    if (args.operation === "links.get" && links.length !== 1)
      throw new SelectionError(links.length ? "ambiguous-selection" : "missing-selection");
    return {
      result: {
        version: 1,
        operation: args.operation,
        ok: true,
        data: { links: links.map((link) => ({ ...link, parentPath: link.path.slice(0, -1) })) },
        affected: 0,
        warnings: links.some((link) => link.requiresSanitization)
          ? [
              {
                code: "active-content",
                message: "Unsupported active actions are inert and require explicit sanitization.",
                context: { phase: "index" }
              }
            ]
          : [],
        errors: [],
        locations: shapes.map((shape) => shape.location)
      },
      human:
        links.map((link) => `${link.kind}: ${link.url ?? link.action ?? ""}`).join("\n") +
        (links.length ? "\n" : "")
    };
  }
  const selectedLinks = links.filter((link) => link.trigger === trigger);
  const jobs =
    args.operation === "links.remove"
      ? selectedLinks.map((link) => ({
          selection: {
            kind: "object" as const,
            scope: "slides" as const,
            owner: link.part,
            id: link.shapeId!
          },
          path: link.path.slice(0, -1),
          location: link.location
        }))
      : selections.map((selection, i) => ({
          selection,
          path: edit.path,
          location: shapes[i]!.location
        }));
  if (!jobs.length && !args.allowEmpty) throw new SelectionError("missing-selection");
  if (jobs.length > 1 && !args.all) throw new SelectionError("ambiguous-selection");
  const existingShapeLinks = new Set<string>();
  if (args.operation === "links.add" && edit.path === undefined) {
    const reader = await readPackage(original, context);
    for (const link of selectedLinks) {
      let parent = parseXmlPart(reader.get(link.part), context.xmlLimits).root;
      for (const position of link.path.slice(0, -1)) parent = parent.children[position]!;
      if (parent.name.localName === "cNvPr")
        existingShapeLinks.add(JSON.stringify([link.part, link.shapeId]));
    }
  }
  let changed = original;
  for (const { selection, path } of jobs) {
    if (
      args.operation === "links.add" &&
      selectedLinks.some(
        (link) =>
          link.part === selection.owner &&
          link.shapeId === selection.id &&
          (path
            ? link.path.length === path.length + 1 &&
              path.every((position, i) => link.path[i] === position)
            : existingShapeLinks.has(JSON.stringify([link.part, link.shapeId])))
      )
    )
      throw new OfficeError(
        "unsupported-edit",
        "Selected trigger already contains a link.",
        "validate-intent"
      );
    changed =
      args.operation === "links.remove"
        ? await removeLink(
            changed,
            { selection, trigger, ...(path ? { path } : {}), sanitize: edit.sanitize ?? false },
            context
          )
        : await setLink(
            changed,
            {
              selection,
              trigger,
              ...(path ? { path } : {}),
              ...(edit.url === undefined ? {} : { url: edit.url }),
              ...(edit.targetSlide === undefined ? {} : { targetSlide: edit.targetSlide }),
              ...(edit.action === undefined
                ? {}
                : { action: actionNames[edit.action as keyof typeof actionNames] })
            },
            context
          );
  }
  const dryRun = args.dryRun ?? false;
  const destination = args.inPlace ? args.input! : args.output;
  if (destination && destination !== "-" && !request.publishOutput)
    throw Object.assign(new Error("Output publication capability is unavailable."), {
      code: "publication-unsupported"
    });
  return {
    result: {
      version: 1,
      operation: args.operation,
      ok: true,
      data: { dryRun },
      affected: jobs.length,
      warnings: [],
      errors: [],
      locations: jobs.map((job) => job.location)
    },
    human: `${dryRun ? "Validated" : "Updated"} ${jobs.length} link(s)\n`,
    ...(destination === "-" && !dryRun ? { binary: changed } : {}),
    ...(destination && destination !== "-"
      ? {
          publication: {
            inputPath: args.input!,
            outputPath: destination,
            bytes: changed,
            originalBytes: original,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
