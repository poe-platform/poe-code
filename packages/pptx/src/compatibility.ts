import { SaxesParser } from "saxes";
import { OfficeError } from "./errors.js";
import type { XmlAttribute, XmlElement, XmlMerge, XmlPart, XmlName } from "./xml.js";

export interface CompatibilityView {
  readonly part: XmlPart;
  readonly dialect: "strict" | "transitional" | null;
  readonly alternatives: readonly {
    readonly element: XmlElement;
    readonly selected: XmlElement | null;
  }[];
  children(element: XmlElement): readonly XmlElement[];
  attributes(element: XmlElement): readonly XmlAttribute[];
  merge(element: XmlElement, update: XmlMerge): CompatibilityView;
}

const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const xml = "http://www.w3.org/XML/1998/namespace";
const dialects = new Map<string, "strict" | "transitional">([
  ["http://purl.oclc.org/ooxml/presentationml/main", "strict"],
  ["http://purl.oclc.org/ooxml/drawingml/main", "strict"],
  ["http://schemas.openxmlformats.org/presentationml/2006/main", "transitional"],
  ["http://schemas.openxmlformats.org/drawingml/2006/main", "transitional"]
]);

function invalid(): never {
  throw new OfficeError("invalid-xml", "Invalid markup compatibility controls.", "parse");
}
function unsupported(): never {
  throw new OfficeError(
    "unsupported-profile",
    "Required XML namespace is not understood.",
    "parse"
  );
}
function tokens(value: string): string[] {
  const result: string[] = [];
  let token = "";
  for (const character of value) {
    if (" \t\r\n".includes(character)) {
      if (token) result.push(token);
      token = "";
    } else token += character;
  }
  if (token) result.push(token);
  return result;
}
function validLocalName(value: string): void {
  if (!value || value.includes(":")) invalid();
  const parser = new SaxesParser();
  let count = 0;
  parser.on("error", invalid);
  parser.on("opentag", (tag) => {
    if (++count !== 1 || tag.name !== value || Object.keys(tag.attributes).length) invalid();
  });
  parser.write(`<${value}/>`).close();
}
interface Rules {
  readonly ignorable: ReadonlySet<string>;
  readonly process: ReadonlySet<string>;
}

