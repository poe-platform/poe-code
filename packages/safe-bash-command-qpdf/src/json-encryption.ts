import { getPdfEncryptionInfo, type PdfEncryptionState } from "@poe-code/pdf-ast";

export function qpdfJsonEncryption(encryption: PdfEncryptionState | undefined) {
  const info = encryption ? getPdfEncryptionInfo(encryption) : undefined;
  const p = encryption?.permissions, legacy = encryption?.revision === 2;
  const assembly = p ? legacy ? p.modify : p.assemble : true;
  const forms = p ? legacy ? p.addNotes : p.fillForms : true;
  const annotations = p?.addNotes ?? true, other = p?.modify ?? true;
  return {
    capabilities: {
      accessibility: p ? legacy ? p.copy : encryption!.revision >= 5 || p.extractAccessibility : true,
      extract: p?.copy ?? true,
      // qpdf's version 1 schema preserves this historical spelling.
      moddifyannotations: annotations,
      modify: assembly && forms && annotations && other,
      modifyassembly: assembly, modifyforms: forms, modifyother: other,
      printhigh: p ? p.print && (legacy || p.printHighRes) : true,
      printlow: p?.print ?? true
    },
    encrypted: Boolean(encryption),
    ownerpasswordmatched: info?.ownerPasswordMatched ?? false,
    parameters: {
      P: info?.permissionsMask ?? 0, R: encryption?.revision ?? 0, V: encryption?.version ?? 0,
      bits: encryption?.keyLengthBits ?? 0, filemethod: info?.fileMethod ?? "none", key: null,
      method: info ? info.streamMethod === info.stringMethod && info.streamMethod === info.fileMethod ? info.streamMethod : "mixed" : "none",
      streammethod: info?.streamMethod ?? "none", stringmethod: info?.stringMethod ?? "none"
    },
    recovereduserpassword: encryption && encryption.revision < 5 ? info!.userPassword : null,
    userpasswordmatched: info?.userPasswordMatched ?? false
  };
}
