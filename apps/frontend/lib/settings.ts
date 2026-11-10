import { canImportBrowserData, storage } from './storage';

export async function getSetting<T>(id: string, legacyKey?: string): Promise<T | undefined> {
  const rows: { id: string; value: T }[] = await storage('settings');
  const saved = rows.find((row) => row.id === id);
  if (saved) return saved.value;
  if (legacyKey && await canImportBrowserData()) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      const value: T = JSON.parse(legacy);
      await saveSetting(id, value);
      return value;
    }
  }
}

export async function saveSetting(id: string, value: unknown) {
  await storage(`settings/${encodeURIComponent(id)}`, 'PUT', value);
}
