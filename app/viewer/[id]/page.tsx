"use client";

import { useEffect, useState, use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const GaussianViewer = dynamic(() => import("@/components/GaussianViewer"), { ssr: false });

import { getApiUrl } from "@/lib/useApiUrl";

type Scan = { id: string; name: string; date: string; photoCount: number; status: string; photos?: string[] };
type BackendStatus = { status: string; progress: number; message: string; splat_url?: string };

export default function ViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isBackend = searchParams.get("backend") === "1";

  const [scan, setScan] = useState<Scan | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [activeTab, setActiveTab] = useState<"3d" | "photos">("3d");

  // localStorage에서 스캔 메타 로드
  useEffect(() => {
    const data = localStorage.getItem(`scan-${id}`);
    if (data) setScan(JSON.parse(data));
  }, [id]);

  // 백엔드 폴링
  useEffect(() => {
    if (!isBackend) return;

    const poll = async () => {
      try {
        const res = await fetch(`${getApiUrl()}/scan/${id}`);
        if (!res.ok) return;
        const data: BackendStatus = await res.json();
        setBackendStatus(data);

        // 완료/오류 시 localStorage 상태 업데이트
        if (data.status === "done" || data.status === "error") {
          const stored = localStorage.getItem(`scan-${id}`);
          if (stored) {
            const parsed = JSON.parse(stored);
            localStorage.setItem(`scan-${id}`, JSON.stringify({ ...parsed, status: data.status }));
            const scans = JSON.parse(localStorage.getItem("scans") || "[]");
            localStorage.setItem("scans", JSON.stringify(
              scans.map((s: Scan) => s.id === id ? { ...s, status: data.status } : s)
            ));
          }
        }
      } catch { /* 서버 응답 없음 */ }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [id, isBackend]);

  const isDone = isBackend ? backendStatus?.status === "done" : scan?.status === "done";
  const isError = backendStatus?.status === "error";
  const isProcessing = !isDone && !isError;

  const progressPct = backendStatus?.progress ?? (isDone ? 100 : 30);
  const progressMsg = backendStatus?.message ?? "처리 중…";

  if (!scan) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-white/40 text-sm">스캔 정보를 불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col max-w-md mx-auto w-full" style={{ height: "100dvh" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 flex-shrink-0" style={{ paddingTop: "max(env(safe-area-inset-top), 44px)" }}>
        <Link href="/" className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/70">←</Link>
        <div className="flex-1 min-w-0 py-3">
          <h1 className="text-base font-semibold text-white truncate">{scan.name}</h1>
          <p className="text-xs text-white/40">{scan.photoCount}장 · {scan.date}</p>
        </div>
        <span className={`text-xs font-medium flex-shrink-0 ${
          isError ? "text-red-400" : isDone ? "text-emerald-400" : "text-yellow-400"
        }`}>
          {isError ? "오류" : isDone ? "완료" : "처리 중"}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex px-5 gap-1 mb-1 flex-shrink-0">
        {(["3d", "photos"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab ? "bg-indigo-600 text-white" : "bg-white/6 text-white/50"
            }`}>
            {tab === "3d" ? "🧊 3D 뷰어" : `📷 사진 (${scan.photoCount})`}
          </button>
        ))}
      </div>

      {/* 3D Viewer */}
      {activeTab === "3d" && (
        <div className="flex-1 flex flex-col min-h-0">
          {isError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <span className="text-5xl">⚠️</span>
              <p className="text-white font-semibold">3D 변환 실패</p>
              <p className="text-white/40 text-sm">{backendStatus?.message}</p>
              <Link href="/capture" className="mt-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">
                다시 촬영하기
              </Link>
            </div>
          ) : isProcessing ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
              <div className="w-16 h-16 rounded-full bg-indigo-950/60 flex items-center justify-center">
                <div className="w-9 h-9 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-white font-semibold mb-1">3D 모델 생성 중</p>
                <p className="text-white/40 text-sm">{progressMsg}</p>
              </div>
              <div className="w-full max-w-xs">
                <div className="flex justify-between text-xs text-white/40 mb-1.5">
                  <span>진행률</span><span>{progressPct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                </div>
                <p className="text-xs text-white/20 mt-3">M2 Pro 기준 약 20~40분 소요됩니다</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <GaussianViewer className="flex-1" />
              <div className="px-5 py-3 flex-shrink-0">
                <div className="rounded-xl bg-white/5 p-3 flex items-center gap-2">
                  <span className="text-base">💡</span>
                  <p className="text-xs text-white/50">드래그로 회전, 핀치로 확대/축소</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Photos */}
      {activeTab === "photos" && (
        <div className="flex-1 overflow-y-auto px-5 pb-8 min-h-0">
          {scan.photos && scan.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {scan.photos.map((photo, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={photo} alt="" className="aspect-square rounded-xl object-cover w-full" />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-white/30 text-sm">사진 미리보기는 용량 절약을 위해 저장되지 않습니다</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
