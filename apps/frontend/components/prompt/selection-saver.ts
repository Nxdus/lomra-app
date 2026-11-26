/** Serialize writes so a slow earlier save cannot overwrite a newer choice. */
export function createSelectionSaver(saved: string[], write: (models: string[]) => Promise<void>) {
  let pending = Promise.resolve();
  return (models: string[]) => {
    const saving = pending.then(async () => {
      if (models.length === saved.length && models.every((value, index) => value === saved[index])) return;
      await write(models);
      saved = models;
    });
    pending = saving.catch(() => {});
    return saving;
  };
}
