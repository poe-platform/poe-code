import type {
  BlobResourceContents,
  PaginatedParams,
  PaginatedResult,
  Resource,
  ResourceContents,
  ResourceTemplate,
  TextResourceContents,
} from "./index.js";

const resource: Resource = {
  uri: "file:///tmp/readme.md",
  name: "README",
  description: "Project readme",
  mimeType: "text/markdown",
  size: 1024,
};

const resourceTemplate: ResourceTemplate = {
  uriTemplate: "file:///tmp/{filename}",
  name: "Project file",
  description: "Template for project files",
  mimeType: "text/plain",
};

const paginatedParams: PaginatedParams = {
  cursor: "next-page",
};

const paginatedResult: PaginatedResult = {
  nextCursor: "cursor-2",
};

const textResourceContents: TextResourceContents = {
  uri: resource.uri,
  mimeType: "text/plain",
  text: "hello",
};

const blobResourceContents: BlobResourceContents = {
  uri: resource.uri,
  mimeType: "application/octet-stream",
  blob: "aGVsbG8=",
};

const resourceContentsItems: ResourceContents[] = [textResourceContents, blobResourceContents];

// @ts-expect-error Resource.uri is required.
const resourceMissingUri: Resource = {
  name: "README",
};

// @ts-expect-error ResourceTemplate.uriTemplate is required.
const resourceTemplateMissingUriTemplate: ResourceTemplate = {
  name: "Project file",
};

// @ts-expect-error ResourceContents must include text or blob.
const invalidResourceContents: ResourceContents = {
  uri: resource.uri,
  mimeType: "text/plain",
};

void resourceMissingUri;
void resourceTemplateMissingUriTemplate;
void invalidResourceContents;
void resourceContentsItems;
void paginatedParams;
void paginatedResult;
void resourceTemplate;
