"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Phase = "preview" | "recording" | "extracting" | "ready";

const FRAME_INTERVAL_SEC = 0.4; // 0.4초마다 프레임 추출
const MIN_FRAMES = 20;

export default function CapturePage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [phase, setPhase] = useState<Phase>("preview");
  const [recordingTime, setRecordingTime] = useState(0);
  const [frames, setFrames] = useState<string[]>([]);
  const [scanName, setScanName] = useState("거실");
  const [camError, setCamError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 카메라 시작
  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
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
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "video/mp4";

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(200);
    setPhase("recording");
    setRecordingTime(0);

    timerRef.current = setInterval(() => {
      setRecordingTime((t) => t + 1);
    }, 1000);
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    setPhase("extracting");

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
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

    vid.onloadedmetadata = () => {
      const duration = vid.duration;
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
          setPhase("ready");
          return;
        }
        vid.currentTime = times[idx++];
      };

      vid.onseeked = () => {
        canvas.width = vid.videoWidth;
        canvas.height = vid.videoHeight;
        ctx.drawImage(vid, 0, 0);
        extracted.push(canvas.toDataURL("image/jpeg", 0.75));
        seekNext();
      };

      seekNext();
    };

    vid.load();
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
      photos: frames,
    };

    const existing = JSON.parse(localStorage.getItem("scans") || "[]");
    localStorage.setItem("scans", JSON.stringify([scan, ...existing]));
    localStorage.setItem(`scan-${id}`, JSON.stringify(scan));

    setTimeout(() => {
      const scans = JSON.parse(localStorage.getItem("scans") || "[]");
      localStorage.setItem("scans", JSON.stringify(
        scans.map((s: typeof scan) => s.id === id ? { ...s, status: "done" } : s)
      ));
      const detail = JSON.parse(localStorage.getItem(`scan-${id}`) || "{}");
      localStorage.setItem(`scan-${id}`, JSON.stringify({ ...detail, status: "done" }));
      router.push(`/viewer/${id}`);
    }, 3000);
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const ready = frames.length >= MIN_FRAMES;

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto w-full bg-black overflow-hidden">
      <canvas ref={canvasRef} className="hidden" />

      {/* 카메라 프리뷰 */}
      <div className="relative flex-1 bg-black">
        {camError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center gap-4">
            <span className="text-5xl">📷</span>
            <p className="text-white/60 text-sm whitespace-pre-line">{camError}</p>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            autoPlay
            muted
            playsInline
          />
        )}

        {/* 상단 오버레이 */}
        <div className="absolute top-0 left-0 right-0 pt-12 px-5 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent">
          <Link href="/" className="w-9 h-9 rounded-full bg-black/40 flex items-center justify-center text-white">
            ←
          </Link>
          <span className="text-white font-semibold text-base flex-1">{scanName}</span>
          {phase === "recording" && (
            <span className="flex items-center gap-1.5 bg-red-600 rounded-full px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white text-xs font-mono font-bold">{formatTime(recordingTime)}</span>
            </span>
          )}
        </div>

        {/* 촬영 가이드 (preview 상태에서만) */}
        {phase === "preview" && !camError && (
          <div className="absolute inset-x-0 bottom-40 flex flex-col items-center gap-2 px-8 text-center">
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
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <p className="text-white font-semibold">프레임 추출 중…</p>
            <p className="text-white/40 text-sm">영상에서 사진을 자동으로 추출합니다</p>
          </div>
        )}
      </div>

      {/* 하단 컨트롤 */}
      <div className="bg-black flex-shrink-0 pb-10 pt-6 px-5">
        {/* 공간 이름 (preview 상태) */}
        {phase === "preview" && (
          <div className="mb-5">
            <input
              type="text"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              className="w-full bg-white/10 rounded-xl px-4 py-3 text-white text-sm border border-white/15 focus:border-indigo-500 focus:outline-none"
              placeholder="공간 이름 (예: 거실, 침실)"
            />
          </div>
        )}

        {/* 프레임 결과 (ready 상태) */}
        {phase === "ready" && (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/60 text-xs">추출된 프레임</span>
              <span className={`text-xs font-semibold ${ready ? "text-emerald-400" : "text-white/50"}`}>
                {frames.length}장 {ready ? "✓" : `(최소 ${MIN_FRAMES}장 필요)`}
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {frames.slice(0, 8).map((f, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={f} alt="" className="h-14 w-20 object-cover rounded-lg flex-shrink-0" />
              ))}
              {frames.length > 8 && (
                <div className="h-14 w-14 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
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
              className="relative flex items-center justify-center"
            >
              {/* 외부 링 */}
              <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all ${
                phase === "recording" ? "border-red-500" : "border-white/60"
              }`}>
                {/* 내부 버튼 */}
                <div className={`transition-all duration-200 ${
                  phase === "recording"
                    ? "w-8 h-8 rounded-lg bg-red-500"
                    : "w-14 h-14 rounded-full bg-white"
                }`} />
              </div>
            </button>
          )}

          {phase === "ready" && (
            <button
              onClick={handleProcess}
              disabled={!ready}
              className={`w-full rounded-2xl py-4 font-semibold text-base flex items-center justify-center gap-2 transition-all ${
                ready
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/40"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              }`}
            >
              🧊 3D 구조도 생성
            </button>
          )}

          {phase === "extracting" && (
            <div className="w-full py-4 flex items-center justify-center gap-2 text-white/40">
              <span className="animate-spin">⚙️</span> 처리 중…
            </div>
          )}
        </div>

        {phase === "ready" && (
          <button
            onClick={() => { setFrames([]); setPhase("preview"); }}
            className="w-full mt-3 py-2 text-white/40 text-sm text-center"
          >
            다시 촬영하기
          </button>
        )}
      </div>
    </div>
  );
}
