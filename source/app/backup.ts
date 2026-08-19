export type BackupContents<T> = { profileName: string; plan: T };
type PlainBackup<T> = { format: "paycheck-planner"; version: 1; createdAt: string; encrypted: false; profileName: string; plan: T };
type EncryptedBackup = {
  format: "paycheck-planner"; version: 1; createdAt: string; encrypted: true;
  encryption: { algorithm: "AES-GCM"; keyDerivation: "PBKDF2-SHA-256"; iterations: number; salt: string; iv: string };
  payload: string;
};
const ITERATIONS = 250_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function encryptionKey(password: string, salt: Uint8Array, iterations: number) {
  const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, passwordKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export async function createBackup<T>(contents: BackupContents<T>, password = ""): Promise<string> {
  if (!password) {
    const backup: PlainBackup<T> = { format: "paycheck-planner", version: 1, createdAt: new Date().toISOString(), encrypted: false, ...contents };
    return JSON.stringify(backup, null, 2);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(password, salt, ITERATIONS);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(contents)));
  const backup: EncryptedBackup = {
    format: "paycheck-planner", version: 1, createdAt: new Date().toISOString(), encrypted: true,
    encryption: { algorithm: "AES-GCM", keyDerivation: "PBKDF2-SHA-256", iterations: ITERATIONS, salt: bytesToBase64(salt), iv: bytesToBase64(iv) },
    payload: bytesToBase64(new Uint8Array(encrypted)),
  };
  return JSON.stringify(backup, null, 2);
}

export function backupNeedsPassword(text: string): boolean {
  return (JSON.parse(text) as { encrypted?: unknown }).encrypted === true;
}

export async function readBackup<T>(text: string, password = ""): Promise<BackupContents<T>> {
  let parsed: PlainBackup<T> | EncryptedBackup;
  try { parsed = JSON.parse(text) as PlainBackup<T> | EncryptedBackup; }
  catch { throw new Error("This is not a readable Paycheck backup file."); }
  if (!("format" in parsed) && typeof parsed === "object" && parsed !== null && "month" in parsed) return { profileName: "Imported budget", plan: parsed as T };
  if (parsed.format !== "paycheck-planner" || parsed.version !== 1) throw new Error("This backup format is not supported by this version of Paycheck.");
  if (!parsed.encrypted) {
    if (!parsed.profileName || !parsed.plan) throw new Error("This backup is missing required budget data.");
    return { profileName: parsed.profileName, plan: parsed.plan };
  }
  if (!password) throw new Error("Enter the password used when this backup was created.");
  try {
    const salt = base64ToBytes(parsed.encryption.salt);
    const iv = base64ToBytes(parsed.encryption.iv);
    const key = await encryptionKey(password, salt, parsed.encryption.iterations);
    const cleartext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, base64ToBytes(parsed.payload));
    const contents = JSON.parse(new TextDecoder().decode(cleartext)) as BackupContents<T>;
    if (!contents.profileName || !contents.plan) throw new Error("Missing backup contents.");
    return contents;
  } catch { throw new Error("The password is incorrect, or the encrypted backup is damaged."); }
}
