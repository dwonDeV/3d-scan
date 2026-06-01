"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// Mock Gaussian Splatting viewer using Three.js point cloud
// Replace with actual .splat loader (e.g. antimatter15/splat) when NeRFStudio is connected

function generateMockRoom(): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];

  const addPlane = (
    cx: number, cy: number, cz: number,
    w: number, h: number,
    axis: "xy" | "xz" | "yz",
    r: number, g: number, b: number,
    count: number
  ) => {
    for (let i = 0; i < count; i++) {
      const u = (Math.random() - 0.5) * w;
      const v = (Math.random() - 0.5) * h;
      const noise = (Math.random() - 0.5) * 0.04;
      if (axis === "xz") { positions.push(cx + u, cy + noise, cz + v); }
      else if (axis === "xy") { positions.push(cx + u, cy + v, cz + noise); }
      else { positions.push(cx + noise, cy + u, cz + v); }
      const jitter = () => Math.random() * 0.08 - 0.04;
      colors.push(r + jitter(), g + jitter(), b + jitter());
    }
  };

  // Floor
  addPlane(0, -1.2, 0, 6, 5, "xz", 0.55, 0.42, 0.32, 4000);
  // Ceiling
  addPlane(0, 1.5, 0, 6, 5, "xz", 0.90, 0.90, 0.88, 1500);
  // Back wall
  addPlane(0, 0.15, -2.5, 6, 2.8, "xy", 0.88, 0.86, 0.84, 3000);
  // Left wall
  addPlane(-3, 0.15, 0, 5, 2.8, "yz", 0.84, 0.82, 0.80, 2500);
  // Right wall
  addPlane(3, 0.15, 0, 5, 2.8, "yz", 0.86, 0.84, 0.82, 2500);

  // Sofa
  const addBox = (
    x: number, y: number, z: number,
    sw: number, sh: number, sd: number,
    r: number, g: number, b: number,
    count: number
  ) => {
    for (let i = 0; i < count; i++) {
      positions.push(
        x + (Math.random() - 0.5) * sw,
        y + (Math.random() - 0.5) * sh,
        z + (Math.random() - 0.5) * sd
      );
      colors.push(r + (Math.random()-0.5)*0.05, g + (Math.random()-0.5)*0.05, b + (Math.random()-0.5)*0.05);
    }
  };

  addBox(-0.5, -0.75, -1.8, 2.5, 0.5, 0.7, 0.30, 0.22, 0.60, 1500); // sofa body
  addBox(-0.5, -0.50, -2.1, 2.5, 1.0, 0.15, 0.28, 0.20, 0.55, 800); // sofa back
  // Coffee table
  addBox(-0.5, -1.05, -0.5, 1.2, 0.05, 0.6, 0.45, 0.30, 0.18, 600);
  addBox(-0.5, -1.15, -0.5, 1.0, 0.2, 0.5, 0.42, 0.28, 0.16, 300);
  // Plant
  addBox(2.3, -0.8, -2.0, 0.25, 0.4, 0.25, 0.20, 0.50, 0.22, 500);
  addBox(2.3, -0.45, -2.0, 0.45, 0.55, 0.45, 0.15, 0.55, 0.20, 800);
  // Window frame
  addBox(0, 0.3, -2.49, 1.5, 1.2, 0.05, 0.75, 0.85, 0.92, 600);
  addBox(0, 0.3, -2.49, 0.05, 1.2, 0.05, 0.70, 0.70, 0.68, 100);
  addBox(0, 0.3, -2.49, 1.5, 0.05, 0.05, 0.70, 0.70, 0.68, 100);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.018,
    vertexColors: true,
    sizeAttenuation: true,
  });

  return new THREE.Points(geo, mat);
}

export default function GaussianViewer({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x08080f, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.01, 100);
    camera.position.set(0, 0.2, 2.8);

    const points = generateMockRoom();
    scene.add(points);

    // Ambient light hint
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);

    setTimeout(() => setLoaded(true), 400);

    // Touch/mouse orbit
    let isDragging = false;
    let prevX = 0, prevY = 0;
    let theta = 0, phi = 0.1;
    let radius = 2.8;

    const updateCamera = () => {
      camera.position.set(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(phi),
        radius * Math.cos(theta) * Math.cos(phi)
      );
      camera.lookAt(0, -0.1, -0.5);
    };
    updateCamera();

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      theta -= dx * 0.007;
      phi = Math.max(-0.4, Math.min(0.6, phi + dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCamera();
    };
    const onPointerUp = () => { isDragging = false; };
    const onWheel = (e: WheelEvent) => {
      radius = Math.max(1.2, Math.min(6, radius + e.deltaY * 0.005));
      updateCamera();
    };

    // Touch pinch zoom
    let lastPinchDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        radius = Math.max(1.2, Math.min(6, radius - (dist - lastPinchDist) * 0.01));
        lastPinchDist = dist;
        updateCamera();
      }
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointerleave", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });

    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (!isDragging) {
        theta += 0.002;
        updateCamera();
      }
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointerleave", onPointerUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative touch-none ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#08080f]">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          <p className="text-xs text-white/40">3D 모델 렌더링 중…</p>
        </div>
      )}
    </div>
  );
}
