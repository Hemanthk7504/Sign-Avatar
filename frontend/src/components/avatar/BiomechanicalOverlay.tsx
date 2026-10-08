"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { getLandmarkOffsets } from "@/lib/gltfRetargeter";

interface BiomechanicalOverlayProps {
  landmarks: number[][] | null;
  visible: boolean;
  shoulderCenter?: [number, number, number];
  shoulderWidth?: number;
}

// 21-point Hand kinematic bone connections
const HAND_LIMBS: [number, number][] = [
  // Thumb: Wrist -> CMC -> MCP -> IP -> TIP
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index: Wrist -> MCP -> PIP -> DIP -> TIP
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle: Wrist -> MCP -> PIP -> DIP -> TIP
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring: Wrist -> MCP -> PIP -> DIP -> TIP
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky: Wrist -> MCP -> PIP -> DIP -> TIP
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm transverse arches
  [5, 9], [9, 13], [13, 17],
];

// 16-point Face non-manual marker connections
const FACE_LIMBS: [number, number][] = [
  [0, 1], [1, 2], [2, 3],                 // Right Brow
  [4, 5], [5, 6], [6, 7],                 // Left Brow
  [8, 9], [9, 10], [10, 11], [11, 8],     // Nose bridge / Eyes
  [12, 13], [13, 14], [14, 15], [15, 12], // Mouth contour
];

/**
 * Transforms normalized landmark coordinates to 3D world space matching the avatar rig.
 */
export function landmarkPointToWorld(
  p: number[] | null | undefined,
  center: THREE.Vector3,
  width: number,
  forwardZ: number = 0.20
): THREE.Vector3 | null {
  if (!p || isNaN(p[0]) || isNaN(p[1])) return null;
  return new THREE.Vector3(
    center.x + p[0] * width,
    center.y + p[1] * width,
    center.z + forwardZ + (p[2] || 0) * width
  );
}

