import { createSecretStore, EncryptedFileStore, KeychainStore, MigratingSecretStore, key, type SecretStore, type CreateSecretStoreInput } from "../src/index.js";
const input: CreateSecretStoreInput = { backend:"file",fileStore:{salt:"example",filePath:"/example.enc",getMachineIdentity:async()=>({hostname:"host",username:"user"})} };
const file: SecretStore = new EncryptedFileStore(input.fileStore!);
const keychain: SecretStore = new KeychainStore({service:"example",account:key("provider"),runCommand:async()=>({exitCode:0,stdout:"",stderr:""})});
const migration: SecretStore = new MigratingSecretStore(file,keychain);
const store: SecretStore = createSecretStore(input).store;
const secret: Promise<string|null> = migration.get({readOnly:true});
void secret;void store;
