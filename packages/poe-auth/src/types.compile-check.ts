import type {
  AuthBackend,
  AuthStoreWarningLogger,
  AuthStore,
  CreateAuthStoreInput,
  CreateAuthStoreResult,
  LegacyCredentialsMigrationFileSystem,
  LegacyCredentialsMigrationInput
} from "./types.js";
import type {
  AuthBackend as AuthBackendFromIndex,
  AuthStoreWarningLogger as AuthStoreWarningLoggerFromIndex,
  AuthStore as AuthStoreFromIndex,
  CreateAuthStoreInput as CreateAuthStoreInputFromIndex,
  CreateAuthStoreResult as CreateAuthStoreResultFromIndex,
  LegacyCredentialsMigrationFileSystem as LegacyCredentialsMigrationFileSystemFromIndex,
  LegacyCredentialsMigrationInput as LegacyCredentialsMigrationInputFromIndex
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredAuthStoreExported = AssertAssignable<AuthStore, AuthStoreFromIndex>;
type ignoredAuthStoreMatches = AssertAssignable<AuthStoreFromIndex, AuthStore>;

type ignoredAuthBackendExported = AssertAssignable<AuthBackend, AuthBackendFromIndex>;
type ignoredAuthBackendMatches = AssertAssignable<AuthBackendFromIndex, AuthBackend>;

type ignoredCreateAuthStoreInputExported =
  AssertAssignable<CreateAuthStoreInput, CreateAuthStoreInputFromIndex>;
type ignoredCreateAuthStoreInputMatches =
  AssertAssignable<CreateAuthStoreInputFromIndex, CreateAuthStoreInput>;

type ignoredCreateAuthStoreResultExported =
  AssertAssignable<CreateAuthStoreResult, CreateAuthStoreResultFromIndex>;
type ignoredCreateAuthStoreResultMatches =
  AssertAssignable<CreateAuthStoreResultFromIndex, CreateAuthStoreResult>;

type ignoredWarningLoggerExported =
  AssertAssignable<AuthStoreWarningLogger, AuthStoreWarningLoggerFromIndex>;
type ignoredWarningLoggerMatches =
  AssertAssignable<AuthStoreWarningLoggerFromIndex, AuthStoreWarningLogger>;

type ignoredLegacyFsExported = AssertAssignable<
  LegacyCredentialsMigrationFileSystem,
  LegacyCredentialsMigrationFileSystemFromIndex
>;
type ignoredLegacyFsMatches = AssertAssignable<
  LegacyCredentialsMigrationFileSystemFromIndex,
  LegacyCredentialsMigrationFileSystem
>;

type ignoredLegacyInputExported = AssertAssignable<
  LegacyCredentialsMigrationInput,
  LegacyCredentialsMigrationInputFromIndex
>;
type ignoredLegacyInputMatches = AssertAssignable<
  LegacyCredentialsMigrationInputFromIndex,
  LegacyCredentialsMigrationInput
>;

type ignoredAuthBackendShape = AssertAssignable<AuthBackend, "file" | "keychain">;
type ignoredAuthBackendShapeMatches = AssertAssignable<"file" | "keychain", AuthBackend>;
