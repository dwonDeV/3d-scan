"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Phase = "preview" | "recording" | "extracting" | "ready" | "error";

const FRAME_INTERVAL_SEC = 0.5;
const MIN_FRAMES = 20;
const FRAME_MAX_WIDTH = 960; // 해상도 제한으로 용량 절감

export default function CapturePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoBlobRef = useRef<Blob | null>(null);

  const [phase, setPhase] = useState<Phase>("preview");
  const [recordingTime, setRecordingTime] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [extractProgress, setExtractProgress] = useState(0);
  const [scanName, setScanName] = useState("거실");
  const [camError, setCamError] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (!mounted) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      })
      .catch(() => setCamError("카메라 접근 권한이 필요합니다.\n브라우저 설정에서 카메라를 허용해주세요."));

    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    chunksRef.current = [];

    // iOS Safari는 video/mp4만 지원, Android는 webm 지원
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
      "",
    ].find((t) => t === "" || MediaRecorder.isTypeSupported(t)) ?? "";

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(200);
      setPhase("recording");
      setRecordingTime(0);

      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (e) {
      setErrorMsg(`녹화를 시작할 수 없습니다: ${e}`);
      setPhase("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setPhase("extracting");
    setExtractProgress(0);

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/mp4" });
      videoBlobRef.current = blob;
      extractFrames(blob);
    };
    recorder.stop();
  }, []);

  const extractFrames = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const vid = document.createElement("video");
    vid.src = url;
    vid.muted = true;
    vid.playsInline = true;
    vid.crossOrigin = "anonymous";

    vid.onerror = () => {
      URL.revokeObjectURL(url);
      setErrorMsg("영상을 읽을 수 없습니다. 다시 촬영해주세요.");
      setPhase("error");
    };

    vid.onloadedmetadata = () => {
      if (!isFinite(vid.duration) || vid.duration === 0) {
        // iOS Safari에서 duration이 Infinity로 나오는 경우 대응
        vid.currentTime = 1e10;
        vid.ontimeupdate = () => {
          vid.ontimeupdate = null;
          vid.currentTime = 0;
          startSeeking(vid, url);
        };
        return;
      }
      startSeeking(vid, url);
    };

    vid.load();
  };

  const startSeeking = (vid: HTMLVideoElement, url: string) => {
    const duration = vid.duration;
    if (!isFinite(duration) || duration <= 0) {
      URL.revokeObjectURL(url);
      setErrorMsg("영상 길이를 인식할 수 없습니다. 다시 촬영해주세요.");
      setPhase("error");
      return;
    }

    const times: number[] = [];
    for (let t = 0; t < duration; t += FRAME_INTERVAL_SEC) {
      times.push(parseFloat(t.toFixed(2)));
    }

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const extracted: string[] = [];
    let idx = 0;

    const seekNext = () => {
      if (idx >= times.length) {
        URL.revokeObjectURL(url);
        setFrames(extracted);
        setExtractProgress(100);
        setPhase("ready");
        return;
      }
      setExtractProgress(Math.round((idx / times.length) * 100));
      vid.currentTime = times[idx++];
    };

    vid.onseeked = () => {
      // 해상도 제한
      const scale = Math.min(1, FRAME_MAX_WIDTH / vid.videoWidth);
      canvas.width = Math.round(vid.videoWidth * scale);
      canvas.height = Math.round(vid.videoHeight * scale);
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      extracted.push(canvas.toDataURL("image/jpeg", 0.65));
      seekNext();
    };

    seekNext();
  };

  const handleProcess = () => {
    if (frames.length < MIN_FRAMES) return;

    const id = crypto.randomUUID();
    const scan = {
      id,
      name: scanName,
      date: new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
      photoCount: frames.length,
      status: "processing",
    };

    try {
      const existing = JSON.parse(localStorage.getItem("scans") || "[]");
      localStorage.setItem("scans", JSON.stringify([scan, ...existing]));
      // 프레임은 별도 키에 저장 (용량 초과 시 catch)
      localStorage.setItem(`scan-${id}`, JSON.stringify({ ...scan, photos: frames }));
    } catch {
      // localStorage 용량 초과 시 사진 없이 저장
      const existing = JSON.parse(localStorage.getItem("scans") || "[]");
      localStorage.setItem("scans", JSON.stringify([scan, ...existing]));
      localStorage.setItem(`scan-${id}`, JSON.stringify(scan));
    }

    setTimeout(() => {
      try {
        const scans = JSON.parse(localStorage.getItem("scans") || "[]");
        localStorage.setItem("scans", JSON.stringify(
          scans.map((s: typeof scan) => s.id === id ? { ...s, status: "done" } : s)
        ));
        const detail = JSON.parse(localStorage.getItem(`scan-${id}`) || "{}");
        localStorage.setItem(`scan-${id}`, JSON.stringify({ ...detail, status: "done" }));
      } catch { /* ignore */ }
      router.push(`/viewer/${id}`);
    }, 3000);
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const ready = frames.length >= MIN_FRAMES;

  return (
    <div className="relative max-w-md mx-auto w-full bg-black overflow-hidden" style={{ height: "100dvh" }}>
      <canvas ref={canvasRef} className="hidden" />

      {/* 카메라 프리뷰 — 화면 전체 */}
      {camError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center gap-4">
          <span className="text-5xl">📷</span>
          <p className="text-white/60 text-sm whitespace-pre-line">{camError}</p>
        </div>
      ) : (
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay muted playsInline />
      )}

      {/* 상단 오버레이 */}
      <div className="absolute top-0 left-0 right-0 px-5 flex items-center gap-3 bg-gradient-to-b from-black/70 to-transparent"
        style={{ paddingTop: "max(env(safe-area-inset-top), 44px)", paddingBottom: "32px" }}>
        <Link href="/" className="w-9 h-9 rounded-full bg-black/40 flex items-center justify-center text-white flex-shrink-0">←</Link>
        <span className="text-white font-semibold text-base flex-1 truncate">{scanName}</span>
        {phase === "recording" && (
          <span className="flex items-center gap-1.5 bg-red-600 rounded-full px-3 py-1 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span className="text-white text-xs font-mono font-bold">{formatTime(recordingTime)}</span>
          </span>
        )}
      </div>

      {/* 촬영 가이드 */}
      {phase === "preview" && !camError && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center px-8 text-center pointer-events-none">
          <div className="rounded-2xl bg-black/50 backdrop-blur px-4 py-3">
            <p className="text-white/80 text-xs leading-relaxed">
              천천히 공간을 돌며 촬영하세요<br />
              10~30초 권장 · 조명이 밝을수록 정확합니다
            </p>
          </div>
        </div>
      )}

      {/* 프레임 추출 중 */}
      {phase === "extracting" && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-5 px-8">
          <div className="w-14 h-14 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <div className="text-center">
            <p className="text-white font-semibold mb-1">프레임 추출 중…</p>
            <p className="text-white/40 text-sm">영상에서 사진을 자동으로 추출합니다</p>
          </div>
          <div className="w-full max-w-xs">
            <div className="flex justify-between text-xs text-white/40 mb-1.5">
              <span>진행률</span><span>{extractProgress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-200" style={{ width: `${extractProgress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* 오류 */}
      {phase === "error" && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="text-5xl">⚠️</span>
          <p className="text-white font-semibold">문제가 발생했습니다</p>
          <p className="text-white/50 text-sm">{errorMsg}</p>
          <button
            onClick={() => { setPhase("preview"); setErrorMsg(""); }}
            className="mt-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 하단 컨트롤 — 카메라 위 오버레이 */}
      <div
        className="absolute bottom-0 left-0 right-0 px-5 bg-gradient-to-t from-black/80 to-transparent"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 24px)", paddingTop: "48px" }}
      >
        {/* 공간 이름 입력 (preview) */}
        {phase === "preview" && (
          <div className="mb-4">
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              className="w-full bg-black/50 backdrop-blur rounded-xl px-4 py-3 text-white text-sm border border-white/20 focus:border-indigo-500 focus:outline-none"
              placeholder="공간 이름 (예: 거실, 침실)"
            />
          </div>
        )}

        {/* 프레임 미리보기 (ready) */}
        {phase === "ready" && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/70 text-xs">추출된 프레임</span>
              <span className={`text-xs font-semibold ${ready ? "text-emerald-400" : "text-white/50"}`}>
                {frames.length}장 {ready ? "✓" : `(최소 ${MIN_FRAMES}장 필요)`}
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {frames.slice(0, 8).map((f, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={f} alt="" className="h-12 w-16 object-cover rounded-lg flex-shrink-0" />
              ))}
              {frames.length > 8 && (
                <div className="h-12 w-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-white/60 text-xs">+{frames.length - 8}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 버튼 */}
        <div className="flex items-center justify-center">
          {(phase === "preview" || phase === "recording") && (
            <button
              onClick={phase === "preview" ? startRecording : stopRecording}
              disabled={!!camError}
              className="flex items-center justify-center"
            >
              <div className={`w-18 h-18 rounded-full border-4 flex items-center justify-center transition-all ${
                phase === "recording" ? "border-red-500" : "border-white/70"
              }`} style={{ width: 72, height: 72 }}>
                <div className={`transition-all duration-200 ${
                  phase === "recording" ? "w-7 h-7 rounded-lg bg-red-500" : "w-12 h-12 rounded-full bg-white"
                }`} />
              </div>
            </button>
          )}

          {phase === "ready" && (
            <div className="w-full flex flex-col gap-2">
              <button
                onClick={handleProcess}
                disabled={!ready}
                className={`w-full rounded-2xl py-3.5 font-semibold text-base flex items-center justify-center gap-2 ${
                  ready ? "bg-indigo-600 text-white" : "bg-white/10 text-white/30"
                }`}
              >
                🧊 3D 구조도 생성
              </button>
              <button
                onClick={() => { setFrames([]); setPhase("preview"); }}
                className="w-full py-2 text-white/40 text-sm text-center"
              >
                다시 촬영하기
              </button>
            </div>
          )}

          {phase === "extracting" && (
            <div className="py-3 text-white/30 text-sm">처리 중…</div>
          )}
        </div>
      </div>
    </div>
  );
}
