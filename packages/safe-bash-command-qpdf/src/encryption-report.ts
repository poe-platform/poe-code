import { getPdfEncryptionInfo, PdfPasswordError, type PdfEncryptionState } from "@poe-code/pdf-ast";

export function encryptionReport(encryption: PdfEncryptionState | PdfPasswordError | undefined): string {
  if (!encryption) return "File is not encrypted\n";
  const info = getPdfEncryptionInfo(encryption), p = encryption.permissions;
  const legacy = encryption.revision === 2;
  const assembly = legacy ? p.modify : p.assemble;
  const forms = legacy ? p.addNotes : p.fillForms;
  const permissions: [string, boolean][] = [
    ["extract for accessibility", legacy ? p.copy : encryption.revision >= 5 || p.extractAccessibility],
    ["extract for any purpose", p.copy],
    ["print low resolution", p.print],
    ["print high resolution", p.print && (legacy || p.printHighRes)],
    ["modify document assembly", assembly],
    ["modify forms", forms],
    ["modify annotations", p.addNotes],
    ["modify other", p.modify],
    ["modify anything", assembly && forms && p.addNotes && p.modify],
  ];
  const lines = [`R = ${encryption.revision}`, `P = ${info.permissionsMask | 0}`, `User password = ${info.userPassword}`];
  if (encryption instanceof PdfPasswordError) lines.unshift("Incorrect password supplied");
  if (info.ownerPasswordMatched) lines.push("Supplied password is owner password");
  if (info.userPasswordMatched) lines.push("Supplied password is user password");
  for (const [name, allowed] of permissions) lines.push(`${name}: ${allowed ? "allowed" : "not allowed"}`);
  if (encryption.version >= 4) lines.push(`stream encryption method: ${info.streamMethod}`, `string encryption method: ${info.stringMethod}`, `file encryption method: ${info.fileMethod}`);
  return lines.join("\n") + "\n";
}
