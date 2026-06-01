import asyncio
import base64
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORK_DIR = Path(__file__).parent / "scans"
WORK_DIR.mkdir(exist_ok=True)

# 진행 중인 학습 상태 저장 (메모리)
jobs: dict[str, dict] = {}


class ScanRequest(BaseModel):
    frames: list[str]  # base64 JPEG 리스트
    name: str = "scan"


class ScanStatus(BaseModel):
    id: str
    status: str          # queued | processing | done | error
    progress: int        # 0-100
    message: str
    splat_url: Optional[str] = None


@app.post("/scan", response_model=ScanStatus)
async def create_scan(req: ScanRequest):
    scan_id = str(uuid.uuid4())
    scan_dir = WORK_DIR / scan_id
    images_dir = scan_dir / "images"
    images_dir.mkdir(parents=True)

    # base64 프레임 → JPEG 파일로 저장
    for i, frame_b64 in enumerate(req.frames):
        header, _, data = frame_b64.partition(",")
        img_bytes = base64.b64decode(data if data else frame_b64)
        (images_dir / f"frame_{i:04d}.jpg").write_bytes(img_bytes)

    jobs[scan_id] = {
        "status": "queued",
        "progress": 0,
        "message": f"{len(req.frames)}장 저장 완료. 처리 대기 중…",
        "splat_url": None,
    }

    # 백그라운드에서 처리 시작
    asyncio.create_task(run_pipeline(scan_id, scan_dir, images_dir))

    return ScanStatus(id=scan_id, **jobs[scan_id])


@app.get("/scan/{scan_id}", response_model=ScanStatus)
def get_scan_status(scan_id: str):
    if scan_id not in jobs:
        raise HTTPException(status_code=404, detail="Scan not found")
    return ScanStatus(id=scan_id, **jobs[scan_id])


@app.get("/scan/{scan_id}/model")
def get_model(scan_id: str):
    splat_path = WORK_DIR / scan_id / "output.splat"
    if not splat_path.exists():
        raise HTTPException(status_code=404, detail="Model not ready")
    return FileResponse(splat_path, media_type="application/octet-stream", filename="output.splat")


async def run_pipeline(scan_id: str, scan_dir: Path, images_dir: Path):
    def update(status: str, progress: int, message: str, splat_url=None):
        jobs[scan_id] = {
            "status": status,
            "progress": progress,
            "message": message,
            "splat_url": splat_url,
        }
        print(f"[{scan_id[:8]}] {progress}% - {message}")

    try:
        # 1. COLMAP으로 카메라 포즈 추정
        update("processing", 5, "카메라 포즈 추정 중… (COLMAP)")
        colmap_dir = scan_dir / "colmap"
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "ns-process-data", "images",
                "--data", str(images_dir),
                "--output-dir", str(colmap_dir),
                "--no-gpu",
            ],
            capture_output=True, text=True, timeout=600,
        )
        if result.returncode != 0:
            update("error", 0, f"COLMAP 실패: {result.stderr[-300:]}")
            return

        update("processing", 35, "Gaussian Splatting 학습 시작…")

        # 2. splatfacto 학습 (M2 MPS)
        train_output = scan_dir / "train_output"
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "ns-train", "splatfacto",
                "--data", str(colmap_dir),
                "--output-dir", str(train_output),
                "--max-num-iterations", "3000",
                "--pipeline.model.cull-alpha-thresh", "0.005",
                "--viewer.quit-on-train-completion", "True",
            ],
            capture_output=True, text=True, timeout=3600,
            env={**os.environ, "PYTORCH_ENABLE_MPS_FALLBACK": "1"},
        )
        if result.returncode != 0:
            update("error", 0, f"학습 실패: {result.stderr[-300:]}")
            return

        update("processing", 85, ".splat 파일 변환 중…")

        # 3. 학습된 체크포인트를 .splat으로 export
        ckpt_dirs = sorted((train_output / "splatfacto").glob("*/nerfstudio_models"))
        if not ckpt_dirs:
            update("error", 0, "체크포인트를 찾을 수 없습니다")
            return

        ckpt_dir = ckpt_dirs[-1]
        splat_out = scan_dir / "output.splat"
        export_result = await asyncio.to_thread(
            subprocess.run,
            [
                "ns-export", "gaussian-splat",
                "--load-config", str(ckpt_dir.parent.parent / "config.yml"),
                "--output-dir", str(scan_dir),
            ],
            capture_output=True, text=True, timeout=300,
            env={**os.environ, "PYTORCH_ENABLE_MPS_FALLBACK": "1"},
        )

        # splat 파일 찾아서 이동
        splat_files = list((scan_dir).glob("**/*.splat"))
        if splat_files:
            shutil.copy(splat_files[0], splat_out)

        if splat_out.exists():
            update("done", 100, "3D 모델 생성 완료!", splat_url=f"/scan/{scan_id}/model")
        else:
            # export 실패해도 ply로 대체
            ply_files = list(scan_dir.glob("**/*.ply"))
            if ply_files:
                shutil.copy(ply_files[0], scan_dir / "output.ply")
                update("done", 100, "3D 모델 생성 완료! (PLY 포맷)", splat_url=f"/scan/{scan_id}/model")
            else:
                update("error", 0, f"모델 export 실패: {export_result.stderr[-200:]}")

    except asyncio.TimeoutError:
        update("error", 0, "처리 시간이 너무 오래 걸렸습니다 (타임아웃)")
    except Exception as e:
        update("error", 0, f"오류 발생: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
