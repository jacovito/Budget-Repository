const DATABASE_NAME = "paycheck-planner";
const DATABASE_VERSION = 1;
const PROFILE_STORE = "profiles";
const PLAN_STORE = "plans";

export type LocalProfile = { id: string; name: string; createdAt: string; updatedAt: string; lastBackupAt?: string };
type StoredPlan<T> = { profileId: string; plan: T; updatedAt: string };
export type StorageStatus = { persisted: boolean; usage?: number; quota?: number };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROFILE_STORE)) database.createObjectStore(PROFILE_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(PLAN_STORE)) database.createObjectStore(PLAN_STORE, { keyPath: "profileId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
    request.onblocked = () => reject(new Error("Local storage is blocked by another open version of the app."));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local storage transaction was cancelled."));
  });
}

export async function listProfiles(): Promise<LocalProfile[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILE_STORE, "readonly");
    const request = transaction.objectStore(PROFILE_STORE).getAll();
    const profiles = await new Promise<LocalProfile[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as LocalProfile[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read local workspaces."));
    });
    await complete(transaction);
    return profiles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally { database.close(); }
}

export async function putProfile(profile: LocalProfile): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROFILE_STORE, "readwrite");
    transaction.objectStore(PROFILE_STORE).put(profile);
    await complete(transaction);
  } finally { database.close(); }
}

export async function deleteProfile(profileId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([PROFILE_STORE, PLAN_STORE], "readwrite");
    transaction.objectStore(PROFILE_STORE).delete(profileId);
    transaction.objectStore(PLAN_STORE).delete(profileId);
    await complete(transaction);
  } finally { database.close(); }
}

export async function loadPlan<T>(profileId: string): Promise<T | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PLAN_STORE, "readonly");
    const request = transaction.objectStore(PLAN_STORE).get(profileId);
    const record = await new Promise<StoredPlan<T> | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as StoredPlan<T> | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not read this budget."));
    });
    await complete(transaction);
    return record?.plan ?? null;
  } finally { database.close(); }
}

export async function savePlan<T>(profileId: string, plan: T): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PLAN_STORE, "readwrite");
    transaction.objectStore(PLAN_STORE).put({ profileId, plan, updatedAt: new Date().toISOString() } satisfies StoredPlan<T>);
    await complete(transaction);
  } finally { database.close(); }
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  if (!("storage" in navigator)) return { persisted: false };
  let persisted = await navigator.storage.persisted?.() ?? false;
  if (!persisted) persisted = await navigator.storage.persist?.() ?? false;
  const estimate = await navigator.storage.estimate?.();
  return { persisted, usage: estimate?.usage, quota: estimate?.quota };
}
