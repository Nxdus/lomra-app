"""Makes one 3D model (GLB) from one picture.

Run by `src/local3d.mjs` inside the Python environment it installs:
    python worker.py hunyuan <image> <glb> <repo> <subfolder>
    python worker.py triposr <image> <glb> <model folder> <dino config.json>

Each line printed to stdout is a JSON progress event. Weights are read from disk and nothing is downloaded.
"""
import json
import sys


def say(stage, **extra):
    print(json.dumps({"stage": stage, **extra}), flush=True)


def has_cutout(image):
    """True when the picture already has transparent pixels, so it needs no background removal."""
    return image.getchannel("A").getextrema()[0] < 255


def hunyuan(image_path, out_path, repo, subfolder):
    import torch
    from PIL import Image
    from hy3dgen.rembg import BackgroundRemover
    from hy3dgen.shapegen import (
        DegenerateFaceRemover,
        FaceReducer,
        FloaterRemover,
        Hunyuan3DDiTFlowMatchingPipeline,
    )

    image = Image.open(image_path).convert("RGBA")
    if not has_cutout(image):
        say("background")
        image = BackgroundRemover()(image.convert("RGB"))

    say("model")
    pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=subfolder, use_safetensors=True, device="cuda")
    pipeline.enable_flashvdm(mc_algo="mc")

    say("shape")
    with torch.inference_mode():
        mesh = pipeline(
            image=image,
            num_inference_steps=5,
            guidance_scale=5.0,
            octree_resolution=256,
            num_chunks=20000,
            generator=torch.Generator("cuda").manual_seed(1234),
            output_type="trimesh",
        )[0]

    say("mesh")
    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=40000)
    mesh.export(out_path, file_type="glb")


def triposr(image_path, out_path, model_dir, dino_config):
    import numpy as np
    import rembg
    import torch
    import trimesh
    from PIL import Image

    # TripoSR asks Hugging Face for DINO's config file; hand it the pinned copy instead.
    import tsr.models.tokenizers.image as tokenizer

    download = tokenizer.hf_hub_download
    tokenizer.hf_hub_download = lambda repo_id, filename, **kwargs: dino_config if repo_id == "facebook/dino-vitb16" else download(repo_id=repo_id, filename=filename, **kwargs)
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground

    say("background")
    image = remove_background(Image.open(image_path), rembg.new_session())
    image = resize_foreground(image, 0.85)
    image = np.array(image).astype(np.float32) / 255.0
    image = image[:, :, :3] * image[:, :, 3:4] + (1 - image[:, :, 3:4]) * 0.5
    image = Image.fromarray((image * 255.0).astype(np.uint8))

    say("model")
    model = TSR.from_pretrained(model_dir, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(4096)
    model.to("cuda")

    say("shape")
    with torch.no_grad():
        codes = model([image], device="cuda")

    say("mesh")
    mesh = model.extract_mesh(codes, True, resolution=256)[0]
    # The stand-in marching cubes may wind faces the other way round; turn an inside-out mesh the right way out.
    trimesh.repair.fix_inversion(mesh)
    mesh.export(out_path, file_type="glb")


def main(kind, image_path, out_path, *args):
    say("loading")
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("no-cuda")
    {"hunyuan": hunyuan, "triposr": triposr}[kind](image_path, out_path, *args)
    say("done")


if __name__ == "__main__":
    try:
        main(*sys.argv[1:])
    except Exception as error:  # reported to the app as a short, readable reason
        text = str(error)
        reason = "memory" if "out of memory" in text.lower() else "no-cuda" if text == "no-cuda" else "failed"
        print(json.dumps({"stage": "error", "reason": reason, "detail": text[-300:]}), flush=True)
        sys.exit(1)
