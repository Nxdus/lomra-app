"""A stand-in for the `torchmcubes` package, which has no Windows wheel and has to be compiled.

TripoSR only calls `marching_cubes(volume, threshold)`. This answers it with scikit-image on the CPU. The compiled package
returns vertices with their axes reversed (TripoSR reverses them back), so this does the same.
"""
import numpy as np
import torch
from skimage import measure


def marching_cubes(volume, threshold):
    verts, faces, _normals, _values = measure.marching_cubes(volume.detach().cpu().numpy(), level=float(threshold))
    return (
        torch.from_numpy(np.ascontiguousarray(verts[:, ::-1])).float(),
        torch.from_numpy(faces.astype(np.int64)),
    )
