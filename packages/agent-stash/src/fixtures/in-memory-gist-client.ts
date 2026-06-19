import type { GistClient, GistRecord, GistWriteInput } from "../types.js";

export class InMemoryGistClient implements GistClient {
  readonly records = new Map<string, GistRecord>();
  createCalls: GistWriteInput[] = [];
  readCalls: string[] = [];
  updateCalls: Array<{ gistId: string; input: GistWriteInput }> = [];
  private nextId = 1;

  seed(record: GistRecord): void {
    this.records.set(record.id, cloneRecord(record));
  }

  async createSecret(input: GistWriteInput): Promise<GistRecord> {
    this.createCalls.push(input);
    const id = `gist-${this.nextId}`;
    this.nextId += 1;
    const record = applyWrite({ id, htmlUrl: `https://gist.github.com/${id}`, files: {} }, input);
    this.records.set(id, record);
    return cloneRecord(record);
  }

  async read(gistId: string): Promise<GistRecord> {
    this.readCalls.push(gistId);
    const record = this.records.get(gistId);
    if (!record) {
      throw new Error(`Gist not found: ${gistId}`);
    }
    return cloneRecord(record);
  }

  async update(gistId: string, input: GistWriteInput): Promise<GistRecord> {
    this.updateCalls.push({ gistId, input });
    const current = this.records.get(gistId);
    if (!current) {
      throw new Error(`Gist not found: ${gistId}`);
    }
    const next = applyWrite(current, input);
    this.records.set(gistId, next);
    return cloneRecord(next);
  }
}

function applyWrite(record: GistRecord, input: GistWriteInput): GistRecord {
  const files = { ...record.files };
  for (const [filename, file] of Object.entries(input.files)) {
    if (file === null) {
      delete files[filename];
    } else {
      files[filename] = { filename, content: file.content };
    }
  }
  return { ...record, files };
}

function cloneRecord(record: GistRecord): GistRecord {
  return {
    ...record,
    files: Object.fromEntries(Object.entries(record.files).map(([key, file]) => [key, { ...file }]))
  };
}
