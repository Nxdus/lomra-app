/**
 * Local image-to-3D runs in one private Python environment that the app installs on request, shared by every model
 * below. Everything is pinned: downloads are checked against a SHA-256, packages are exact versions, and the renderer
 * can only ask to install or remove a model by id. Bump `local3dVersion` whenever an engine pin changes so existing
 * installs are redone.
 */
export const local3dVersion = 3;

/** The uv installer (https://github.com/astral-sh/uv) that creates the Python environment. Windows only for now. */
const uvRelease = '0.13.9';
export const local3dUv = {
  'win32-x64': {
    asset: 'uv-x86_64-pc-windows-msvc.zip',
    url: `https://github.com/astral-sh/uv/releases/download/${uvRelease}/uv-x86_64-pc-windows-msvc.zip`,
    sha256: 'edd61f7f5728a56cc62455386661860bdfc7bab65872f39b0c25bdcc1d8e1beb', bytes: 15567875,
  },
};

/** PyTorch with CUDA 12.4, the build the models were tested with. Runs on NVIDIA GeForce 10-series and newer. */
export const local3dTorch = { requirements: ['torch==2.5.1', 'torchvision==0.20.1'], index: 'https://download.pytorch.org/whl/cu124' };

/** The Hunyuan3D-2 code (`hy3dgen`) at a fixed commit. Tencent Hunyuan Community License. */
const hunyuanCommit = 'f8db63096c8282cb27354314d896feba5ba6ff8a';
export const local3dSource = {
  url: `https://github.com/Tencent-Hunyuan/Hunyuan3D-2/archive/${hunyuanCommit}.zip`,
  sha256: '1be140879646034a98941e494072ce0ab26918fdc2fb59210443d56d41bc5622', bytes: 80303566,
};

/** The Python packages every model imports (no texture pipeline, so nothing has to be compiled). */
export const local3dPackages = [
  'numpy==1.26.4', 'pillow==10.4.0', 'scipy==1.14.1', 'scikit-image==0.25.0', 'tqdm==4.67.1', 'pyyaml==6.0.2',
  'safetensors==0.5.2', 'huggingface_hub==0.27.1', 'transformers==4.48.3', 'diffusers==0.32.2', 'accelerate==1.3.0',
  'einops==0.8.0', 'omegaconf==2.3.0', 'trimesh==4.6.1', 'pymeshlab==2023.12.post2', 'opencv-python-headless==4.10.0.84',
  'imageio==2.36.1', 'rembg==2.0.62', 'onnxruntime==1.20.1',
];
/** Roughly what PyTorch and the packages above download, for the size shown before installing. */
export const local3dPackagesBytes = 3_300_000_000;

/** Files every model needs, relative to the install folder: the background remover's network (rembg's U²-Net). */
export const local3dDownloads = [
  { path: 'u2net/u2net.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx', sha256: '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491', bytes: 175997641 },
];

const hunyuanWeight = (repo, revision, file, sha256, bytes) => ({ path: `${repo}/${file}`, url: `https://huggingface.co/${repo}/resolve/${revision}/${file}`, sha256, bytes });
const miniRevision = 'f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6';
const fullRevision = '9cd649ba6913f7a852e3286bad86bfa9a2d83dcf';

/** TripoSR (VAST-AI-Research, MIT) code at a fixed commit; it has no installer, so it is unpacked and put on `PYTHONPATH`. */
const triposrCommit = '107cefdc244c39106fa830359024f6a2f1c78871';
const triposrRevision = '5b521936b01fbe1890f6f9baed0254ab6351c04a';
const dinoRevision = 'f205d5d8e640a89a2b8ef0369670dfc37cc07fc2';

const hunyuanLicense = 'Tencent Hunyuan Community License, which does not cover the EU, UK and South Korea';

/**
 * Models the user can install. `kind` picks the worker code. `weights` paths are relative to the models folder, laid out the
 * way `HY3DGEN_MODELS` expects for the Hunyuan models. `needs` is video memory in MiB, checked before installing.
 */
