import { shapeOwnerTokens } from "./shape-owner-token.js";
import { readShape } from "./shapes.js";
import { applyConnectorUpdate, readConnector } from "./connectors.js";
import { OfficeError, ValueError } from "./errors.js";
import { Length } from "./length.js";
import { nodeFor } from "./shape-operations.js";
import { applyShapeUpdate, LineFormat, ShadowFormat } from "./shapes.js";
import { PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
import type { XmlElement, XmlPart } from "./xml.js";

export class Connector {
  #snapshot: XmlPart;
  readonly #owner: { read(): XmlPart; write(xml: XmlPart): void } | undefined;
  get #xml(): XmlPart {
    return this.#owner?.read() ?? this.#snapshot;
  }
  set #xml(xml: XmlPart) {
    if (this.#owner) this.#owner.write(xml);
    else this.#snapshot = xml;
  }
  readonly #id: string;
  #shadow: ShadowFormat | undefined;

  constructor(
    xml: XmlPart,
    shapeId?: number,
    owner?: { read(): XmlPart; write(xml: XmlPart): void }
  ) {
    this.#snapshot = xml;
    this.#owner = owner;
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
      },
      (transform) => {
        this.#xml = transform(this.#xml, this.element);
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
  get placeholder_format() {
    const placeholder = readConnector(this.element).placeholder;
    if (!placeholder) throw new ValueError("Connector is not a placeholder.");
    return { ...placeholder, type: PP_PLACEHOLDER_TYPE.from_xml(placeholder.type) };
  }
  get shadow(): ShadowFormat {
    this.#shadow ??= new ShadowFormat(
      () => this.#xml.subtree(this.element),
      (transform) => {
        this.#xml = transform(this.#xml, this.element);
      }
    );
    return this.#shadow;
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
  #target(shape: { readonly element: XmlElement; readonly xml?: XmlPart }): XmlElement {
    const element = shape.element;
    const xml = shape.xml;
    if (this.#owner && xml && shapeOwnerTokens.get(xml) === this.#owner && xml.root === element)
      return nodeFor(this.#xml.root, String(readShape(element).shapeId));
    return element;
  }
  begin_connect(shape: { readonly element: XmlElement }, connectionSiteIdx: number): void {
    if (!shape || typeof shape !== "object" || !shape.element)
      throw new OfficeError("invalid-value", "A current target XML view is required.", "usage");
    this.#xml = applyConnectorUpdate(
      this.#xml,
      this.element,
      { site: connectionSiteIdx },
      { begin: this.#target(shape) }
    );
  }
  end_connect(shape: { readonly element: XmlElement }, connectionSiteIdx: number): void {
    if (!shape || typeof shape !== "object" || !shape.element)
      throw new OfficeError("invalid-value", "A current target XML view is required.", "usage");
    this.#xml = applyConnectorUpdate(
      this.#xml,
      this.element,
      { site: connectionSiteIdx },
      { end: this.#target(shape) }
    );
  }
}
