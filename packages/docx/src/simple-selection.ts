import { validateDocxInvocation, type DocxInvocation } from "./command.js";
import { InvalidValueError } from "./archive.js";
import { UnsupportedEditError } from "./xml-write.js";
import { closedRecord, SelectionError, type Location, type LocationKind } from "./location-token.js";
import { docxOperationSchemas } from "./operation-schema.js";
import type { DocumentLocations, LocationQuery } from "./locations.js";
import type { DocumentScope } from "./location-index.js";

const resourceKinds: Readonly<Record<string, LocationKind>> = {
  lists: "paragraph", paragraphs: "paragraph", runs: "run", tables: "table", images: "image",
  headers: "story", footers: "story", text: "paragraph"
};

/** Resolve admitted input only; feature editors consume these revision-bound targets. */
export function resolveDocxSelection(document: DocumentLocations, value: DocxInvocation): readonly Location[] {
  closedRecord(value, ["operation", "inputs", "options", "sources"]);
  const invocation = validateDocxInvocation({ operation: value.operation, inputs: value.inputs, options: value.options });
  const { operation, options } = invocation;
  const resource = operation.split(".")[0]!;
  const inserting = operation.endsWith(".add");
  const targetKind = inserting && ["images", "runs"].includes(resource) ? "paragraph"
    : inserting && ["paragraphs", "tables", "lists"].includes(resource) ? "story"
    : operation === "text.get" && options.section === undefined ? "story" : resourceKinds[resource];
  if (!targetKind || ["link", "control", "revision", "shape", "field", "bookmark"].some(key => options[key] !== undefined))
    throw new UnsupportedEditError("This resource selector is not implemented.");
  const mutable = docxOperationSchemas[operation]!.mutates;
  const text = resource === "text";
  const query: LocationQuery = {
    scope: (resource === "headers" || resource === "footers" ? resource : options.scope ?? "body") as DocumentScope,
    ...(options.section !== undefined ? { section: options.section as number } : {}),
    ...(resource === "headers" || resource === "footers" ? { variant: (options.variant ?? "default") as "default" | "first" | "even" } : {})
  };
  let selected: readonly Location[];
  if (typeof options.select === "string") {
    const location = document.resolve(options.select);
    const acceptable = text ? ["story", "paragraph", "run", "table", "cell"]
      : inserting && ["paragraphs", "tables", "lists"].includes(resource) ? ["story", "cell", "paragraph"]
      : operation === "runs.set" && location.value.range !== null ? ["run", "paragraph"]
      : resource === "tables" ? ["table", "cell"] : [targetKind];
    if (!text && !["runs.set", "runs.add", "paragraphs.add", "tables.add"].includes(operation) && location.value.range !== null) throw new InvalidValueError("Whole resource operations require a resource token, not a text range.");
    if (!acceptable.includes(location.kind)) throw new SelectionError("missing-selection");
    if ((resource === "headers" || resource === "footers") &&
      !document.list("story", { scope: resource }).some(story => story.token === location.token))
      throw new SelectionError("missing-selection");
    if (operation === "tables.set" && options.text !== undefined && location.kind !== "cell")
      throw new InvalidValueError("Scalar table text requires a logical cell selection.");
    selected = [location];
  } else {
    let owner: Location | undefined;
    const stories = options.note !== undefined || options.comment !== undefined;
    if (stories) {
      const scope = options.comment !== undefined ? "comments" : options.scope;
      if (scope !== "comments" && scope !== "footnotes" && scope !== "endnotes")
        throw new InvalidValueError("Note selection requires an explicit footnotes or endnotes scope.");
      owner = document.at("story", (options.comment ?? options.note) as number, { scope });
    }
    for (const kind of ["table", "cell", "paragraph", "run", "image"] as const) {
      if (options[kind] === undefined) continue;
      if (kind === "cell") owner = document.cell(owner!.token, options.cell as string);
      else owner = document.at(kind, options[kind] as number, owner ? { owner: owner.token } : query);
    }
    if (owner) {
      if (text || inserting || owner.kind === targetKind || resource === "tables" && owner.kind === "cell") selected = [owner];
      else selected = document.list(targetKind, { owner: owner.token });
    } else selected = document.list(targetKind, query);
  }
  // Text cardinality selects matches after the editor builds its logical text map.
  if (!text) {
    const local = new Map(selected.map(location => [location.token, location]));
    selected = document.select(selected, {
      ...(options.all !== undefined ? { all: options.all as boolean } : {}),
      ...(mutable && options.allowEmpty !== undefined ? { allowEmpty: options.allowEmpty as boolean } : {})
    }, mutable || operation.endsWith(".get") ? "mutation" : "read").map(location => local.get(location.token)!);
  }
  const unlinkSection = (resource === "headers" || resource === "footers") &&
    options.linkToPrevious === false && options.section !== undefined;
  if (!text && mutable && options.shared !== true && !unlinkSection && selected.some(location => document.references(location.token).length > 1))
    throw new SelectionError("ambiguous-selection", selected.map(location => location.token));
  if (resource === "images" && options.shared === true) {
    const expanded = new Map<string, Location>();
    for (const location of selected) for (const occurrence of document.sharedImages(location.token)) expanded.set(occurrence.token, occurrence);
    selected = [...expanded.values()];
  }
  return Object.freeze([...selected]);
}