export function interpretCompatibility(
  part: XmlPart,
  understoodNamespaces: readonly string[],
  opaqueElements: readonly XmlName[] = []
): CompatibilityView {
  if (
    !Array.isArray(understoodNamespaces) ||
    understoodNamespaces.some((uri) => typeof uri !== "string" || !uri)
  )
    throw new OfficeError("invalid-value", "Expected understood namespace URIs.", "usage");
  if (
    !Array.isArray(opaqueElements) ||
    opaqueElements.some(
      (name) =>
        !name ||
        typeof name.namespace !== "string" ||
        typeof name.localName !== "string" ||
        !name.localName ||
        !understoodNamespaces.includes(name.namespace)
    )
  )
    throw new OfficeError("invalid-value", "Expected understood opaque element names.", "usage");
  const opaque = opaqueElements.map((name) => Object.freeze({ ...name }));
  const supplied = [...understoodNamespaces];
  const understood = new Set(["", xml, mc, ...supplied]);
  const children = new Map<XmlElement, readonly XmlElement[]>();
  const attributes = new Map<XmlElement, readonly XmlAttribute[]>();
  const alternatives: { element: XmlElement; selected: XmlElement | null }[] = [];
  const preserved: string[] = [];
  const scan = [part.root];
  while (scan.length) {
    const element = scan.pop()!;
    if (element.name.namespace === mc && element.name.localName === "AlternateContent") {
      preserved.push(part.markup(element));
    } else scan.push(...[...element.children].reverse());
  }

  function prefixUri(element: XmlElement, prefix: string): string {
    validLocalName(prefix);
    const uri = part.resolveNamespace(element, prefix);
    if (!uri || uri === mc) invalid();
    return uri;
  }
  function rules(element: XmlElement, inherited: Rules): Rules {
    const ignorable = new Set(inherited.ignorable);
    const process = new Set(inherited.process);
    const controls = new Map<string, string>();
    for (const attribute of element.attributes) {
      if (attribute.name.namespace === mc) {
        if (
          ![
            "Ignorable",
            "MustUnderstand",
            "ProcessContent",
            "PreserveElements",
            "PreserveAttributes"
          ].includes(attribute.name.localName)
        )
          invalid();
        controls.set(attribute.name.localName, attribute.value);
      }
    }
    for (const prefix of tokens(controls.get("Ignorable") ?? ""))
      ignorable.add(prefixUri(element, prefix));
    for (const prefix of tokens(controls.get("MustUnderstand") ?? "")) prefixUri(element, prefix);
    for (const control of ["ProcessContent", "PreserveElements", "PreserveAttributes"]) {
      for (const token of tokens(controls.get(control) ?? "")) {
        const names = token.split(":");
        if (names.length !== 2) invalid();
        const uri = prefixUri(element, names[0]!);
        const local = names[1]!;
        if (local !== "*") validLocalName(local);
        if (!ignorable.has(uri)) invalid();
        if (control === "ProcessContent") process.add(JSON.stringify([uri, local]));
      }
    }
    return { ignorable, process };
  }
  function mustUnderstand(element: XmlElement): void {
    const declaration = element.attributes.find(
      (attribute) =>
        attribute.name.namespace === mc && attribute.name.localName === "MustUnderstand"
    );
    for (const prefix of tokens(declaration?.value ?? "")) {
      if (!understood.has(prefixUri(element, prefix))) unsupported();
    }
  }
  function wrapperAttributes(element: XmlElement, context: Rules): void {
    for (const attribute of element.attributes) {
      const uri = attribute.name.namespace;
      if (uri === xml || (uri && uri !== mc && !context.ignorable.has(uri))) invalid();
      if (!uri && !(element.name.localName === "Choice" && attribute.name.localName === "Requires"))
        invalid();
    }
  }
  function checkedAttributes(element: XmlElement, context: Rules): readonly XmlAttribute[] {
    const result: XmlAttribute[] = [];
    for (const attribute of element.attributes) {
      const uri = attribute.name.namespace;
      if (uri === mc) continue;
      if (!understood.has(uri)) {
        if (!context.ignorable.has(uri)) unsupported();
        continue;
      }
      result.push(attribute);
    }
    return Object.freeze(result);
  }

  type Task = {
    element: XmlElement;
    inherited: Rules;
    output: XmlElement[];
    branch?: boolean;
    finish?: boolean;
  };
  const rootOutput: XmlElement[] = [];
  const tasks: Task[] = [
    {
      element: part.root,
      inherited: { ignorable: new Set(), process: new Set() },
      output: rootOutput
    }
  ];
  while (tasks.length) {
    const task = tasks.pop()!;
    const { element, inherited, output } = task;
    if (task.finish) {
      Object.freeze(children.get(element));
      continue;
    }
    const context = rules(element, inherited);
    if (element.name.namespace === mc && !task.branch) {
      if (element.name.localName !== "AlternateContent") invalid();
      wrapperAttributes(element, context);
      mustUnderstand(element);
      let selected: XmlElement | null = null;
      let fallback = false;
      let choices = 0;
      for (const branch of element.children) {
        const branchRules = rules(branch, context);
        if (branch.name.namespace !== mc) {
          if (!branchRules.ignorable.has(branch.name.namespace)) invalid();
          if (
            understood.has(branch.name.namespace) ||
            branchRules.process.has(
              JSON.stringify([branch.name.namespace, branch.name.localName])
            ) ||
            branchRules.process.has(JSON.stringify([branch.name.namespace, "*"]))
          )
            unsupported();
          continue;
        }
        wrapperAttributes(branch, branchRules);
        const branchAttributes = checkedAttributes(branch, branchRules);
        if (branch.name.localName === "Choice" && !fallback) {
          choices++;
          const requires = branchAttributes.find(
            (attribute) => !attribute.name.namespace && attribute.name.localName === "Requires"
          );
          if (!requires) invalid();
          const prefixes = tokens(requires.value);
          if (!prefixes.length) invalid();
          const namespaces = prefixes.map((prefix) => prefixUri(branch, prefix));
          if (
            branchAttributes.some(
              (attribute) => !attribute.name.namespace && attribute.name.localName !== "Requires"
            )
          )
            invalid();
          if (!selected && namespaces.every((uri) => understood.has(uri))) selected = branch;
        } else if (branch.name.localName === "Fallback" && !fallback && choices) {
          fallback = true;
          if (branchAttributes.some((attribute) => !attribute.name.namespace)) invalid();
          if (!selected) selected = branch;
        } else invalid();
      }
      if (!choices) invalid();
      alternatives.push(Object.freeze({ element, selected }));
      if (selected) {
        mustUnderstand(selected);
        tasks.push({ element: selected, inherited: context, output, branch: true });
      }
      continue;
    }
    let destination = output;
    if (!task.branch) {
      const uri = element.name.namespace;
      if (!understood.has(uri)) {
        if (!context.ignorable.has(uri)) unsupported();
        if (
          !context.process.has(JSON.stringify([uri, element.name.localName])) &&
          !context.process.has(JSON.stringify([uri, "*"]))
        )
          continue;
        if (
          element.attributes.some(
            (attribute) =>
              attribute.name.namespace === xml &&
              ["base", "lang", "space"].includes(attribute.name.localName)
          )
        )
          invalid();
        mustUnderstand(element);
      } else {
        mustUnderstand(element);
        attributes.set(element, checkedAttributes(element, context));
        output.push(element);
        destination = [];
        children.set(element, destination);
        tasks.push({ ...task, finish: true });
      }
    }
    if (
      opaque.some(
        (name) =>
          name.namespace === element.name.namespace && name.localName === element.name.localName
      )
    )
      continue;
    for (const child of [...element.children].reverse())
      tasks.push({ element: child, inherited: context, output: destination });
  }
  const dialect = dialects.get(part.root.name.namespace) ?? null;
  return Object.freeze({
    part,
    dialect,
    alternatives: Object.freeze(alternatives),
    children(element: XmlElement): readonly XmlElement[] {
      const result = children.get(element);
      if (!result)
        throw new OfficeError("invalid-value", "Expected a processed XML element.", "usage");
      return result;
    },
    attributes(element: XmlElement): readonly XmlAttribute[] {
      const result = attributes.get(element);
      if (!result)
        throw new OfficeError("invalid-value", "Expected a processed XML element.", "usage");
      return result;
    },
    merge(element: XmlElement, update: XmlMerge): CompatibilityView {
      if (!children.has(element))
        throw new OfficeError(
          "unsupported-edit",
          "Only processed XML elements can be edited.",
          "validate-intent"
        );
      const edited = part.merge(element, update);
      const found: string[] = [];
      const scan = [edited.root];
      while (scan.length) {
        const candidate = scan.pop()!;
        if (candidate.name.namespace === mc && candidate.name.localName === "AlternateContent")
          found.push(edited.markup(candidate));
        else scan.push(...[...candidate.children].reverse());
      }
      if (
        found.length !== preserved.length ||
        found.some((value, index) => value !== preserved[index])
      )
        throw new OfficeError(
          "unsupported-edit",
          "Alternate representations require synchronized editing.",
          "validate-intent"
        );
      return interpretCompatibility(edited, supplied, opaque);
    }
  });
}
