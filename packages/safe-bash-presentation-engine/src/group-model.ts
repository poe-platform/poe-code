import { TypeError } from "./errors.js";
import { Shape, MSO_SHAPE_TYPE } from "./shapes.js";
import type { XmlPart } from "./xml.js";

export class GroupShape<Children> extends Shape {
  constructor(
    xml: XmlPart,
    readonly shapes: Children,
    owner?: { read(): XmlPart; write(xml: XmlPart): void }
  ) {
    if (xml.root.name.localName !== "grpSp") throw new TypeError("Expected a group shape.");
    super(xml, owner);
  }

  override get shape_type(): MSO_SHAPE_TYPE {
    return MSO_SHAPE_TYPE.GROUP;
  }

  get click_action(): never {
    throw new TypeError("Group shapes cannot have click actions.");
  }
}
