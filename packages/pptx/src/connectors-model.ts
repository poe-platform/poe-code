import { applyConnectorUpdate, readConnector } from "./connectors.js";
import { OfficeError } from "./errors.js";
import { Length } from "./length.js";
import { nodeFor } from "./shape-operations.js";
import { applyShapeUpdate, LineFormat } from "./shapes.js";
import type { XmlElement, XmlPart } from "./xml.js";

export class Connector {
  #xml: XmlPart;
  readonly #id: string;

  constructor(xml: XmlPart, shapeId?: number) {
    this.#xml = xml;
    this.#id = String(shapeId ?? readConnector(xml.root).shapeId);
    readConnector(this.element);
  }
  get xml(): XmlPart {
    return this.#xml;
  }
  get element(): XmlElement {
    return nodeFor(this.#xml.root, this.#id);
  }
  get shape_id(): number {
    return readConnector(this.element).shapeId;
  }
  get name(): string {
    return readConnector(this.element).name;
  }
  set name(value: string) {
    this.#xml = applyConnectorUpdate(this.#xml, this.element, { name: value });
  }
  get line(): LineFormat {
    return new LineFormat(
      () => ({ ...this.#xml, root: this.element }),
      (update) => {
        this.#xml = applyConnectorUpdate(this.#xml, this.element, {
          ...(update.lineColor === undefined ? {} : { lineColor: update.lineColor }),
          ...(update.lineWidth === undefined ? {} : { lineWidth: update.lineWidth })
        });
      }
    );
  }
  get shape_type(): 9 {
    return 9;
  }
  get has_text_frame(): false {
    return false;
  }
  get has_chart(): false {
    return false;
  }
  get has_table(): false {
    return false;
  }
  get is_placeholder(): boolean {
    return readConnector(this.element).placeholder !== null;
  }
  get begin_x(): Length {
    return new Length(readConnector(this.element).beginX);
  }
  set begin_x(value: Length) {
    this.#xml = applyConnectorUpdate(this.#xml, this.element, { beginX: value });
  }
  get begin_y(): Length {
    return new Length(readConnector(this.element).beginY);
  }
  set begin_y(value: Length) {
    this.#xml = applyConnectorUpdate(this.#xml, this.element, { beginY: value });
  }
  get end_x(): Length {
    return new Length(readConnector(this.element).endX);
  }
  set end_x(value: Length) {
    this.#xml = applyConnectorUpdate(this.#xml, this.element, { endX: value });
  }
  get end_y(): Length {
    return new Length(readConnector(this.element).endY);
  }
  set end_y(value: Length) {
    this.#xml = applyConnectorUpdate(this.#xml, this.element, { endY: value });
  }
  get left(): Length {
    return new Length(readConnector(this.element).left ?? 0);
  }
  set left(value: Length) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { left: value });
  }
  get top(): Length {
    return new Length(readConnector(this.element).top ?? 0);
  }
  set top(value: Length) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { top: value });
  }
  get width(): Length {
    return new Length(readConnector(this.element).width ?? 0);
  }
  set width(value: Length) {
    if (!(value instanceof Length) || value.emu < 0)
      throw new OfficeError(
        "invalid-value",
        "Connector width requires a nonnegative length.",
        "usage"
      );
    const current = readConnector(this.element),
      left = current.left ?? 0;
    this.#xml = applyConnectorUpdate(this.#xml, this.element, {
      beginX: new Length(left + (current.flipHorizontal ? value.emu : 0)),
      endX: new Length(left + (current.flipHorizontal ? 0 : value.emu))
    });
  }
  get height(): Length {
    return new Length(readConnector(this.element).height ?? 0);
  }
  set height(value: Length) {
    if (!(value instanceof Length) || value.emu < 0)
      throw new OfficeError(
        "invalid-value",
        "Connector height requires a nonnegative length.",
        "usage"
      );
    const current = readConnector(this.element),
      top = current.top ?? 0;
    this.#xml = applyConnectorUpdate(this.#xml, this.element, {
      beginY: new Length(top + (current.flipVertical ? value.emu : 0)),
      endY: new Length(top + (current.flipVertical ? 0 : value.emu))
    });
  }
  get rotation(): number {
    return readConnector(this.element).rotation;
  }
  set rotation(value: number) {
    this.#xml = applyShapeUpdate(this.#xml, this.element, { rotation: value });
  }
  begin_connect(shape: { readonly element: XmlElement }, connectionSiteIdx: number): void {
    if (!shape || typeof shape !== "object" || !shape.element)
      throw new OfficeError("invalid-value", "A current target XML view is required.", "usage");
    this.#xml = applyConnectorUpdate(
      this.#xml,
      this.element,
      { site: connectionSiteIdx },
      { begin: shape.element }
    );
  }
  end_connect(shape: { readonly element: XmlElement }, connectionSiteIdx: number): void {
    if (!shape || typeof shape !== "object" || !shape.element)
      throw new OfficeError("invalid-value", "A current target XML view is required.", "usage");
    this.#xml = applyConnectorUpdate(
      this.#xml,
      this.element,
      { site: connectionSiteIdx },
      { end: shape.element }
    );
  }
}
