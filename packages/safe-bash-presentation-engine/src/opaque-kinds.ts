import type { OpaqueObjectKind } from "./opaque-objects.js";
export const relationships = [
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships"
];
export const relationshipKinds: Readonly<Record<string, OpaqueObjectKind>> = Object.fromEntries([
  ...relationships.flatMap((namespace) =>
    Object.entries({ oleObject: "ole", package: "package", control: "control", font: "font" }).map(
      ([suffix, kind]) => [`${namespace}/${suffix}`, kind]
    )
  ),
  ["http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary", "control"],
  ["http://schemas.microsoft.com/office/2006/relationships/vbaProject", "active-payload"],
  ["http://schemas.microsoft.com/office/2011/relationships/webextension", "web-extension"],
  ["http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes", "web-extension"],
  ["http://schemas.microsoft.com/office/2017/06/relationships/model3d", "model3d"]
]) as Readonly<Record<string, OpaqueObjectKind>>;
export const contentKinds: Readonly<Record<string, OpaqueObjectKind>> = {
  "application/vnd.openxmlformats-officedocument.oleobject": "ole",
  "application/vnd.ms-office.activex+xml": "control",
  "application/vnd.ms-office.activex": "control",
  "application/vnd.ms-office.webextension+xml": "web-extension",
  "application/vnd.ms-office.webextensiontaskpanes+xml": "web-extension",
  "application/x-fontdata": "font",
  "application/vnd.openxmlformats-officedocument.obfuscatedfont": "font",
  "application/font-sfnt": "font",
  "application/vnd.ms-opentype": "font",
  "model/gltf-binary": "model3d",
  "model/gltf+json": "model3d",
  "application/vnd.ms-office.model3d": "model3d",
  "application/vnd.ms-office.vbaproject": "active-payload"
};
