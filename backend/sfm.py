"""
pycolmap으로 SfM(Structure-from-Motion)을 실행해 transforms.json을 생성.
COLMAP CLI 대신 Python API를 사용해 Apple Silicon 크래시를 우회.
"""
import json
import shutil
from pathlib import Path

import numpy as np
import pycolmap


def run_sfm(images_dir: Path, output_dir: Path) -> Path:
    """
    images_dir 의 JPEG들을 받아 SfM 실행 후
    output_dir/transforms.json 을 생성하고 output_dir 를 반환.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    db_path = output_dir / "database.db"
    sparse_dir = output_dir / "sparse"
    sparse_dir.mkdir(exist_ok=True)

    # 이미지 복사
    images_out = output_dir / "images"
    if images_out.exists():
        shutil.rmtree(images_out)
    shutil.copytree(images_dir, images_out)

    # 1. Feature extraction
    db_path.unlink(missing_ok=True)
    pycolmap.extract_features(
        database_path=db_path,
        image_path=images_out,
        camera_mode=pycolmap.CameraMode.SINGLE,
        sift_options={"max_num_features": 4096},
        device=pycolmap.Device.cpu,
    )

    # 2. Feature matching (exhaustive - 프레임 수가 적으므로)
    pycolmap.match_exhaustive(database_path=db_path, device=pycolmap.Device.cpu)

    # 3. Incremental mapping (SfM)
    maps = pycolmap.incremental_mapping(
        database_path=db_path,
        image_path=images_out,
        output_path=sparse_dir,
    )

    if not maps:
        raise RuntimeError("SfM 실패: 매칭된 이미지가 없습니다. 영상이 너무 흔들렸거나 너무 짧습니다.")

    # 가장 큰 재구성 결과 선택
    best = max(maps.values(), key=lambda m: m.num_reg_images())
    best.write(sparse_dir / "0")

    # 4. transforms.json 생성 (NeRFStudio 형식)
    transforms = _reconstruction_to_transforms(best, images_out)
    transforms_path = output_dir / "transforms.json"
    with open(transforms_path, "w") as f:
        json.dump(transforms, f, indent=2)

    return output_dir


def _reconstruction_to_transforms(reconstruction: pycolmap.Reconstruction, images_dir: Path) -> dict:
    cameras = reconstruction.cameras
    images = reconstruction.images

    # 첫 번째 카메라 기준으로 intrinsics 설정
    cam = next(iter(cameras.values()))
    params = cam.params  # [fx, fy, cx, cy] for PINHOLE

    frames = []
    for img in images.values():
        # world-to-camera → camera-to-world 변환
        R = img.rotation_matrix()
        t = img.tvec
        # c2w = [R^T | -R^T t]
        c2w = np.eye(4)
        c2w[:3, :3] = R.T
        c2w[:3, 3] = -R.T @ t

        # NeRFStudio 좌표계 변환 (OpenCV → OpenGL)
        c2w[1:3] *= -1

        frames.append({
            "file_path": f"images/{img.name}",
            "transform_matrix": c2w.tolist(),
        })

    result: dict = {
        "frames": frames,
    }

    if cam.model == pycolmap.CameraModelId.PINHOLE and len(params) >= 4:
        fx, fy, cx, cy = params[:4]
        result.update({
            "fl_x": fx, "fl_y": fy,
            "cx": cx, "cy": cy,
            "w": cam.width, "h": cam.height,
        })
    elif cam.model == pycolmap.CameraModelId.SIMPLE_RADIAL and len(params) >= 3:
        f, cx, cy = params[:3]
        result.update({
            "fl_x": f, "fl_y": f,
            "cx": cx, "cy": cy,
            "w": cam.width, "h": cam.height,
            "k1": params[3] if len(params) > 3 else 0,
        })
    elif len(params) >= 1:
        f = params[0]
        result.update({
            "fl_x": f, "fl_y": f,
            "cx": cam.width / 2, "cy": cam.height / 2,
            "w": cam.width, "h": cam.height,
        })

    return result
