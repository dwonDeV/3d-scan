"use client";

import { useEffect, useState, use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const GaussianViewer = dynamic(() => import("@/components/GaussianViewer"), { ssr: false });

type Scan = {
  id: string;
  name: string;
  date: string;
  photoCount: number;
  status: string;
  photos?: string[];
};

export default function ViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [scan, setScan] = useState<Scan | null>(null);
  const [activeTab, setActiveTab] = useState<"3d" | "photos">("3d");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const load = () => {
      const data = localStorage.getItem(`scan-${id}`);
      if (data) {
        const parsed = JSON.parse(data);
        setScan(parsed);
        if (parsed.status === "processing") setProcessing(true);
        else setProcessing(false);
      }
    };
    load();
    const interval = setInterval(load, 1000);
    return () => clearInterval(interval);
  }, [id]);

  if (!scan) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-white/40 text-sm">스캔 정보를 찾을 수 없습니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 pt-12 pb-3 flex-shrink-0">
        <Link
          href="/"
          className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/70"
        >
          ←
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-white truncate">{scan.name}</h1>
          <p className="text-xs text-white/40">{scan.photoCount}장 · {scan.date}</p>
        </div>
        {processing && (
          <span className="text-xs text-yellow-400 font-medium flex items-center gap-1">
            <span className="animate-spin inline-block">⚙</span> 처리 중
          </span>
        )}
        {!processing && (
          <span className="text-xs text-emerald-400 font-medium">완료</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex px-5 gap-1 mb-1 flex-shrink-0">
        {(["3d", "photos"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-indigo-600 text-white"
                : "bg-white/6 text-white/50 hover:bg-white/10"
            }`}
          >
            {tab === "3d" ? "🧊 3D 뷰어" : `📷 사진 (${scan.photoCount})`}
          </button>
        ))}
      </div>

      {/* 3D Viewer */}
      {activeTab === "3d" && (
        <div className="flex-1 flex flex-col min-h-0">
          {processing ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
              <div className="w-20 h-20 rounded-full bg-indigo-950/60 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-white font-semibold mb-1">3D 모델 생성 중</p>
                <p className="text-white/40 text-sm">NeRFStudio가 사진을 분석하고 있습니다.<br />잠시만 기다려주세요.</p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                <div className="bg-indigo-500 h-full rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <GaussianViewer className="flex-1" />
              <div className="px-5 py-3 flex-shrink-0">
                <div className="rounded-xl bg-white/5 p-3 flex items-center gap-2">
                  <span className="text-base">💡</span>
                  <p className="text-xs text-white/50">드래그로 회전, 핀치로 확대/축소할 수 있습니다</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Photos Tab */}
      {activeTab === "photos" && (
        <div className="flex-1 overflow-y-auto px-5 pb-8 min-h-0">
          {scan.photos && scan.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2 pt-2">
              {scan.photos.map((photo, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={photo}
                  alt={`사진 ${i + 1}`}
                  className="aspect-square rounded-xl object-cover w-full"
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40">
              <p className="text-white/30 text-sm">사진이 없습니다</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
