import { validateDocumentArchive, SemanticValidationError } from "./validation.js";
import { InputTypeError, InvalidValueError, type DocumentArchive } from "./archive.js";
import { DocumentXmlEditor } from "./xml-write.js";
import { documentXmlSettings, type DocumentXmlLimits } from "./package-xml.js";
import { DocumentBudget } from "./budget.js";

import { compatibilitySettings, documentCompatibilityProfile, type CompatibilityProfile } from "./compatibility.js";

export class DocumentArchiveEditor {
  readonly #profile: CompatibilityProfile;
  readonly #archive: DocumentArchive;
  readonly #editors = new Map<string, DocumentXmlEditor>();
  readonly #limits: DocumentXmlLimits;
  readonly #budget: DocumentBudget;

  constructor(archive: DocumentArchive, limits: DocumentXmlLimits = {}, profile: CompatibilityProfile = documentCompatibilityProfile, budget = new DocumentBudget()) {
    this.#budget = budget;
    this.#profile = compatibilitySettings(profile);
    if (!archive || !Array.isArray(archive.members) || !(archive.comment instanceof Uint8Array))
      throw new InputTypeError("Expected an owned document archive.");
    this.#limits = documentXmlSettings(limits, budget);
    budget.check("zipEntries", archive.members.length);
    let total = archive.comment.length;
    for (const member of archive.members) {
      if (!(member?.bytes instanceof Uint8Array)) throw new InputTypeError("Expected typed archive members.");
      total += member.bytes.length;
    }
    budget.check("expandedPackage", total);
    budget.charge("retainedBytes", total);
    budget.charge("work", total);
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
    const editor = new DocumentXmlEditor(member.bytes, this.#limits, this.#profile, this.#budget);
    this.#editors.set(name, editor);
    return editor;
  }

  snapshot(): DocumentArchive {
    const copiedBytes = this.#archive.comment.length + this.#archive.members.reduce(
      (sum, member) => sum + (this.#editors.has(member.name) ? 0 : member.bytes.length), 0);
    this.#budget.charge("work", copiedBytes);
    this.#budget.charge("retainedBytes", copiedBytes);
    const staged = {
      comment: new Uint8Array(this.#archive.comment),
      members: this.#archive.members.map(member => ({
        ...member,
        bytes: this.#editors.get(member.name)?.serialize() ?? new Uint8Array(member.bytes),
        modified: new Date(member.modified.getTime())
      }))
    };
    if (staged.members.some(member => member.name.toLowerCase() === "[content_types].xml")) {
      const report = validateDocumentArchive(staged, {}, this.#budget);
      if (!report.valid) throw new SemanticValidationError(report.diagnostics);
    }
    return staged;
  }
}
