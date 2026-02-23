const KEY_PREFIX = "dfg_";

export const StorageKeys = {
  events: `${KEY_PREFIX}events`,
  deferred: `${KEY_PREFIX}deferred`,
  samples: `${KEY_PREFIX}samples`,
  modelArtifacts: `${KEY_PREFIX}model_artifacts`,
  modelMeta: `${KEY_PREFIX}model_meta`
} as const;

export async function storageGet<T>(key: string): Promise<T | undefined> {
  const out = await chrome.storage.local.get(key);
  return out[key] as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function storageRemove(keys: string | string[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}

