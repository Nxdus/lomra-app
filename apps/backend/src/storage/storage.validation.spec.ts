import { validateSavedState } from './storage.validation.js';

describe('saved canvas and settings validation', () => {
  const item = {
    id: 'file-1',
    name: 'image.png',
    type: 'image/png',
    lastModified: 0,
    x: -20,
    y: 30,
    width: 320,
    height: 200,
  };

  it('accepts empty canvases, file metadata and supported settings', () => {
    const id = 'canvas-1794300000000-12345678-1234-1234-1234-123456789abc';
    expect(() => validateSavedState('canvas', id, [item])).not.toThrow();
    expect(() =>
      validateSavedState('settings', `camera-${id}`, { x: 0, y: 0, scale: 1 }),
    ).not.toThrow();
    expect(() => validateSavedState('canvas', 'invalid', [])).toThrow();
    expect(() => validateSavedState('canvas', 'default', [])).not.toThrow();
    expect(() => validateSavedState('canvas', 'default', [item])).not.toThrow();
    expect(() =>
      validateSavedState('settings', 'camera', { x: 20, y: -3, scale: 0.2 }),
    ).not.toThrow();
    expect(() =>
      validateSavedState('settings', 'custom-models', [
        {
          value: '3d:my-model',
          name: 'My model',
          capabilities: ['image-to-3d'],
        },
      ]),
    ).not.toThrow();
    expect(() =>
      validateSavedState('settings', 'selected-models', ['llm:test/model']),
    ).not.toThrow();
  });

  it('rejects unsafe IDs, duplicate files, invalid geometry and unknown settings', () => {
    for (const invalid of [
      { ...item, id: '../other-user' },
      { ...item, width: -1 },
      { ...item, x: Infinity },
      { ...item, lastModified: -1 },
      null,
    ]) {
      expect(() =>
        validateSavedState('canvas', 'default', [invalid]),
      ).toThrow();
    }
    expect(() =>
      validateSavedState('canvas', 'default', [item, item]),
    ).toThrow();
    expect(() =>
      validateSavedState('settings', 'camera', { x: 0, y: 0, scale: 100 }),
    ).toThrow();
    expect(() =>
      validateSavedState('settings', 'custom-models', [
        { value: 'unknown:model', name: 'Bad' },
      ]),
    ).toThrow();
    expect(() => validateSavedState('settings', 'unknown', {})).toThrow();
  });
});
