import type { ByteSource } from "./contracts.js";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { RetainedXmlDocument, RetainedXmlNode } from "./retained-xml-document.js";
import type { RetainedPackageContext } from "./retained-package.js";
import { equal, literal } from "./retained-values.js";
import { readRetainedXmlScalar } from "./retained-xml-scalars.js";
import { shapeCoordinateMap } from "./shape-transforms.js";
import { Length } from "./length.js";
import { OfficeError } from "./errors.js";

/** Owns backed group links, borrows the document until close. Only four corners
 * and one transform are resident, regardless of group depth or identifier size. */
export async function openRetainedShapeGeometry(
  doc: RetainedXmlDocument,
  node: RetainedXmlNode,
  settings: RetainedPackageContext
) {
  const signal = settings.signal ?? new AbortController().signal,
    working = settings.workingStorage;
  const pages = new PagedStorage(
    { fs: working.fs, cwd: working.directory, env: {}, signal },
    (working.cacheBytes ?? 1024 * 1024) / 16384
  );
  let closed = false;
  const close = () => {
    closed = true;
    return pages.close();
  };
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "Shape geometry is closed.", "index");
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "index");
  };
  const invalid = (): never => {
    throw new OfficeError(
      "unsupported-edit",
      "Explicit nonsingular geometry is required for coordinate projection.",
      "validate-intent"
    );
  };
  const local = (n: RetainedXmlNode, name: string) => equal(doc.raw(n.localName), literal(name));
  async function child(n: RetainedXmlNode, name: string, namespace = () => doc.namespace(n)) {
    let found;
    for await (const item of doc.children(n))
      if (
        item.kind === "element" &&
        (await local(item, name)) &&
        (await equal(doc.namespace(item), namespace()))
      ) {
        if (found) throw new OfficeError("invalid-value", "Ambiguous shared structure.", "usage");
        found = item;
      }
    return found;
  }
  async function attr(n: RetainedXmlNode, name: string) {
    for await (const item of doc.attributes(n))
      if ((await local(item, name)) && (await equal(doc.namespace(item), literal("")))) return item;
  }
  async function transform(n: RetainedXmlNode) {
    const drawing = (await equal(
      doc.namespace(n),
      literal("http://purl.oclc.org/ooxml/presentationml/main")
    ))
      ? "http://purl.oclc.org/ooxml/drawingml/main"
      : "http://schemas.openxmlformats.org/drawingml/2006/main";
    const frame = await local(n, "graphicFrame");
    const owner = frame ? n : await child(n, (await local(n, "grpSp")) ? "grpSpPr" : "spPr");
    const xfrm =
      owner &&
      (await child(owner, "xfrm", frame ? () => doc.namespace(n) : () => literal(drawing)));
    if (!xfrm) return null;
    async function integer(name: string, key: string) {
      const pair = await child(xfrm!, name, () => literal(drawing)),
        value = pair && (await attr(pair, key));
      if (!value) return null;
      try {
        return await readRetainedXmlScalar(
          name === "off" || name === "chOff" ? "coordinate" : "integer",
          doc.text(value),
          check
        );
      } catch (error) {
        check();
        if (error instanceof OfficeError && error.code === "invalid-xml") invalid();
        throw error;
      }
    }
    const x = await integer("off", "x"),
      y = await integer("off", "y"),
      w = await integer("ext", "cx"),
      h = await integer("ext", "cy");
    if (x === null || y === null || w === null || h === null) return null;
    if (w < 0 || h < 0) invalid();
    const raw = await attr(xfrm, "rot");
    let rotation = 0;
    if (raw)
      try {
        rotation = await readRetainedXmlScalar("integer", doc.text(raw), check);
      } catch (error) {
        check();
        if (error instanceof OfficeError && error.code === "invalid-xml") invalid();
        throw error;
      }
    async function flip(key: string) {
      const value = await attr(xfrm!, key);
      if (!value) return 1;
      for (const token of ["true", "false", "1", "0"])
        if (await equal(doc.text(value), literal(token)))
          return token === "true" || token === "1" ? -1 : 1;
      return invalid();
    }
    return {
      x,
      y,
      w,
      h,
      integer,
      map: shapeCoordinateMap(x, y, w, h, rotation, await flip("flipH"), await flip("flipV"))
    };
  }
  async function write(pointer: number, row: number[]) {
    const bytes = new Uint8Array(row.length * 8),
      view = new DataView(bytes.buffer);
    row.forEach((n, i) => view.setFloat64(i * 8, n, true));
    await pages.write(pointer, bytes);
  }
  async function row(pointer: number) {
    check();
    const bytes = await pages.read(pointer, 24),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getFloat64(0, true), view.getFloat64(8, true), view.getFloat64(16, true)] as const;
  }
  try {
    check();
    const target = doc.reference(node);
    let top = 0,
      found = false;
    for await (const item of doc.nodes()) {
      check();
      if (item.node.kind !== "element") continue;
      while (top && (await row(top))[1] >= item.depth) top = (await row(top))[0];
      if (doc.reference(item.node) === target) {
        found = true;
        break;
      }
      if (
        (await local(item.node, "grpSp")) &&
        (await equal(doc.namespace(item.node), doc.namespace(node)))
      ) {
        const next = pages.allocate(24);
        await write(next, [top, item.depth, doc.reference(item.node)]);
        top = next;
      }
    }
    if (!found)
      throw new OfficeError(
        "invalid-selection",
        "Shape does not belong to the supplied drawing.",
        "select"
      );
    const own = await transform(node);
    if (!own) return { value: null, close };
    let corners = [
      own.map(own.x, own.y),
      own.map(own.x + own.w, own.y),
      own.map(own.x + own.w, own.y + own.h),
      own.map(own.x, own.y + own.h)
    ];
    const grouped = !!top;
    let path = 0;
    while (top) {
      const data = await row(top),
        group = await doc.node(data[2]),
        parent = await transform(group);
      top = data[0];
      if (!parent) return { value: null, close };
      const cx = await parent.integer("chOff", "x"),
        cy = await parent.integer("chOff", "y"),
        cw = await parent.integer("chExt", "cx"),
        ch = await parent.integer("chExt", "cy");
      if (cx === null || cy === null || cw === null || ch === null) return { value: null, close };
      if (cw <= 0 || ch <= 0 || parent.w <= 0 || parent.h <= 0) invalid();
      corners = corners.map((point) =>
        parent.map(
          parent.x + ((point.x - cx) * parent.w) / cw,
          parent.y + ((point.y - cy) * parent.h) / ch
        )
      );
      const next = pages.allocate(24);
      await write(next, [path, 0, data[2]]);
      path = next;
    }
    // Admit group identity structure before final coordinate rounding, matching
    // the buffered reader's error ordering without materializing identifiers.
    for (let pointer = path; pointer; ) {
      const data = await row(pointer),
        group = await doc.node(data[2]);
      const nv = await child(group, "nvGrpSpPr"),
        cn = nv && (await child(nv, "cNvPr")),
        id = cn && (await attr(cn, "id"));
      await write(pointer, [data[0], 0, id ? doc.reference(id) : 0]);
      pointer = data[0];
    }
    async function* groupPath() {
      check();
      for (let pointer = path; pointer; ) {
        const data = await row(pointer);
        pointer = data[0];
        const id = data[2] ? await doc.node(data[2]) : null;
        yield id ? (): ByteSource => doc.text(id) : null;
      }
      check();
    }
    return {
      value: {
        coordinateSystem: grouped ? "group" : "slide",
        unit: "emu",
        groupPath: groupPath(),
        corners: corners.map((point) => ({
          x: new Length(point.x).emu,
          y: new Length(point.y).emu
        }))
      },
      close
    };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}
