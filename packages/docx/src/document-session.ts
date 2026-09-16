import { admitDocumentArchive, admittedXml, readDocumentArchive, type AdmittedDocumentArchive } from "./admission.js";
import { archiveSettings, documentSession, InputTypeError, ResourceLimitError, type DocumentArchive } from "./archive.js";
import { documentXmlCache } from "./budget.js";
import type { XmlElement } from "./package-xml.js";
import type { PublicationContext } from "./publication.js";

/** Internal ordered-operation state; publication is performed only by the outer caller. */
export class DocumentSession {
  readonly baseline: AdmittedDocumentArchive;
  readonly context: PublicationContext;
  readonly #input: Uint8Array;
  readonly #settings: ReturnType<typeof archiveSettings>;
  #archive: DocumentArchive;
  #admitted: AdmittedDocumentArchive | undefined;
  #parsed: Map<Uint8Array, XmlElement>;
  #generation = 0;

  private constructor(input: Uint8Array, context: PublicationContext, baseline: AdmittedDocumentArchive) {
    this.#settings = archiveSettings(context);
    this.#input = input;
    this.baseline = baseline;
    this.#archive = baseline;
    this.#admitted = baseline;
    this.#parsed = baseline[admittedXml] ?? new Map();
    this.context = { ...context, ...this.#settings, [documentSession]: this };
  }

  static async open(input: Uint8Array, context: PublicationContext): Promise<DocumentSession> {
    if (context[documentSession]) throw new InputTypeError("Nested document sessions are unsupported.");
    const settings = archiveSettings(context);
    settings.budget[documentXmlCache].entries ??= new Map();
    settings.budget[documentXmlCache].admitted ??= new WeakSet();
    return new DocumentSession(input, { ...context, ...settings }, await readDocumentArchive(input, settings));
  }

  get generation(): number { return this.#generation; }

  async read(input: Uint8Array): Promise<AdmittedDocumentArchive> {
    if (!(input instanceof Uint8Array)) throw new InputTypeError("Expected document session source bytes.");
    if (input !== this.#input) {
      this.#settings.budget.charge("work", input.length);
      if (input.length !== this.#input.length || !input.every((value, index) => value === this.#input[index]))
        throw new InputTypeError("Input differs from document session source.");
    }
    return this.snapshot();
  }

  async stage(archive: DocumentArchive): Promise<void> {
    const { limits, budget, signal } = this.#settings;
    signal.throwIfAborted();
    if (!archive || !Array.isArray(archive.members) || !(archive.comment instanceof Uint8Array))
      throw new InputTypeError("Expected an owned document archive.");
    if (archive.members.length > limits.maxMembers || archive.comment.length > limits.maxCommentBytes)
      throw new ResourceLimitError("Document snapshot metadata limit exceeded.");
    let total = 0;
    const names = new Set<string>();
    const previous = new Map(this.#archive.members.map(member => [member.name, member]));
    const members = archive.members.map(member => {
      if (!member || typeof member.name !== "string" || !(member.bytes instanceof Uint8Array)
        || !(member.modified instanceof Date) || !Number.isFinite(member.modified.getTime()) || typeof member.directory !== "boolean")
        throw new InputTypeError("Expected typed document members.");
      if (names.has(member.name)) throw new InputTypeError("Duplicate document snapshot member.");
      names.add(member.name);
      total += member.bytes.length;
      if (member.bytes.length > limits.maxEntryBytes || member.name.length > limits.maxPathBytes || total > limits.maxTotalBytes)
        throw new ResourceLimitError("Document snapshot member limit exceeded.");
      const old = previous.get(member.name);
      budget.charge("work", member.bytes.length);
      if (old && old.directory === member.directory && old.modified.getTime() === member.modified.getTime()
        && old.bytes.length === member.bytes.length && old.bytes.every((value, index) => value === member.bytes[index])) return old;
      budget.charge("retainedBytes", member.bytes.length + member.name.length * 2 + 128);
      return { ...member, bytes: new Uint8Array(member.bytes), modified: new Date(member.modified.getTime()) };
    });
    budget.check("expandedPackage", total);
    budget.charge("retainedBytes", archive.comment.length + members.length * 8);
    const changed = members.length !== this.#archive.members.length || members.some((member, index) => member !== this.#archive.members[index])
      || archive.comment.length !== this.#archive.comment.length || !archive.comment.every((value, index) => value === this.#archive.comment[index]);
    if (changed) {
      if (this.#generation === Number.MAX_SAFE_INTEGER) throw new ResourceLimitError("Document generation limit exceeded.");
      this.#generation++;
    }
    this.#archive = { members, comment: new Uint8Array(archive.comment) };
    this.#admitted = undefined;
  }

  async snapshot(): Promise<AdmittedDocumentArchive> {
    if (!this.#admitted) {
      const retained = new Set(this.#archive.members.map(member => member.bytes));
      this.#parsed = new Map([...this.#parsed].filter(([bytes]) => retained.has(bytes)));
      this.#admitted = await admitDocumentArchive(this.#archive, this.#settings, 0, this.#parsed);
    }
    return this.#admitted;
  }
}
