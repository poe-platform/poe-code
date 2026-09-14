import { InputTypeError, InvalidValueError, type DocumentArchive } from "./archive.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { documentXmlSettings, type DocumentXmlLimits } from "./package-xml.js";

import { compatibilitySettings, documentCompatibilityProfile, type CompatibilityProfile } from "./compatibility.js";

export class DocumentArchiveEditor {
  readonly #profile: CompatibilityProfile;
  readonly #archive: DocumentArchive;
  readonly #editors = new Map<string, DocumentXmlEditor>();
  readonly #limits: DocumentXmlLimits;

  constructor(archive: DocumentArchive, limits: DocumentXmlLimits = {}, profile: CompatibilityProfile = documentCompatibilityProfile) {
    this.#profile = compatibilitySettings(profile);
    if (!archive || !Array.isArray(archive.members) || !(archive.comment instanceof Uint8Array))
      throw new InputTypeError("Expected an owned document archive.");
    this.#limits = documentXmlSettings(limits);
    const names = new Set<string>();
    this.#archive = {
      comment: new Uint8Array(archive.comment),
      members: archive.members.map(member => {
        if (!member || typeof member.name !== "string" || !(member.bytes instanceof Uint8Array) ||
          typeof member.directory !== "boolean" || !(member.modified instanceof Date))
          throw new InputTypeError("Expected typed archive members.");
        if (names.has(member.name)) throw new InvalidValueError("Duplicate archive member.");
        names.add(member.name);
        return { ...member, bytes: new Uint8Array(member.bytes), modified: new Date(member.modified.getTime()) };
      })
    };
  }

  get dirtyParts(): readonly string[] {
    return this.#archive.members.filter(member => this.#editors.get(member.name)?.dirtyNodes.length).map(member => member.name);
  }

  xml(name: string): DocumentXmlEditor {
    const existing = this.#editors.get(name);
    if (existing) return existing;
    const member = this.#archive.members.find(member => member.name === name && !member.directory);
    if (!member) throw new InvalidValueError("Archive part was not found.");
    const editor = new DocumentXmlEditor(member.bytes, this.#limits, this.#profile);
    this.#editors.set(name, editor);
    return editor;
  }

  snapshot(): DocumentArchive {
    return {
      comment: new Uint8Array(this.#archive.comment),
      members: this.#archive.members.map(member => ({
        ...member,
        bytes: this.#editors.get(member.name)?.serialize() ?? new Uint8Array(member.bytes),
        modified: new Date(member.modified.getTime())
      }))
    };
  }
}
