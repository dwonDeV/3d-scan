"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Scan = { id: string; name: string; date: string; photoCount: number; status: string };

export default function HomePage() {
  const [scans, setScans] = useState<Scan[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("scans");
    if (stored) setScans(JSON.parse(stored));
  }, []);

  const statusLabel = (status: string) => {
    if (status === "processing") return { text: "처리 중", color: "text-yellow-400" };
    if (status === "done") return { text: "완료", color: "text-emerald-400" };
    return { text: "촬영 중", color: "text-blue-400" };
  };

  return (
    <div className="flex flex-col min-h-screen px-5 pt-14 pb-8 max-w-md mx-auto w-full">
      <header className="mb-10">
        <p className="text-xs font-semibold tracking-widest text-indigo-400 uppercase mb-2">3D Home Scanner</p>
        <h1 className="text-3xl font-bold text-white leading-tight">내 공간을<br />3D로 담아보세요</h1>
        <p className="mt-3 text-sm text-white/50">사진 여러 장으로 방 전체를 3D 구조도로 변환합니다</p>
      </header>

      <Link
        href="/capture"
        className="w-full rounded-2xl bg-indigo-600 py-4 text-white font-semibold text-base flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/40"
      >
        <span className="text-xl">📷</span>
        새 스캔 시작
      </Link>

      {scans.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-4">최근 스캔</h2>
          <div className="flex flex-col gap-3">
            {scans.map((scan) => {
              const s = statusLabel(scan.status);
              return (
                <Link
                  key={scan.id}
                  href={`/viewer/${scan.id}`}
                  className="w-full rounded-2xl bg-white/5 p-4 text-left flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo-900/60 flex items-center justify-center text-2xl flex-shrink-0">
                    🏠
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white text-sm truncate">{scan.name}</p>
                    <p className="text-xs text-white/40 mt-0.5">{scan.photoCount}장 · {scan.date}</p>
                  </div>
                  <span className={`text-xs font-medium ${s.color} flex-shrink-0`}>{s.text}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {scans.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 mt-16">
          <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center text-5xl">🏗️</div>
          <p className="text-white/30 text-sm">아직 스캔한 공간이 없습니다<br />새 스캔을 시작해보세요</p>
        </div>
      )}
    </div>
  );
}
