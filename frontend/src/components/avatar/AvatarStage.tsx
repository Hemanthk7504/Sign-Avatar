"use client";

import React, { useRef, useState, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { HumanAvatar } from "./HumanAvatar";
import { BiomechanicalOverlay } from "./BiomechanicalOverlay";

interface AvatarStageProps {
  currentFrame?: number[][] | null;
  showDebug?: boolean;
  isPaused?: boolean;
  modelUrl?: string;
  className?: string;
  onFpsUpdate?: (fps: number) => void;
}

// Internal component for camera lookAt, auto-framing, and FPS measurement
function SceneController({
  onFpsUpdate,
  rigInfo,
}: {
  onFpsUpdate?: (fps: number) => void;
  rigInfo?: { shoulderCenter: THREE.Vector3; shoulderWidth: number } | null;
}) {
  const { camera } = useThree();
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const currentTargetY = useRef<number | null>(null);

  useFrame((_, delta) => {
    // 1. FPS counter
    frameCount.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
      const fps = Math.round((frameCount.current * 1000) / (now - lastTime.current));
      onFpsUpdate?.(fps);
      frameCount.current = 0;
      lastTime.current = now;
    }

    // 2. Dynamic Camera Framing: centers the face & torso for both Michelle and Alex
    if (rigInfo?.shoulderCenter) {
      const targetCenterY = rigInfo.shoulderCenter.y;
      if (currentTargetY.current === null) {
        currentTargetY.current = targetCenterY;
      } else {
        currentTargetY.current = THREE.MathUtils.damp(
          currentTargetY.current,
          targetCenterY,
          6.0,
          delta
        );
      }

      // Height of camera and lookAt target relative to shoulder center
      const camY = currentTargetY.current + 0.12;
      const lookY = currentTargetY.current + 0.04;
      camera.position.y = camY;
      camera.position.z = 1.32;
      camera.lookAt(0, lookY, 0);
    }
  });

  return null;
}

export function AvatarStage({
  currentFrame = null,
  showDebug = false,
  isPaused = false,
  modelUrl = "/models/michelle.glb",
  className = "w-full h-full min-h-[440px]",
  onFpsUpdate,
}: AvatarStageProps) {
  const [mounted, setMounted] = useState(false);

  const [rigInfo, setRigInfo] = useState<{ shoulderCenter: THREE.Vector3; shoulderWidth: number } | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`flex items-center justify-center bg-[#F8FAFC] border border-[#E2E8F0] ${className}`}>
        <div className="text-sm font-medium text-[#475569]">Initializing 3D Studio Stage…</div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-[#F8FAFC] border border-[#E2E8F0] ${className}`}>
      <Canvas
        shadows
        camera={{
          fov: 38,
          position: [0, 1.38, 1.32],
        }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
        }}
        onCreated={({ scene, gl }) => {
          scene.background = new THREE.Color(0xf6f8fa);
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
      >
        <SceneController onFpsUpdate={onFpsUpdate} rigInfo={rigInfo} />

        {/* ── 3-POINT STUDIO LIGHTING ─────────────────────────────────── */}
        {/* 1. Fill light: ambient daylight hemisphere bounce */}
        <hemisphereLight
          args={[0xffffff, 0xd2dbe6, 0.72]}
        />

        {/* 2. Key light: warm directional with soft PCF shadows */}
        <directionalLight
          position={[1.6, 2.8, 2.5]}
          intensity={1.25}
          color={0xfffaf2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-near={0.5}
          shadow-camera-far={10}
          shadow-camera-left={-1.2}
          shadow-camera-right={1.2}
          shadow-camera-top={2.2}
          shadow-camera-bottom={0.0}
          shadow-bias={-0.0001}
          shadow-normalBias={0.03}
        />

        {/* 3. Rim / Kicker light: cool blue-white rim from behind */}
        <directionalLight
          position={[-1.6, 2.2, -2.4]}
          intensity={0.75}
          color={0xa8c6e8}
        />

        {/* Ground contact plane for soft grounding shadow */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[6, 6]} />
          <meshStandardMaterial color={0xebeef3} roughness={0.95} metalness={0.0} />
        </mesh>

        {/* 3D Human Avatar */}
        <HumanAvatar
          currentFrame={currentFrame}
          isPaused={isPaused}
          modelUrl={modelUrl}
          onRigReady={(info) => setRigInfo(info)}
        />

        {/* Diagnostic Biomechanical Landmarks Overlay */}
        <BiomechanicalOverlay
          landmarks={currentFrame}
          visible={showDebug}
          shoulderCenter={rigInfo ? [rigInfo.shoulderCenter.x, rigInfo.shoulderCenter.y, rigInfo.shoulderCenter.z] : undefined}
          shoulderWidth={rigInfo ? rigInfo.shoulderWidth : undefined}
        />
      </Canvas>
    </div>
  );
}
