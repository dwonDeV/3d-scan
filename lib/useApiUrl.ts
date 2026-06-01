"use client";

export function getApiUrl(): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem("backend_url") ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  );
}
