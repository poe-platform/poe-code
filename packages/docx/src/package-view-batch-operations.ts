import { PackageView, PartView, XmlPartView, DocumentPartView, NumberingPart, _NumberingDefinitions, Relationships, RelationshipView, CoreProperties, CorePropertiesPartView, ImageParts, ImagePartView } from "./package-view.js";
import { Image, acquireImageModelInput, type ImageModelContext, type ImageModelInput } from "./image-model.js";
import type { DocxBinaryInput } from "./operation-types.js";
import type { PackURI } from "./pack-uri.js";
import { DocxUsageError } from "./argument-json.js";

type Action = (receiver: unknown, args: Readonly<Record<string, unknown>>, context?: ImageModelContext) => unknown;
export const packageViewBatchActions = new Map<string, Action>();
function action<T>(id: string, owner: abstract new (...args: never[]) => T, apply: (receiver: T, args: Readonly<Record<string, unknown>>) => unknown): void {
  packageViewBatchActions.set(id, (receiver, args) => {
    if (!(receiver instanceof owner)) throw new DocxUsageError("The receiver does not support this package view operation.");
    return apply(receiver, args);
  });
}
for (const prefix of ["model.package.Package", "model.opc.package.OpcPackage"]) {
  for (const name of ["parts", "rels", "main_document_part", "core_properties", "image_parts"] as const) action(`${prefix}.${name}.get`, PackageView, receiver => receiver[name]);
  action(`${prefix}.iter_parts.call`, PackageView, receiver => [...receiver.iter_parts()]);
  action(`${prefix}.iter_rels.call`, PackageView, receiver => [...receiver.iter_rels()]);
  action(`${prefix}.after_unmarshal.call`, PackageView, receiver => receiver.after_unmarshal());
  action(`${prefix}.part_related_by.call`, PackageView, (receiver, args) => receiver.part_related_by(args.reltype as string));
  action(`${prefix}.relate_to.call`, PackageView, (receiver, args) => receiver.relate_to(args.part as PartView, args.reltype as string));
  action(`${prefix}.load_rel.call`, PackageView, (receiver, args) => receiver.load_rel(args.reltype as string, args.target as PartView | string, args.rId as string, args.isExternal as boolean | undefined));
  action(`${prefix}.next_partname.call`, PackageView, (receiver, args) => receiver.next_partname(args.template as string));
}
for (const [prefix, owner] of [["model.opc.part.Part", PartView], ["model.opc.part.XmlPart", XmlPartView], ["model.parts.document.DocumentPart", DocumentPartView], ["model.parts.numbering.NumberingPart", NumberingPart], ["model.parts.styles.StylesPart", XmlPartView], ["model.parts.image.ImagePart", ImagePartView], ["model.opc.parts.coreprops.CorePropertiesPart", CorePropertiesPartView]] as const) {
  for (const name of ["blob", "content_type", "partname", "package", "rels", "related_parts"] as const) action(`${prefix}.${name}.get`, owner, receiver => receiver[name]);
  action(`${prefix}.partname.set`, owner, (receiver, args) => { receiver.partname = args.value as string | PackURI; });
  action(`${prefix}.part_related_by.call`, owner, (receiver, args) => receiver.part_related_by(args.reltype as string));
  action(`${prefix}.target_ref.call`, owner, (receiver, args) => receiver.target_ref(args.rId as string));
  action(`${prefix}.relate_to.call`, owner, (receiver, args) => receiver.relate_to(args.target as PartView | string, args.reltype as string, args.isExternal as boolean | undefined));
  action(`${prefix}.load_rel.call`, owner, (receiver, args) => receiver.load_rel(args.reltype as string, args.target as PartView | string, args.rId as string, args.isExternal as boolean | undefined));
  action(`${prefix}.drop_rel.call`, owner, (receiver, args) => receiver.drop_rel(args.rId as string));
  action(`${prefix}.before_marshal.call`, owner, receiver => receiver.before_marshal());
  action(`${prefix}.after_unmarshal.call`, owner, receiver => receiver.after_unmarshal());
}
for (const prefix of ["model.opc.part.XmlPart", "model.parts.document.DocumentPart", "model.parts.numbering.NumberingPart", "model.parts.styles.StylesPart", "model.opc.parts.coreprops.CorePropertiesPart"]) {
  action(`${prefix}.element.get`, XmlPartView, receiver => receiver.element);
  action(`${prefix}.part.get`, XmlPartView, receiver => receiver.part);
}
const prefix = "model.opc.rel.Relationships";
for (const name of ["related_parts", "xml"] as const) action(`${prefix}.${name}.get`, Relationships, receiver => receiver[name]);
action(`${prefix}.add_relationship.call`, Relationships, (receiver, args) => receiver.add_relationship(args.reltype as string, args.target as PartView | string, args.rId as string, args.isExternal as boolean | undefined));
action(`${prefix}.get_or_add.call`, Relationships, (receiver, args) => receiver.get_or_add(args.reltype as string, args.targetPart as PartView));
action(`${prefix}.get_or_add_ext_rel.call`, Relationships, (receiver, args) => receiver.get_or_add_ext_rel(args.reltype as string, args.targetRef as string));
action(`${prefix}.part_with_reltype.call`, Relationships, (receiver, args) => receiver.part_with_reltype(args.reltype as string));
action(`${prefix}.__getitem__.call`, Relationships, (receiver, args) => receiver.at(args.rId as string));
action(`${prefix}.__setitem__.call`, Relationships, (receiver, args) => receiver.set(args.rId as string, args.value as RelationshipView));
action(`${prefix}.__delitem__.call`, Relationships, (receiver, args) => receiver.delete(args.rId as string));
action(`${prefix}.__len__.get`, Relationships, receiver => receiver.length);
action(`${prefix}.__iter__.call`, Relationships, receiver => [...receiver]);
action(`${prefix}.__contains__.call`, Relationships, (receiver, args) => receiver.has(args.rId as string));
for (const name of ["keys", "values", "items"] as const) action(`${prefix}.${name}.call`, Relationships, receiver => [...receiver[name]()]);
action(`${prefix}.get.call`, Relationships, (receiver, args) => receiver.get(args.rId as string, args.defaultValue as RelationshipView | null | undefined));
action(`${prefix}.clear.call`, Relationships, receiver => receiver.clear());
action(`${prefix}.update.call`, Relationships, (receiver, args) => receiver.update(args.entries as readonly (readonly [string, RelationshipView])[]));
action(`${prefix}.pop.call`, Relationships, (receiver, args) => Object.hasOwn(args, "defaultValue") ? receiver.pop(args.rId as string, args.defaultValue as RelationshipView | null) : receiver.pop(args.rId as string));
action(`${prefix}.popitem.call`, Relationships, receiver => receiver.popitem());
action(`${prefix}.setdefault.call`, Relationships, (receiver, args) => receiver.setdefault(args.rId as string, args.value as RelationshipView));
action(`${prefix}.copy.call`, Relationships, receiver => receiver.copy());
for (const name of ["rId", "reltype", "is_external", "target_ref", "target_part"] as const)
  action(`model.opc.rel._Relationship.${name}.get`, RelationshipView, receiver => receiver[name]);
