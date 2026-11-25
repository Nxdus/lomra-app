import type { SdCapabilities, SdProfile, SdRange, SdStatus } from "./desktop";
import { sdNegativePromptLimit, sdRanges, type SdNumber } from "./sd-settings";

export type PictureCapabilities = SdCapabilities & {
  maxInputImages: number;
  profile?: SdProfile;
  defaults: {
    steps?: number;
    cfg?: number;
    strength?: number;
  };
  ranges: Record<SdNumber, SdRange>;
  negativePromptLimit: number;
};

const defaultRanges: Record<SdNumber, SdRange> = { ...sdRanges };

const fallbackLocalCapabilities: PictureCapabilities = {
  textToImage: true,
  imageToImage: true,
  inpaint: true,
  negativePrompt: true,
  cfg: true,
  strength: true,
  outpaint: false,
  referencePictures: false,
  maxInputImages: 1,
  defaults: {},
  ranges: defaultRanges,
  negativePromptLimit: sdNegativePromptLimit,
};

const googleCapabilities: PictureCapabilities = {
  textToImage: true,
  imageToImage: false,
  inpaint: false,
  negativePrompt: false,
  cfg: false,
  strength: false,
  outpaint: false,
  referencePictures: false,
  maxInputImages: 0,
  defaults: {},
  ranges: defaultRanges,
  negativePromptLimit: sdNegativePromptLimit,
};

const hostedCapabilities: PictureCapabilities = {
  textToImage: true,
  imageToImage: true,
  inpaint: true,
  negativePrompt: false,
  cfg: false,
  strength: false,
  outpaint: true,
  referencePictures: true,
  maxInputImages: 10,
  defaults: {},
  ranges: defaultRanges,
  negativePromptLimit: sdNegativePromptLimit,
};

/** What the selected picture model supports: local models come from `sdStatus`, hosted models from provider support. */
export function pictureCapabilities(model: string, sdStatus?: SdStatus | null): PictureCapabilities {
  if (model.startsWith("sd/")) {
    const profile = sdStatus?.models.find((item) => item.id === model.slice(3))?.profile;
    if (!profile) return fallbackLocalCapabilities;
    const { capabilities, ranges } = profile;
    return {
      ...capabilities,
      maxInputImages: capabilities.referencePictures ? 10 : capabilities.imageToImage ? 1 : 0,
      profile,
      defaults: { steps: profile.steps, cfg: profile.cfg, strength: profile.strength },
      ranges: {
        seed: sdRanges.seed,
        steps: ranges.steps,
        cfg: ranges.cfg,
        strength: ranges.strength,
      },
      negativePromptLimit: sdNegativePromptLimit,
    };
  }
  if (model.startsWith("google-ai/")) return googleCapabilities;
  return hostedCapabilities;
}
