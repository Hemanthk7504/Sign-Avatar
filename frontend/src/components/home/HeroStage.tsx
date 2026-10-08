"use client";

import React, { useState, useEffect, useRef } from "react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { MotionWebSocketClient } from "@/lib/websocket";

export function HeroStage() {
  const [currentFrame, setCurrentFrame] = useState<number[][] | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [fps, setFps] = useState(25);

  const frameQueueRef = useRef<number[][][]>([]);
  const playStartRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    const wsClient = new MotionWebSocketClient({
      onSessionReady: () => {
        // Send initial welcome greeting prompt to stream continuous greeting motion
        wsClient.sendText("welcome");
      },
      onSequenceStart: () => {
        frameQueueRef.current = [];
        playStartRef.current = performance.now();
      },
      onFrames: (frames) => {
        frameQueueRef.current.push(...frames);
      },
      onSequenceEnd: () => {
        // Reset playhead to loop welcome greeting smoothly
        playStartRef.current = performance.now();
      },
    });

    wsClient.connect();

    // 25 FPS animation loop
    const tick = (now: number) => {
      if (!isPaused && frameQueueRef.current.length > 0) {
        const queue = frameQueueRef.current;
        const targetFps = 25;
        const elapsedSec = (now - playStartRef.current) / 1000;
        let frameIdx = Math.floor(elapsedSec * targetFps);

        if (frameIdx >= queue.length) {
          // Loop animation smoothly
          playStartRef.current = now;
          frameIdx = 0;
        }

        if (queue[frameIdx]) {
          setCurrentFrame(queue[frameIdx]);
        }
      }
      animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      wsClient.disconnect();
    };
  }, [isPaused]);

  return (
    <div className="flex flex-col bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm overflow-hidden">
      <div className="relative aspect-[4/3] sm:aspect-[16/11] w-full bg-[#F8FAFC]">
        <AvatarStage
          currentFrame={currentFrame}
          showDebug={showDebug}
          isPaused={isPaused}
          modelUrl="/models/michelle.glb"
          onFpsUpdate={setFps}
          className="w-full h-full"
        />
      </div>

      {/* Hero stage control bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#FFFFFF] border-t border-[#E2E8F0] text-xs text-[#475569]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#15803D]"></span>
          <span className="font-medium text-[#0F172A]">65-Bone Humanoid Rig</span>
          <span className="text-[#E2E8F0]">&middot;</span>
          <span>{fps} fps</span>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-[#475569] hover:text-[#0F172A]">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded border-[#E2E8F0] text-[#1D4ED8] focus:ring-[#1D4ED8]"
            />
            <span>Biomechanical landmarks</span>
          </label>

          <button
            onClick={() => setIsPaused(!isPaused)}
            className="px-2.5 py-1 rounded border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[11px] font-medium text-[#0F172A] transition-colors"
          >
            {isPaused ? "Resume Motion" : "Pause Motion"}
          </button>
        </div>
      </div>
    </div>
  );
}