export function BiomechanicalOverlay({
  landmarks,
  visible,
  shoulderCenter = [0, 1.28, -0.01],
  shoulderWidth = 0.22,
}: BiomechanicalOverlayProps) {
  const centerVec = useMemo(() => new THREE.Vector3(...shoulderCenter), [shoulderCenter]);

  // Shared Geometries & Materials
  const sphereGeoSmall = useMemo(() => new THREE.SphereGeometry(0.009, 8, 6), []);
  const sphereGeoMed = useMemo(() => new THREE.SphereGeometry(0.014, 8, 6), []);

  const matLeftHand = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x10b981 }), []); // Emerald
  const matRightHand = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x2563eb }), []); // Electric Blue
  const matFace = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xf59e0b }), []); // Amber
  const matBody = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x8b5cf6 }), []); // Purple

  const lineMatLeftHand = useMemo(() => new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.90, linewidth: 2 }), []);
  const lineMatRightHand = useMemo(() => new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.90, linewidth: 2 }), []);
  const lineMatFace = useMemo(() => new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.75 }), []);
  const lineMatBody = useMemo(() => new THREE.LineBasicMaterial({ color: 0xa855f7, transparent: true, opacity: 0.85, linewidth: 2 }), []);

  if (!visible || !landmarks || landmarks.length === 0) return null;

  // Determine offsets based on landmark format (supports 66-point diffusion, 178-point s2s, and 543-point holistic)
  const offsets = getLandmarkOffsets(landmarks.length);
  const lHandOffset = offsets.lHandOffset;
  const rHandOffset = offsets.rHandOffset;
  const faceOffset = offsets.faceOffset;
  const faceCount = offsets.faceCount;

  // 1. Transform all points into world space
  const worldPoints: (THREE.Vector3 | null)[] = landmarks.map((p) =>
    landmarkPointToWorld(p, centerVec, shoulderWidth, 0.20)
  );

  // 2. Anatomical Body Skeleton (Shoulders, Spine, and Elbow to Wrist)
  const leftShoulder = new THREE.Vector3(centerVec.x + 0.5 * shoulderWidth, centerVec.y, centerVec.z);
  const rightShoulder = new THREE.Vector3(centerVec.x - 0.5 * shoulderWidth, centerVec.y, centerVec.z);
  const spineMid = new THREE.Vector3(centerVec.x, centerVec.y - 0.22, centerVec.z);

  const leftWrist = worldPoints[lHandOffset];
  const rightWrist = worldPoints[rHandOffset];

  // Use captured elbow positions if present (body landmarks 2 & 3), or estimate along natural arc
  const leftElbow = worldPoints[2] || (leftWrist
    ? leftShoulder.clone().lerp(leftWrist, 0.5).add(new THREE.Vector3(0.04, -0.04, -0.03))
    : null);
  const rightElbow = worldPoints[3] || (rightWrist
    ? rightShoulder.clone().lerp(rightWrist, 0.5).add(new THREE.Vector3(-0.04, -0.04, -0.03))
    : null);

  // Body Bone Segments
  const bodySegments: [THREE.Vector3, THREE.Vector3][] = [
    [leftShoulder, rightShoulder],
    [centerVec, spineMid],
  ];
  if (leftElbow && leftWrist) {
    bodySegments.push([leftShoulder, leftElbow]);
    bodySegments.push([leftElbow, leftWrist]);
  }
  if (rightElbow && rightWrist) {
    bodySegments.push([rightShoulder, rightElbow]);
    bodySegments.push([rightElbow, rightWrist]);
  }

  // 3. Hand Bone Segments
  const leftHandSegments: [THREE.Vector3, THREE.Vector3][] = [];
  if (landmarks.length >= lHandOffset + 21) {
    HAND_LIMBS.forEach(([a, b]) => {
      const pa = worldPoints[lHandOffset + a];
      const pb = worldPoints[lHandOffset + b];
      if (pa && pb) leftHandSegments.push([pa, pb]);
    });
  }

  const rightHandSegments: [THREE.Vector3, THREE.Vector3][] = [];
  if (landmarks.length >= rHandOffset + 21) {
    HAND_LIMBS.forEach(([a, b]) => {
      const pa = worldPoints[rHandOffset + a];
      const pb = worldPoints[rHandOffset + b];
      if (pa && pb) rightHandSegments.push([pa, pb]);
    });
  }

  // 4. Face Bone Segments
  const faceSegments: [THREE.Vector3, THREE.Vector3][] = [];
  if (landmarks.length >= faceOffset + 16) {
    FACE_LIMBS.forEach(([a, b]) => {
      const pa = worldPoints[faceOffset + a];
      const pb = worldPoints[faceOffset + b];
      if (pa && pb) faceSegments.push([pa, pb]);
    });
  }

  return (
    <group name="BiomechanicalOverlay">
      {/* ── Upper Body Bones ── */}
      {bodySegments.map(([p1, p2], idx) => {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        return <primitive key={`body-seg-${idx}`} object={new THREE.Line(lineGeo, lineMatBody)} />;
      })}
      <mesh geometry={sphereGeoMed} material={matBody} position={[leftShoulder.x, leftShoulder.y, leftShoulder.z]} />
      <mesh geometry={sphereGeoMed} material={matBody} position={[rightShoulder.x, rightShoulder.y, rightShoulder.z]} />
      {leftElbow && <mesh geometry={sphereGeoMed} material={matBody} position={[leftElbow.x, leftElbow.y, leftElbow.z]} />}
      {rightElbow && <mesh geometry={sphereGeoMed} material={matBody} position={[rightElbow.x, rightElbow.y, rightElbow.z]} />}

      {/* ── Left Hand Limbs & Joints (Green) ── */}
      {leftHandSegments.map(([p1, p2], idx) => {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        return <primitive key={`lhand-seg-${idx}`} object={new THREE.Line(lineGeo, lineMatLeftHand)} />;
      })}
      {landmarks.length >= lHandOffset + 21 &&
        worldPoints.slice(lHandOffset, lHandOffset + 21).map((pt, idx) => {
          if (!pt) return null;
          return (
            <mesh
              key={`lhand-dot-${idx}`}
              geometry={idx === 0 ? sphereGeoMed : sphereGeoSmall}
              material={matLeftHand}
              position={[pt.x, pt.y, pt.z]}
            />
          );
        })}

      {/* ── Right Hand Limbs & Joints (Blue) ── */}
      {rightHandSegments.map(([p1, p2], idx) => {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        return <primitive key={`rhand-seg-${idx}`} object={new THREE.Line(lineGeo, lineMatRightHand)} />;
      })}
      {landmarks.length >= rHandOffset + 21 &&
        worldPoints.slice(rHandOffset, rHandOffset + 21).map((pt, idx) => {
          if (!pt) return null;
          return (
            <mesh
              key={`rhand-dot-${idx}`}
              geometry={idx === 0 ? sphereGeoMed : sphereGeoSmall}
              material={matRightHand}
              position={[pt.x, pt.y, pt.z]}
            />
          );
        })}

      {/* ── Face Non-Manual Markers (Amber) ── */}
      {faceSegments.map(([p1, p2], idx) => {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        return <primitive key={`face-seg-${idx}`} object={new THREE.Line(lineGeo, lineMatFace)} />;
      })}
      {worldPoints.slice(faceOffset, faceOffset + Math.min(faceCount, 32)).map((pt, idx) => {
        if (!pt) return null;
        return (
          <mesh
            key={`face-dot-${idx}`}
            geometry={sphereGeoSmall}
            material={matFace}
            position={[pt.x, pt.y, pt.z]}
          />
        );
      })}
    </group>
  );
}
