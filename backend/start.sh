#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
export PYTORCH_ENABLE_MPS_FALLBACK=1
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
