"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "backend_url";

export default function SettingsPage() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  useEffect(() => {
    setUrl(localStorage.getItem(STORAGE_KEY) || "");
  }, []);

  const save = () => {
    const trimmed = url.trim().replace(/\/$/, "");
    localStorage.setItem(STORAGE_KEY, trimmed);
    setUrl(trimmed);
  };

  const test = async () => {
    setStatus("testing");
    try {
      const res = await fetch(`${url.trim().replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
      setStatus(res.ok ? "ok" : "fail");
    } catch {
      setStatus("fail");
    }
  };

  return (
    <div className="flex flex-col min-h-screen px-5 max-w-md mx-auto w-full" style={{ paddingTop: "max(env(safe-area-inset-top), 52px)" }}>
      <div className="flex items-center gap-3 mb-8">
        <Link href="/" className="w-9 h-9 rounded-full bg-white/8 flex items-center justify-center text-white/70">←</Link>
        <h1 className="text-lg font-semibold text-white">백엔드 설정</h1>
      </div>

      <section className="mb-8">
        <h2 className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-3">서버 URL</h2>
        <div className="rounded-2xl bg-white/5 p-4 flex flex-col gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setStatus("idle"); }}
            placeholder="https://xxxx.trycloudflare.com"
            className="w-full bg-white/8 rounded-xl px-4 py-3 text-white text-sm border border-white/10 focus:border-indigo-500 focus:outline-none font-mono"
          />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">
              저장
            </button>
            <button onClick={test} disabled={!url || status === "testing"}
              className="flex-1 py-2.5 rounded-xl bg-white/8 text-white/70 text-sm font-semibold disabled:opacity-40">
              {status === "testing" ? "확인 중…" : "연결 테스트"}
            </button>
          </div>
          {status === "ok" && <p className="text-emerald-400 text-xs text-center">✓ 연결 성공</p>}
          {status === "fail" && <p className="text-red-400 text-xs text-center">✗ 연결 실패 — URL을 확인해주세요</p>}
        </div>
      </section>

      <section>
        <h2 className="text-xs font-semibold tracking-widest text-white/40 uppercase mb-3">Cloudflare Tunnel 시작 방법</h2>
        <div className="rounded-2xl bg-white/5 p-4 flex flex-col gap-3">
          <Step n={1} title="백엔드 서버 실행">
            <code className="text-xs text-indigo-300 block mt-1">cd 3d-scan/backend && ./start.sh</code>
          </Step>
          <Step n={2} title="Cloudflare Tunnel 실행">
            <code className="text-xs text-indigo-300 block mt-1">cloudflared tunnel --url http://localhost:8000</code>
          </Step>
          <Step n={3} title="출력된 URL을 위에 붙여넣기">
            <span className="text-xs text-white/40">예: https://xxxx-xxxx.trycloudflare.com</span>
          </Step>
        </div>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-indigo-900/60 flex items-center justify-center text-indigo-400 text-xs font-bold flex-shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <p className="text-white text-sm font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}