export const local3dModels = [
  {
    id: 'hunyuan-2mini', name: 'Hunyuan3D 2 Mini', quality: 'Balanced', default: true, kind: 'hunyuan', folder: 'tencent/Hunyuan3D-2mini', needs: 6000,
    note: 'Clean shapes without color.', license: hunyuanLicense,
    repo: 'tencent/Hunyuan3D-2mini', subfolder: 'hunyuan3d-dit-v2-mini-turbo',
    weights: [
      hunyuanWeight('tencent/Hunyuan3D-2mini', miniRevision, 'hunyuan3d-dit-v2-mini-turbo/config.yaml', 'be28205844da01bd5d3c5ba5160f5886fb9765d542483f9d12bda8f17324db5e', 1664),
      hunyuanWeight('tencent/Hunyuan3D-2mini', miniRevision, 'hunyuan3d-dit-v2-mini-turbo/model.fp16.safetensors', 'bdbcef30dd0149a281e17d5b5b1fdad1122c904e098a42f3100e04e03c247bc4', 3822584202),
      hunyuanWeight('tencent/Hunyuan3D-2mini', miniRevision, 'hunyuan3d-vae-v2-mini-turbo/config.yaml', '75315e176c36b290b317f187a46adc08f01a7193836f8e77767eec76e868d2ab', 335),
      hunyuanWeight('tencent/Hunyuan3D-2mini', miniRevision, 'hunyuan3d-vae-v2-mini-turbo/model.fp16.safetensors', '5dcaca67a8da9e7079fb7b55714a572d0651ac95983bb43099913feaf6738f94', 407410402),
    ],
  },
  {
    id: 'hunyuan-2', name: 'Hunyuan3D 2', quality: 'Best detail', kind: 'hunyuan', folder: 'tencent/Hunyuan3D-2', needs: 8000,
    note: 'Sharper shapes than Mini, without color. Needs about 8 GB of graphics memory.', license: hunyuanLicense,
    repo: 'tencent/Hunyuan3D-2', subfolder: 'hunyuan3d-dit-v2-0-turbo',
    weights: [
      hunyuanWeight('tencent/Hunyuan3D-2', fullRevision, 'hunyuan3d-dit-v2-0-turbo/config.yaml', '4712421fe32d57c678be3be2b608acdb8871985f0b81646a883d136abc63feb7', 1663),
      hunyuanWeight('tencent/Hunyuan3D-2', fullRevision, 'hunyuan3d-dit-v2-0-turbo/model.fp16.safetensors', '5ee5a81e4df08a1c65b79910bf5b145a90376e526794f4607a4d5d068d62f269', 4930777530),
      hunyuanWeight('tencent/Hunyuan3D-2', fullRevision, 'hunyuan3d-vae-v2-0-turbo/config.yaml', '91355c5acc412149996d19dbe46040d10fab888efd8bb910c76bad3a550f6ceb', 336),
      hunyuanWeight('tencent/Hunyuan3D-2', fullRevision, 'hunyuan3d-vae-v2-0-turbo/model.fp16.safetensors', '66b7af697118db2de00c22f63a385c75f9049709739281971837af9e4ce31cb4', 407410402),
    ],
  },
  {
    id: 'triposr', name: 'TripoSR', quality: 'Fastest · colored', kind: 'triposr', folder: 'triposr', needs: 6000,
    note: 'Makes a colored mesh in seconds.', license: 'MIT license',
    source: {
      path: 'sources/triposr', url: `https://github.com/VAST-AI-Research/TripoSR/archive/${triposrCommit}.zip`,
      sha256: 'a7b3871a1b4377bef96cbfb99bdc952bdd4f5df9f65fea4208d978a343fd1162', bytes: 31282920,
    },
    weights: [
      { path: 'triposr/config.yaml', url: `https://huggingface.co/stabilityai/TripoSR/resolve/${triposrRevision}/config.yaml`, sha256: '74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62', bytes: 987 },
      { path: 'triposr/model.ckpt', url: `https://huggingface.co/stabilityai/TripoSR/resolve/${triposrRevision}/model.ckpt`, sha256: '429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee', bytes: 1677246742 },
      { path: 'triposr/dino-vitb16-config.json', url: `https://huggingface.co/facebook/dino-vitb16/resolve/${dinoRevision}/config.json`, sha256: 'b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c', bytes: 454 },
    ],
  },
];

export const defaultLocal3dModel = local3dModels.find((model) => model.default).id;
