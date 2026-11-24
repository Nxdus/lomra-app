export type SdFile = { id: string; file: string; bytes: number };

const stem = (file: string) => file.replace(/\.[^.]+$/, "");

/** What the files of one repository have in common, as a title, and what is left of each, as its version. */
export function sdVersions(repo: string, files: SdFile[]) {
  const names = files.map((item) => stem(item.file));
  let common = names[0] ?? "";
  for (const name of names) while (!name.startsWith(common)) common = common.slice(0, -1);
  // Only whole words: "model-Q4" and "model-Q8" share "model-", not "model-Q".
  const shared = names.length > 1 ? /^.*[-_. ]/.exec(common)?.[0] ?? "" : "";
  const title = names.length === 1 ? names[0] : shared.replace(/[-_. ]+$/, "");
  const useful = title.length >= 4;
  return {
    title: useful ? title : repo.slice(repo.indexOf("/") + 1),
    label: (file: string) => useful && names.length > 1 ? stem(file).slice(shared.length) || stem(file) : stem(file),
  };
}

/** The file to offer first: 8-bit, else half precision, else the smallest, and one the graphics card can hold if its memory is known. */
export function defaultSdFile(files: SdFile[], gpuBytes: number) {
  const smallest = [...files].sort((a, b) => a.bytes - b.bytes);
  const fitting = gpuBytes ? smallest.filter((item) => item.bytes <= gpuBytes) : smallest;
  const choice = fitting.length ? fitting : smallest;
  return choice.find((item) => /q8_0/i.test(item.file)) ?? choice.find((item) => /fp16|f16|half/i.test(item.file)) ?? choice[0];
}
