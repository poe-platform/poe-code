import { OfficeError } from "./errors.js";
import type { LinkData } from "./links.js";
import { isOrdinaryLinkUrl } from "./links.js";
import type { XmlPart } from "./xml.js";

const values = {
  END_SHOW: 6,
  FIRST_SLIDE: 3,
  HYPERLINK: 7,
  LAST_SLIDE: 4,
  LAST_SLIDE_VIEWED: 5,
  NAMED_SLIDE: 101,
  NAMED_SLIDE_SHOW: 10,
  NEXT_SLIDE: 1,
  NONE: 0,
  OPEN_FILE: 102,
  OLE_VERB: 11,
  PLAY: 12,
  PREVIOUS_SLIDE: 2,
  RUN_MACRO: 8,
  RUN_PROGRAM: 9
} as const;
type ActionName = keyof typeof values;
export type ActionValue = { readonly name: ActionName; readonly value: number };
export const PP_ACTION_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, Object.freeze({ name, value })])
  )
) as { readonly [K in ActionName]: { readonly name: K; readonly value: (typeof values)[K] } };
export const PP_ACTION = PP_ACTION_TYPE;

export interface LinkModelOwner<Slide> {
  readonly part: XmlPart;
  readonly slides: readonly Slide[];
  readonly slide: Slide;
  read(): LinkData | null;
  set(value: { readonly url?: string; readonly targetSlide?: number }): void;
  remove(): void;
}
const verbs: Readonly<Record<string, ActionName>> = {
  hlinksldjump: "NAMED_SLIDE",
  hlinkfile: "OPEN_FILE",
  hlinkpres: "PLAY",
  customshow: "NAMED_SLIDE_SHOW",
  ole: "OLE_VERB",
  macro: "RUN_MACRO",
  program: "RUN_PROGRAM"
};
const jumps: Readonly<Record<string, ActionName>> = {
  firstslide: "FIRST_SLIDE",
  lastslide: "LAST_SLIDE",
  nextslide: "NEXT_SLIDE",
  previousslide: "PREVIOUS_SLIDE",
  endshow: "END_SHOW",
  lastslideviewed: "LAST_SLIDE_VIEWED"
};
function editable(link: LinkData | null): void {
  if (link?.requiresSanitization)
    throw new OfficeError(
      "unsupported-edit",
      "Remove the unsupported action with explicit sanitization first.",
      "validate-intent"
    );
}