for (const name of ["title", "subject", "author", "keywords", "comments", "last_modified_by", "category", "content_status", "identifier", "language", "version", "revision", "created", "modified", "last_printed"] as const) {
  action(`model.opc.coreprops.CoreProperties.${name}.get`, CoreProperties, receiver => receiver[name]);
  action(`model.opc.coreprops.CoreProperties.${name}.set`, CoreProperties, (receiver, args) => {
    const value = ["created", "modified", "last_printed"].includes(name) && typeof args.value === "string" ? new Date(args.value) : args.value;
    Reflect.set(receiver, name, value);
  });
}
action("model.opc.parts.coreprops.CorePropertiesPart.core_properties.get", CorePropertiesPartView, receiver => receiver.core_properties);

for (const [prefix, owner] of [["model.opc.part.Part", PartView], ["model.opc.part.XmlPart", XmlPartView], ["model.parts.document.DocumentPart", DocumentPartView], ["model.parts.numbering.NumberingPart", NumberingPart], ["model.parts.image.ImagePart", ImagePartView], ["model.opc.parts.coreprops.CorePropertiesPart", CorePropertiesPartView]] as const) {
  packageViewBatchActions.set(`${prefix}.load.call`, async (_receiver, args, context) => {
    const acquired = await acquireImageModelInput(args.blob as Uint8Array | DocxBinaryInput, context);
    return owner.load(args.partname as string, args.contentType as string, acquired.bytes, args.ownerPackage as PackageView);
  });
}
packageViewBatchActions.set("model.opc.parts.coreprops.CorePropertiesPart.default.call", (_receiver, args) => CorePropertiesPartView.default(args.ownerPackage as PackageView));
for (const name of ["default_cx", "default_cy", "filename", "image", "sha1"] as const) action(`model.parts.image.ImagePart.${name}.get`, ImagePartView, receiver => receiver[name]);
action("model.package.ImageParts.__contains__.call", ImageParts, (receiver, args) => receiver.has(args.value));
action("model.package.ImageParts.__iter__.call", ImageParts, receiver => [...receiver]);
action("model.package.ImageParts.__len__.get", ImageParts, receiver => receiver.length);
action("model.package.ImageParts.append.call", ImageParts, (receiver, args) => receiver.append(args.item as ImagePartView));
for (const [id, owner] of [["model.package.Package.get_or_add_image_part.call", PackageView], ["model.package.ImageParts.get_or_add_image_part.call", ImageParts]] as const) {
  packageViewBatchActions.set(id, async (receiver, args, context) => {
    if (!(receiver instanceof owner)) throw new DocxUsageError("Expected an admitted image owner.");
    const descriptor = args.imageDescriptor as ImageModelInput | DocxBinaryInput;
    if (!(descriptor instanceof Uint8Array) && "path" in descriptor) return receiver.get_or_add_image_part({ path: descriptor.path, capability: descriptor.capability });
    const acquired = await acquireImageModelInput(descriptor as Uint8Array | DocxBinaryInput, context);
    return receiver.get_or_add_image_part(acquired.bytes);
  });
}
packageViewBatchActions.set("model.parts.image.ImagePart.from_image.call", (_receiver, args) => ImagePartView.from_image(args.image as Image, args.partname as string, args.ownerPackage as PackageView));

action("model.parts.document.DocumentPart.numbering_part.get", DocumentPartView, receiver => receiver.numbering_part);
action("model.parts.numbering.NumberingPart.numbering_definitions.get", NumberingPart, receiver => receiver.numbering_definitions);
action("model.parts.numbering._NumberingDefinitions.__len__.get", _NumberingDefinitions, receiver => receiver.length);
packageViewBatchActions.set("model.parts.numbering.NumberingPart.new.call", () => NumberingPart.new());
