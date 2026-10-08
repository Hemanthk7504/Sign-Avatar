"use client";

import React, { useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { GltfHumanoidRetargeter } from "@/lib/gltfRetargeter";

interface HumanAvatarProps {
  currentFrame?: number[][] | null;
  isPaused?: boolean;
  modelUrl?: string;
  onRigReady?: (info: { shoulderCenter: THREE.Vector3; shoulderWidth: number }) => void;
}

export function HumanAvatar({
  currentFrame,
  isPaused = false,
  modelUrl = "/models/avatar.glb",
  onRigReady,
}: HumanAvatarProps) {
  const { scene, animations } = useGLTF(modelUrl);

  // Clone scene with unique skeleton instance for each stage
  const avatarScene = useMemo(() => {
    const clone = SkeletonUtils.clone(scene);
    clone.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        if (o.name.toLowerCase().includes("cube")) {
          o.visible = false;
          return;
        }
        (o as THREE.Mesh).frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [scene]);

  // Baked Skeletal Animation Player (for MMS-Player and mocap GLBs)
  const { actions, mixer } = useAnimations(animations, avatarScene);

  // Retargeter instance bound to this avatar instance's bones (for live landmark streaming)
  const retargeter = useMemo(() => {
    return new GltfHumanoidRetargeter(avatarScene);
  }, [avatarScene]);

  useEffect(() => {
    if (retargeter) {
      onRigReady?.({
        shoulderCenter: retargeter.shoulderCenter,
        shoulderWidth: retargeter.shoulderWidth,
      });
    }
  }, [retargeter, onRigReady]);

  // Only enable baked playback for genuine MMS mocap animation clips
  const isMmsModel =
    modelUrl.toLowerCase().includes("mms") ||
    modelUrl.toLowerCase().includes("test_hi") ||
    modelUrl.toLowerCase().includes("animations/");

  const hasBakedAnimation = isMmsModel && animations && animations.length > 0;

  useEffect(() => {
    if (hasBakedAnimation && !isPaused) {
      const activeActions: THREE.AnimationAction[] = [];
      Object.entries(actions).forEach(([name, action]) => {
        if (action && !name.toLowerCase().includes("dance")) {
          action.reset().fadeIn(0.2).play();
          activeActions.push(action);
        }
      });
      return () => {
        activeActions.forEach((a) => a.fadeOut(0.2));
      };
    } else {
      // Stop all actions if switching to live or base model
      Object.values(actions).forEach((action) => {
        if (action) action.stop();
      });
    }
  }, [actions, hasBakedAnimation, isPaused]);

  const lastFrameTimeRef = useRef<number>(0);

  useFrame((state, delta) => {
    const dt = Math.max(delta, 0.006);
    const timeSec = state.clock.getElapsedTime();
    const now = timeSec * 1000;

    // 1. Live Landmark Motion Retargeting (from neural diffusion / procedural backend)
    if (!isPaused && currentFrame && Array.isArray(currentFrame) && currentFrame.length >= 8) {
      if (mixer) mixer.timeScale = 0;
      retargeter.retarget(currentFrame, dt, timeSec);
      lastFrameTimeRef.current = now;
    } else if (hasBakedAnimation) {
      // 2. High-Fidelity Human Mocap Playback (from MMS-Player / Blender mocap)
      mixer.timeScale = isPaused ? 0 : 1;
    } else {
      // 3. Lifelike Natural Interpreter Idle (breathing, micro-sway, relaxed ready stance)
      if (mixer) mixer.timeScale = 0;
      retargeter.updateIdle(timeSec, dt);
    }
  });

  return (
    <primitive
      object={avatarScene}
      position={[0, 0, 0]}
      rotation={[0, 0, 0]}
    />
  );
}

// Preload models for instantaneous mounting
useGLTF.preload("/models/avatar.glb");
useGLTF.preload("/models/michelle.glb");