export class Hyperlink<Slide = unknown> {
  readonly #owner: LinkModelOwner<Slide>;
  constructor(owner: LinkModelOwner<Slide>) {
    this.#owner = owner;
  }
  get part(): XmlPart {
    return this.#owner.part;
  }
  get address(): string | null {
    const link = this.#owner.read();
    return link?.url ?? link?.targetReference ?? null;
  }
  set address(value: string | null) {
    editable(this.#owner.read());
    if (value === null || value === "") {
      this.#owner.remove();
      return;
    }
    if (!isOrdinaryLinkUrl(value))
      throw new OfficeError("invalid-value", "An ordinary inert URL is required.", "usage");
    this.#owner.set({ url: value });
  }
}
export { Hyperlink as _Hyperlink };

export class ActionSetting<Slide = unknown> {
  readonly #owner: LinkModelOwner<Slide>;
  readonly #hyperlink: Hyperlink<Slide>;
  constructor(owner: LinkModelOwner<Slide>) {
    this.#owner = owner;
    this.#hyperlink = new Hyperlink(owner);
  }
  get part(): XmlPart {
    return this.#owner.part;
  }
  get hyperlink(): Hyperlink<Slide> {
    return this.#hyperlink;
  }
  get action(): ActionValue {
    const link = this.#owner.read();
    if (!link) return PP_ACTION.NONE;
    if (!link.action) return PP_ACTION.HYPERLINK;
    if (!link.action.startsWith("ppaction://")) return PP_ACTION.NONE;
    const [verb, query = ""] = link.action.slice(11).split("?");
    if (verb === "hlinkshowjump")
      return PP_ACTION[jumps[new URLSearchParams(query).get("jump") ?? ""] ?? "NONE"];
    return PP_ACTION[verbs[verb!] ?? "NONE"];
  }
  get target_slide(): Slide | null {
    const action = this.action.name;
    if (
      !["FIRST_SLIDE", "LAST_SLIDE", "NEXT_SLIDE", "PREVIOUS_SLIDE", "NAMED_SLIDE"].includes(action)
    )
      return null;
    const slides = this.#owner.slides;
    const current = slides.indexOf(this.#owner.slide);
    if (current < 0)
      throw new OfficeError(
        "invalid-selection",
        "The action owner slide is no longer present.",
        "select"
      );
    const index =
      action === "FIRST_SLIDE"
        ? 0
        : action === "LAST_SLIDE"
          ? slides.length - 1
          : action === "NEXT_SLIDE"
            ? current + 1
            : action === "PREVIOUS_SLIDE"
              ? current - 1
              : (this.#owner.read()?.targetSlide ?? 0) - 1;
    if (index < 0 || index >= slides.length)
      throw new OfficeError(
        "invalid-value",
        "The navigation target is outside this presentation.",
        "usage"
      );
    return slides[index]!;
  }
  set target_slide(value: Slide | null) {
    editable(this.#owner.read());
    if (value === null) {
      this.#owner.remove();
      return;
    }
    const index = this.#owner.slides.indexOf(value);
    if (index < 0)
      throw new OfficeError(
        "invalid-value",
        "The target slide must belong to this presentation.",
        "usage"
      );
    this.#owner.set({ targetSlide: index + 1 });
  }
}

export interface LinkShapeIdentity {
  readonly owner: string;
  readonly id: string;
}
export class LinkShape {
  readonly #session: import("./links.js").LinkSession;
  readonly #identity: LinkShapeIdentity;
  constructor(session: import("./links.js").LinkSession, identity: LinkShapeIdentity) {
    this.#session = session;
    this.#identity = Object.freeze({ ...identity });
    session.getPart(identity.owner);
  }
  owner(
    path?: readonly number[],
    trigger: "click" | "hover" = "click"
  ): LinkModelOwner<{ readonly part: string }> {
    const session = this.#session,
      identity = this.#identity;
    const slide = session.slides.find((item) => item.part === identity.owner);
    if (!slide)
      throw new OfficeError("invalid-selection", "The link shape has no owning slide.", "select");
    const xml = session.getPart(slide.part);
    let shape: import("./xml.js").XmlElement | undefined;
    let propertyPath: readonly number[] | undefined;
    const visit = (
      node: import("./xml.js").XmlElement,
      route: number[],
      parent?: import("./xml.js").XmlElement
    ) => {
      if (
        node.name.namespace === xml.root.name.namespace &&
        node.name.localName === "cNvPr" &&
        node.attributes.some(
          (attr) =>
            attr.name.namespace === "" && attr.name.localName === "id" && attr.value === identity.id
        )
      ) {
        if (propertyPath)
          throw new OfficeError("invalid-selection", "The shape identity is ambiguous.", "select");
        propertyPath = route;
        shape = parent;
      }
      node.children.forEach((child, index) => visit(child, [...route, index], node));
    };
    visit(xml.root, []);
    if (!propertyPath)
      throw new OfficeError("invalid-selection", "The link shape is no longer present.", "select");
    if (shape?.name.localName === "nvGrpSpPr" && path === undefined)
      throw new OfficeError("invalid-value", "Group shapes do not expose a click action.", "usage");
    if (path !== undefined) {
      const shapePath = propertyPath.slice(0, -2);
      let target = xml.root;
      if (!shapePath.every((index, offset) => path[offset] === index))
        throw new OfficeError("invalid-selection", "The run belongs to another shape.", "select");
      let depth = 0;
      for (const index of path) {
        if (!Number.isSafeInteger(index) || index < 0 || !target.children[index])
          throw new OfficeError("invalid-selection", "The run property path is invalid.", "select");
        target = target.children[index]!;
        depth++;
        if (
          depth > shapePath.length &&
          target.name.namespace === xml.root.name.namespace &&
          ["sp", "pic", "cxnSp", "graphicFrame", "grpSp"].includes(target.name.localName)
        )
          throw new OfficeError(
            "invalid-selection",
            "The run belongs to a nested shape.",
            "select"
          );
      }
      if (
        !["rPr", "defRPr", "endParaRPr"].includes(target.name.localName) ||
        ![
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "http://purl.oclc.org/ooxml/drawingml/main"
        ].includes(target.name.namespace)
      )
        throw new OfficeError("invalid-selection", "Select owned run properties.", "select");
    }
    const selectedPath = Object.freeze([...(path ?? propertyPath)]);
    const options = {
      selection: { kind: "object" as const, owner: identity.owner, id: identity.id },
      path: selectedPath,
      trigger
    };
    return {
      get part() {
        return session.getPart(slide.part);
      },
      get slides() {
        return session.slides;
      },
      slide,
      read() {
        const records = session
          .list(options.selection)
          .filter(
            (link) =>
              link.trigger === trigger &&
              link.path.length === selectedPath.length + 1 &&
              selectedPath.every((index, offset) => link.path[offset] === index)
          );
        if (records.length > 1)
          throw new OfficeError(
            "unsupported-edit",
            "Duplicate link nodes require explicit repair.",
            "validate-intent"
          );
        return records[0] ?? null;
      },
      set(value) {
        session.set({ ...options, ...value });
      },
      remove() {
        session.remove(options);
      }
    };
  }
  get click_action(): ActionSetting<{ readonly part: string }> {
    return new ActionSetting(this.owner());
  }
  run(path: readonly number[]): LinkRun {
    return new LinkRun(this, path);
  }
}
export class LinkRun {
  readonly #hyperlink: Hyperlink<{ readonly part: string }>;
  constructor(shape: LinkShape, path: readonly number[]) {
    this.#hyperlink = new Hyperlink(shape.owner(path));
  }
  get hyperlink(): Hyperlink<{ readonly part: string }> {
    return this.#hyperlink;
  }
}
