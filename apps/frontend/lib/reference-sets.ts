export const referenceSetNameLimit = 80;

export type ReferenceImage = { name: string; url: string };
export type ReferenceSet = { id: string; name: string; images: ReferenceImage[] };
