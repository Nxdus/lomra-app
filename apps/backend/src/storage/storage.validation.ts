import { BadRequestException } from '@nestjs/common';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;
const model = (value: unknown) =>
  typeof value === 'string' &&
  /^(llm|picture|video|3d):\S.{0,511}$/.test(value);

export function validateSavedState(kind: string, id: string, value: unknown) {
  let valid = false;
  if (
    kind === 'canvas' &&
    (id === 'default' || /^canvas-\d{13}-[a-f0-9-]{36}$/.test(id)) &&
    Array.isArray(value) &&
    value.length <= 5000
  ) {
    const ids = new Set<string>();
    valid = value.every((item: unknown) => {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        !/^[\w-]{1,128}$/.test(item.id) ||
        ids.has(item.id)
      )
        return false;
      ids.add(item.id);
      return (
        typeof item.name === 'string' &&
        item.name.length <= 512 &&
        typeof item.type === 'string' &&
        item.type.length <= 128 &&
        typeof item.lastModified === 'number' &&
        Number.isSafeInteger(item.lastModified) &&
        item.lastModified >= 0 &&
        ['x', 'y', 'width', 'height'].every((key) => finite(item[key])) &&
        (item.width as number) > 0 &&
        (item.height as number) > 0
      );
    });
  }
  if (kind === 'settings') {
    if (id === 'camera' || /^camera-canvas-\d{13}-[a-f0-9-]{36}$/.test(id))
      valid =
        record(value) &&
        finite(value.x) &&
        finite(value.y) &&
        typeof value.scale === 'number' &&
        value.scale >= 0.2 &&
        value.scale <= 4;
    if (id === 'prompt-position')
      valid = record(value) && finite(value.x) && finite(value.y);
    if (id === 'selected-models')
      valid = Array.isArray(value) && value.length <= 4 && value.every(model);
    if (id === 'custom-models')
      valid =
        Array.isArray(value) &&
        value.length <= 500 &&
        value.every(
          (item: unknown) =>
            record(item) &&
            model(item.value) &&
            typeof item.name === 'string' &&
            item.name.trim().length > 0 &&
            item.name.length <= 200 &&
            (item.capabilities === undefined ||
              (Array.isArray(item.capabilities) &&
                item.capabilities.every((capability) =>
                  ['text-to-3d', 'image-to-3d', 'multi-view-to-3d'].includes(
                    capability,
                  ),
                ))),
        );
  }
  if (!valid) throw new BadRequestException('Invalid saved state');
}
