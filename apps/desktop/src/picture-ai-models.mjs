/**
 * Local picture tools (background removal and upscaling) run ONNX models on CPU through `onnxruntime-node`.
 * Every model below allows commercial use and is pinned by commit revision, SHA-256 and exact byte size;
 * the renderer can only pick them by id or operation.
 */
export const pictureAiModels = [
  {
    id: 'birefnet-lite',
    operation: 'remove-background',
    name: 'BiRefNet Lite',
    quality: 'Background removal',
    note: 'Soft alpha edges at original size. Commercial use allowed.',
    license: 'MIT license',
    source: 'https://github.com/ZhengPeng7/BiRefNet',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
    file: 'onnx/model.onnx',
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model.onnx',
    sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
    bytes: 224005088,
  },
  {
    id: 'realesrgan-x4v3',
    operation: 'upscale',
    name: 'Real-ESRGAN x4v3',
    quality: '2× & 4× upscaling',
    note: 'Sharpens photos and illustrations on CPU. Commercial use allowed.',
    license: 'BSD-3-Clause license',
    source: 'https://github.com/xinntao/Real-ESRGAN',
    repo: 'Heliosoph/realesrgan-onnx',
    revision: '488e5dda07333179f229a6205d92135eea4c25e9',
    file: 'realesr-general-x4v3.onnx',
    url: 'https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/488e5dda07333179f229a6205d92135eea4c25e9/realesr-general-x4v3.onnx',
    sha256: '09b757accd747d7e423c1d352b3e8f23e77cc5742d04bae958d4eb8082b76fa4',
    bytes: 4871181,
  },
];

export const pictureAiModelFor = (operation) => pictureAiModels.find((model) => model.operation === operation);
