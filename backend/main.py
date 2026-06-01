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
from pydantic import BaseModel
from sfm import run_sfm

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORK_DIR = Path(__file__).parent / "scans"
WORK_DIR.mkdir(exist_ok=True)

VENV_BIN = Path(__file__).parent / "venv" / "bin"

# PATH에 venv/bin과 homebrew bin 추가 (colmap, ns-* 명령어 인식)
PIPELINE_ENV = {
    **os.environ,
    "PATH": f"{VENV_BIN}:/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}",
    "PYTORCH_ENABLE_MPS_FALLBACK": "1",
}

jobs: dict[str, dict] = {}


class ScanRequest(BaseModel):
    frames: list[str]  # base64 JPEG 리스트
    name: str = "scan"


class ScanStatus(BaseModel):
    id: str
    status: str       # queued | processing | done | error
    progress: int
    message: str
    splat_url: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/scan", response_model=ScanStatus)
async def create_scan(req: ScanRequest):
    scan_id = str(uuid.uuid4())
    scan_dir = WORK_DIR / scan_id
    images_dir = scan_dir / "images"
    images_dir.mkdir(parents=True)

    for i, frame_b64 in enumerate(req.frames):
        _, _, data = frame_b64.partition(",")
        img_bytes = base64.b64decode(data if data else frame_b64)
        (images_dir / f"frame_{i:04d}.jpg").write_bytes(img_bytes)

    jobs[scan_id] = {"status": "queued", "progress": 0, "message": f"{len(req.frames)}장 저장 완료.", "splat_url": None}
    asyncio.create_task(run_pipeline(scan_id, scan_dir, images_dir))
    return ScanStatus(id=scan_id, **jobs[scan_id])


@app.get("/scan/{scan_id}", response_model=ScanStatus)
def get_scan_status(scan_id: str):
    if scan_id not in jobs:
        raise HTTPException(status_code=404, detail="Scan not found")
    return ScanStatus(id=scan_id, **jobs[scan_id])


@app.get("/scan/{scan_id}/model")
def get_model(scan_id: str):
    for ext in ["output.splat", "output.ply"]:
        p = WORK_DIR / scan_id / ext
        if p.exists():
            return FileResponse(p, media_type="application/octet-stream", filename=ext)
    raise HTTPException(status_code=404, detail="Model not ready")


def run_cmd(args: list[str], cwd=None, timeout=600) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        env=PIPELINE_ENV,
        cwd=cwd,
    )


async def run_pipeline(scan_id: str, scan_dir: Path, images_dir: Path):
    log_file = scan_dir / "pipeline.log"

    def update(status: str, progress: int, message: str, splat_url=None):
        jobs[scan_id] = {"status": status, "progress": progress, "message": message, "splat_url": splat_url}
        print(f"[{scan_id[:8]}] {progress}% {message}")

    def log(label: str, result: subprocess.CompletedProcess):
        with open(log_file, "a") as f:
            f.write(f"\n=== {label} (returncode={result.returncode}) ===\n")
            f.write(f"STDOUT:\n{result.stdout}\n")
            f.write(f"STDERR:\n{result.stderr}\n")

    try:
        # 1. SfM — pycolmap으로 카메라 포즈 추정 (COLMAP CLI 크래시 우회)
        update("processing", 5, "카메라 포즈 추정 중… (SfM, 수 분 소요)")
        colmap_dir = scan_dir / "colmap"
        try:
            await asyncio.to_thread(run_sfm, images_dir, colmap_dir)
        except Exception as e:
            update("error", 0, f"SfM 실패: {e}")
            return

        if not (colmap_dir / "transforms.json").exists():
            update("error", 0, "transforms.json 생성 실패. 사진이 너무 적거나 흔들렸을 수 있습니다.")
            return

        # 2. splatfacto 학습
        update("processing", 30, "Gaussian Splatting 학습 중… (20~40분 소요)")
        train_output = scan_dir / "train_output"
        result = await asyncio.to_thread(run_cmd, [
            "ns-train", "splatfacto",
            "--data", str(colmap_dir),
            "--output-dir", str(train_output),
            "--max-num-iterations", "3000",
            "--viewer.quit-on-train-completion", "True",
        ], timeout=7200)
        log("ns-train", result)

        if result.returncode != 0:
            combined = (result.stdout + result.stderr)[-500:]
            update("error", 0, f"학습 실패: {combined}")
            return

        # 3. .splat export
        update("processing", 85, ".splat 변환 중…")
        config_files = list(train_output.glob("**/config.yml"))
        if not config_files:
            update("error", 0, "학습 config를 찾을 수 없습니다.")
            return

        export_result = await asyncio.to_thread(run_cmd, [
            "ns-export", "gaussian-splat",
            "--load-config", str(config_files[-1]),
            "--output-dir", str(scan_dir),
        ], timeout=300)
        log("ns-export", export_result)

        # 결과 파일 탐색
        for pattern, dest_name in [("**/*.splat", "output.splat"), ("**/*.ply", "output.ply")]:
            found = [f for f in scan_dir.glob(pattern) if f.name != dest_name]
            if found:
                shutil.copy(found[0], scan_dir / dest_name)
                break

        if (scan_dir / "output.splat").exists() or (scan_dir / "output.ply").exists():
            update("done", 100, "3D 모델 생성 완료!", splat_url=f"/scan/{scan_id}/model")
        else:
            update("error", 0, f"export 실패. 로그: {log_file}")

    except asyncio.TimeoutError:
        update("error", 0, "처리 시간 초과 (타임아웃)")
    except Exception as e:
        update("error", 0, f"오류: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
