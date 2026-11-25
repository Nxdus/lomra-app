/**
 * Capabilities, defaults and ranges of each local image model profile.
 * Adding a new kind of local image model means adding one entry here (plus engine arguments in `sd.mjs` only if needed).
 */
export const defaultSdCapabilities = {
  textToImage: true,
  imageToImage: true,
  inpaint: true,
  negativePrompt: true,
  cfg: true,
  strength: true,
  outpaint: false,
  referencePictures: false,
};

export const defaultSdRanges = {
  steps: { min: 1, max: 50, whole: true },
  cfg: { min: 0, max: 20, whole: false },
  strength: { min: 0, max: 1, whole: false },
};

/** stable-diffusion.cpp's own default for image-to-image. */
export const defaultSdStrength = 0.75;

const fullCapabilities = { ...defaultSdCapabilities };
// With CFG 1 the unconditional pass is skipped, so a negative prompt has no effect.
const fewStepCapabilities = { ...defaultSdCapabilities, negativePrompt: false, cfg: false };

export const sdProfiles = [
  {
    id: 'sd15',
    name: 'Stable Diffusion 1.x / 2.x',
    note: '512 px, 20 steps',
    size: 512,
    steps: 20,
    cfg: 7,
    strength: defaultSdStrength,
    headerTypes: ['sd15'],
    ranges: {
      steps: { min: 1, max: 50, whole: true },
      cfg: { min: 0, max: 20, whole: false },
      strength: { min: 0, max: 1, whole: false },
    },
    capabilities: fullCapabilities,
  },
  {
    id: 'sdxl',
    name: 'SDXL',
    note: '1024 px, 25 steps',
    size: 1024,
    steps: 25,
    cfg: 7,
    strength: defaultSdStrength,
    headerTypes: ['sdxl'],
    ranges: {
      steps: { min: 1, max: 50, whole: true },
      cfg: { min: 0, max: 20, whole: false },
      strength: { min: 0, max: 1, whole: false },
    },
    capabilities: fullCapabilities,
  },
  {
    id: 'turbo',
    name: 'Turbo (few steps)',
    note: '512 px, 4 steps',
    size: 512,
    steps: 4,
    cfg: 1,
    strength: defaultSdStrength,
    headerTypes: ['sd15', 'sdxl'],
    ranges: {
      steps: { min: 1, max: 12, whole: true },
      cfg: { min: 1, max: 1, whole: false },
      strength: { min: 0, max: 1, whole: false },
    },
    capabilities: fewStepCapabilities,
  },
  {
    id: 'sdxl-few',
    name: 'SDXL Lightning or Turbo (few steps)',
    note: '1024 px, 6 steps',
    size: 1024,
    steps: 6,
    cfg: 1,
    strength: defaultSdStrength,
    headerTypes: ['sdxl'],
    ranges: {
      steps: { min: 1, max: 12, whole: true },
      cfg: { min: 1, max: 1, whole: false },
      strength: { min: 0, max: 1, whole: false },
    },
    capabilities: fewStepCapabilities,
  },
];

export const findSdProfile = (id, profiles = sdProfiles) => profiles.find((profile) => profile.id === id);

/** Serializable shape sent to the renderer. */
export function publicSdProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    note: profile.note,
    size: profile.size,
    steps: profile.steps,
    cfg: profile.cfg,
    strength: profile.strength,
    ranges: {
      steps: { ...profile.ranges.steps },
      cfg: { ...profile.ranges.cfg },
      strength: { ...profile.ranges.strength },
    },
    capabilities: { ...profile.capabilities },
  };
}

/** Profiles compatible with a probed checkpoint header (`{ supported, headerType }`). */
export function compatibleSdProfiles(header, profiles = sdProfiles) {
  if (header && header.supported === false) return [];
  if (header?.headerType) return profiles.filter((profile) => Array.isArray(profile.headerTypes) && profile.headerTypes.includes(header.headerType));
  return [...profiles];
}

/** Resolves a model definition, profile id, or partial profile object to a full profile. */
export function resolveSdProfile(modelOrProfile, profiles = sdProfiles) {
  if (!modelOrProfile) return undefined;
  if (typeof modelOrProfile === 'string') {
    const found = findSdProfile(modelOrProfile, profiles);
    return found ? resolveSdProfile(found, profiles) : undefined;
  }
  const ref = modelOrProfile.profile ?? modelOrProfile.family;
  if (typeof ref === 'string') {
    const found = findSdProfile(ref, profiles);
    if (found) return resolveSdProfile(found, profiles);
  }
  return {
    id: modelOrProfile.id ?? 'custom',
    name: modelOrProfile.name ?? modelOrProfile.quality ?? 'Custom',
    note: modelOrProfile.note ?? '',
    size: modelOrProfile.size ?? 512,
    steps: modelOrProfile.steps ?? 20,
    cfg: modelOrProfile.cfg ?? 7,
    strength: modelOrProfile.strength ?? defaultSdStrength,
    headerTypes: Array.isArray(modelOrProfile.headerTypes) ? [...modelOrProfile.headerTypes] : [],
    ranges: {
      steps: { ...defaultSdRanges.steps, ...modelOrProfile.ranges?.steps },
      cfg: { ...defaultSdRanges.cfg, ...modelOrProfile.ranges?.cfg },
      strength: { ...defaultSdRanges.strength, ...modelOrProfile.ranges?.strength },
    },
    capabilities: { ...defaultSdCapabilities, ...modelOrProfile.capabilities },
  };
}
