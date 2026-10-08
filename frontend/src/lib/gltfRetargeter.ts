import * as THREE from "three";
import { LandmarkFilterBank } from "./retargeter";

export interface LandmarkOffsets {
  poseOffset: number;
  poseCount: number;
  faceOffset: number;
  faceCount: number;
  lHandOffset: number;
  lHandCount: number;
  rHandOffset: number;
  rHandCount: number;
}

export function getLandmarkOffsets(len: number): LandmarkOffsets {
  if (len === 66) {
    // 1. Diffusion backend: 8 body, 21 left hand, 21 right hand, 16 face
    return {
      poseOffset: 0,
      poseCount: 8,
      lHandOffset: 8,
      lHandCount: 21,
      rHandOffset: 29,
      rHandCount: 21,
      faceOffset: 50,
      faceCount: 16,
    };
  } else if (len >= 136 && len <= 250) {
    // 2. S2S Spoken-to-Signed backend (178 points):
    // 8 body, 128 face, 21 left hand, 21 right hand
    return {
      poseOffset: 0,
      poseCount: 8,
      faceOffset: 8,
      faceCount: Math.min(128, len - 50),
      lHandOffset: 136,
      lHandCount: 21,
      rHandOffset: 157,
      rHandCount: 21,
    };
  } else if (len >= 500) {
    // 3. Full MediaPipe Holistic (543 points):
    // 33 pose, 478 face, 21 left hand, 21 right hand
    return {
      poseOffset: 0,
      poseCount: 33,
      faceOffset: 33,
      faceCount: 478,
      lHandOffset: 511,
      lHandCount: 21,
      rHandOffset: 532,
      rHandCount: 21,
    };
  }
  // Safe default fallback
  return {
    poseOffset: 0,
    poseCount: 8,
    lHandOffset: 8,
    lHandCount: 21,
    rHandOffset: 29,
    rHandCount: 21,
    faceOffset: 50,
    faceCount: Math.max(0, len - 50),
  };
}

export class GltfHumanoidRetargeter {
  scene: THREE.Object3D;
  bones: Record<string, THREE.Bone> = {};
  bindWorldQ: Record<string, THREE.Quaternion> = {};
  uBindWorld: Record<string, THREE.Vector3> = {};
  restLocalQ: Record<string, THREE.Quaternion> = {};
  restLocalPos: Record<string, THREE.Vector3> = {};
  lastLocalQ: Record<string, THREE.Quaternion> = {};

  // World anchors
  leftShoulderPos = new THREE.Vector3();
  rightShoulderPos = new THREE.Vector3();
  shoulderCenter = new THREE.Vector3(0, 1.48, -0.02);
  shoulderWidth = 0.332;

  // Arm bone lengths
  upperArmLength = 0.285;
  forearmLength = 0.252;

  // Resting ready-stance targets in front of abdomen/pelvis (world space)
  leftWristRest = new THREE.Vector3(0.12, 1.18, 0.26);
  rightWristRest = new THREE.Vector3(-0.12, 1.18, 0.26);

  // Current smoothed wrist targets
  currentLeftWrist = new THREE.Vector3(0.12, 1.18, 0.26);
  currentRightWrist = new THREE.Vector3(-0.12, 1.18, 0.26);

  // Anatomical elbow pole vectors: flaring outward and forward (+Z) so elbows NEVER go behind back
  leftPole = new THREE.Vector3(0.70, -0.30, 0.25).normalize();
  rightPole = new THREE.Vector3(-0.70, -0.30, 0.25).normalize();

  // Landmark filtering
  filterBank: LandmarkFilterBank;

  // Meshes & morph targets
  headMesh: THREE.Mesh | null = null;
  teethMesh: THREE.Mesh | null = null;
  headwearMesh: THREE.Mesh | null = null;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
    this.filterBank = new LandmarkFilterBank(66);
    this.initBones();
  }

  private initBones() {
    this.scene.updateMatrixWorld(true);

    this.scene.traverse((obj) => {
      if ((obj as THREE.Bone).isBone) {
        const bone = obj as THREE.Bone;
        // Normalize name: support both standard Mixamo (mixamorig:LeftArm) and Ready Player Me (LeftArm)
        const cleanName = bone.name.replace(/^mixamorig:?/i, "");
        this.bones[cleanName] = bone;
        this.restLocalQ[cleanName] = bone.quaternion.clone();
        this.restLocalPos[cleanName] = bone.position.clone();
        this.lastLocalQ[cleanName] = bone.quaternion.clone();

        // Bind world rotation and longitudinal axis (+Y in Mixamo/ReadyPlayerMe)
        const worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
        this.bindWorldQ[cleanName] = worldQ;
        this.uBindWorld[cleanName] = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ).normalize();
      }

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (mesh.name === "Wolf3D_Head") this.headMesh = mesh;
        if (mesh.name === "Wolf3D_Teeth") this.teethMesh = mesh;
        if (mesh.name === "Wolf3D_Headwear") this.headwearMesh = mesh;
      }
    });

    // Cache shoulder socket world positions
    if (this.bones["LeftArm"]) {
      this.bones["LeftArm"].getWorldPosition(this.leftShoulderPos);
    }
    if (this.bones["RightArm"]) {
      this.bones["RightArm"].getWorldPosition(this.rightShoulderPos);
    }

    if (this.leftShoulderPos.lengthSq() > 0 && this.rightShoulderPos.lengthSq() > 0) {
      this.shoulderCenter.copy(this.leftShoulderPos).add(this.rightShoulderPos).multiplyScalar(0.5);
      this.shoulderWidth = Math.max(0.22, this.leftShoulderPos.distanceTo(this.rightShoulderPos));
      
      // Compute actual bone lengths from skeleton
      if (this.bones["LeftForeArm"] && this.bones["LeftHand"]) {
        const elbowP = new THREE.Vector3();
        const wristP = new THREE.Vector3();
        this.bones["LeftForeArm"].getWorldPosition(elbowP);
        this.bones["LeftHand"].getWorldPosition(wristP);
        this.upperArmLength = Math.max(0.20, this.leftShoulderPos.distanceTo(elbowP));
        this.forearmLength = Math.max(0.18, elbowP.distanceTo(wristP));
      }

      const totalArm = this.upperArmLength + this.forearmLength;

      // Natural SIDE-BY-SIDE resting position (down along the outer hips/thighs, NEVER on chest)
      this.leftWristRest.set(
        this.leftShoulderPos.x + 0.08,
        this.leftShoulderPos.y - totalArm * 0.90,
        this.leftShoulderPos.z + 0.04
      );
      this.rightWristRest.set(
        this.rightShoulderPos.x - 0.08,
        this.rightShoulderPos.y - totalArm * 0.90,
        this.rightShoulderPos.z + 0.04
      );
      this.currentLeftWrist.copy(this.leftWristRest);
      this.currentRightWrist.copy(this.rightWristRest);
    }

    // Set initial natural ready stance
    this.applyReadyStance(0);
  }

  /**
   * Main retargeting call for live motion landmark frames.
   */
  retarget(rawPts: number[][], dt: number, timeSec: number = 0) {
    if (!rawPts || rawPts.length < 8) return;
    const pts = this.filterBank.smooth(rawPts);

    // 1. Identify Landmark Offsets (supports 66-point diffusion, 178-point s2s, and 543-point holistic)
    const offsets = getLandmarkOffsets(pts.length);
    const lHandOffset = offsets.lHandOffset;
    const rHandOffset = offsets.rHandOffset;
    const faceOffset = offsets.faceOffset;
    const faceCount = offsets.faceCount;

    // 2. Dynamic Spine Balance & subtle respiration
    this.solveSpine(pts, offsets, dt, timeSec);

    const lHandPts = pts.length >= lHandOffset + offsets.lHandCount ? pts.slice(lHandOffset, lHandOffset + offsets.lHandCount) : [];
    const rHandPts = pts.length >= rHandOffset + offsets.rHandCount ? pts.slice(rHandOffset, rHandOffset + offsets.rHandCount) : [];
    const facePts = pts.length >= faceOffset + faceCount ? pts.slice(faceOffset, faceOffset + faceCount) : [];

    const hasLeftHand = lHandPts.length === 21 && this.isHandActive(lHandPts, true);
    const hasRightHand = rHandPts.length === 21 && this.isHandActive(rHandPts, false);

    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();

    // Solve Left Arm
    if (hasLeftHand && pts[lHandOffset]) {
      const targetW = this.landmarkToWorld(pts[lHandOffset], true, 0.20);
      this.currentLeftWrist.lerp(targetW, 1.0 - Math.exp(-dt * 20.0));
      this.solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, this.leftPole, dt);
      this.solveHandOrientation("Left", lHandPts, dt);
      this.solveFingers("Left", lHandPts, dt);
    } else {
      this.currentLeftWrist.lerp(this.leftWristRest, 1.0 - Math.exp(-dt * 5.0));
      this.solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, idleLeftPole, dt);
      this.relaxHand("Left", dt);
    }

    // Solve Right Arm
    if (hasRightHand && pts[rHandOffset]) {
      const targetW = this.landmarkToWorld(pts[rHandOffset], false, 0.20);
      this.currentRightWrist.lerp(targetW, 1.0 - Math.exp(-dt * 20.0));
      this.solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, this.rightPole, dt);
      this.solveHandOrientation("Right", rHandPts, dt);
      this.solveFingers("Right", rHandPts, dt);
    } else {
      this.currentRightWrist.lerp(this.rightWristRest, 1.0 - Math.exp(-dt * 5.0));
      this.solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, idleRightPole, dt);
      this.relaxHand("Right", dt);
    }

    // 3. Head Pose & Facial Markers (strictly clamped to physiological limits)
    if (facePts.length > 0) {
      this.solveFace(facePts.slice(0, 16), dt, timeSec);
    }
  }

  /**
   * Continuous natural idle animation when no sign stream is incoming.
   */
  updateIdle(timeSec: number, dt: number) {
    // 1. Natural Breathing: 3.4s cycle (~18 breaths/min)
    const breathRate = 1.85;
    const breath = Math.sin(timeSec * breathRate);
    const spine = this.bones["Spine"];
    if (spine && this.restLocalPos["Spine"]) {
      spine.position.y = this.restLocalPos["Spine"].y + breath * 0.003;
      const breathPitch = breath * 0.010;
      const idleSway = Math.sin(timeSec * 0.70) * 0.006;
      const targetSpineQ = this.restLocalQ["Spine"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(breathPitch, 0, idleSway, "YXZ"))
      );
      spine.quaternion.slerp(targetSpineQ, 1.0 - Math.exp(-dt * 6.0));
    }

    // 2. Smoothly return arms and hands to relaxed SIDE-BY-SIDE stance down by the hips
    const breathOffset = new THREE.Vector3(0, breath * 0.003, 0);
    const targetL = this.leftWristRest.clone().add(breathOffset);
    const targetR = this.rightWristRest.clone().add(breathOffset);

    this.currentLeftWrist.lerp(targetL, 1.0 - Math.exp(-dt * 5.0));
    this.currentRightWrist.lerp(targetR, 1.0 - Math.exp(-dt * 5.0));

    // Elbows angle naturally slightly outward and back along the sides
    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();

    this.solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.currentLeftWrist, this.upperArmLength, this.forearmLength, idleLeftPole, dt);
    this.solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.currentRightWrist, this.upperArmLength, this.forearmLength, idleRightPole, dt);

    this.relaxHand("Left", dt);
    this.relaxHand("Right", dt);

    // 3. Subtle Lifelike Head Micro-Motion (strictly upright, facing forward)
    const head = this.bones["Head"];
    if (head && this.restLocalQ["Head"]) {
      const headYaw = Math.sin(timeSec * 0.50) * 0.020;
      const headPitch = Math.cos(timeSec * 0.75) * 0.012 - breath * 0.006;
      const headRoll = Math.sin(timeSec * 0.35) * 0.008;
      const targetHeadQ = this.restLocalQ["Head"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(headPitch, headYaw, headRoll, "YXZ"))
      );
      head.quaternion.slerp(targetHeadQ, 1.0 - Math.exp(-dt * 5.0));
    }

    // 4. Subtle Natural Resting Facial Expression
    if (this.headMesh?.morphTargetDictionary && this.headMesh?.morphTargetInfluences) {
      const smileIdx = this.headMesh.morphTargetDictionary["mouthSmile"];
      if (smileIdx !== undefined) {
        this.headMesh.morphTargetInfluences[smileIdx] = 0.10;
      }
      const openIdx = this.headMesh.morphTargetDictionary["mouthOpen"];
      if (openIdx !== undefined) {
        this.headMesh.morphTargetInfluences[openIdx] = 0.0;
      }
    }
    if (this.teethMesh?.morphTargetDictionary && this.teethMesh?.morphTargetInfluences) {
      const openIdx = this.teethMesh.morphTargetDictionary["mouthOpen"];
      if (openIdx !== undefined) {
        this.teethMesh.morphTargetInfluences[openIdx] = 0.0;
      }
    }
  }

  private applyReadyStance(timeSec: number) {
    const idleLeftPole = new THREE.Vector3(0.5, 0.0, -0.6).normalize();
    const idleRightPole = new THREE.Vector3(-0.5, 0.0, -0.6).normalize();
    this.solveTwoBoneIK("LeftArm", "LeftForeArm", this.leftShoulderPos, this.leftWristRest, this.upperArmLength, this.forearmLength, idleLeftPole, 1.0);
    this.solveTwoBoneIK("RightArm", "RightForeArm", this.rightShoulderPos, this.rightWristRest, this.upperArmLength, this.forearmLength, idleRightPole, 1.0);
    this.relaxHand("Left", 1.0);
    this.relaxHand("Right", 1.0);
  }

  /**
   * Maps normalized landmark coordinates to Avatar 3D world space.
   * Aligns accurately with the BiomechanicalOverlay and provides full anatomical reach
   * from waist to forehead across the body.
   */
  private landmarkToWorld(
    p: number[] | null | undefined,
    isLeftHand: boolean,
    forwardZ: number = 0.20
  ): THREE.Vector3 {
    if (!p || isNaN(p[0]) || isNaN(p[1])) {
      return isLeftHand ? this.leftWristRest.clone() : this.rightWristRest.clone();
    }

    // Natural signing workspace boundaries (waist to head, bilateral reach)
    const clampedX = THREE.MathUtils.clamp(p[0], -0.85, 0.85);
    const clampedY = THREE.MathUtils.clamp(p[1], -0.85, 0.85);
    const landmarkZ = (p[2] || 0) * this.shoulderWidth;

    return new THREE.Vector3(
      this.shoulderCenter.x + clampedX * this.shoulderWidth,
      this.shoulderCenter.y + clampedY * this.shoulderWidth,
      this.shoulderCenter.z + forwardZ + landmarkZ
    );
  }

  private isHandActive(hPts: (number[] | null)[], isLeftHand: boolean = false): boolean {
    if (!hPts || hPts.length === 0) return false;
    const validPts = hPts.filter((pt): pt is number[] => pt !== null && pt !== undefined && !isNaN(pt[0]) && !isNaN(pt[1]));
    if (validPts.length < 5) return false;
    const avgMag = validPts.reduce((acc, p) => acc + Math.hypot(p[0], p[1], p[2] || 0), 0) / validPts.length;
    return avgMag > 0.05;
  }

  /**
   * Analytical Two-Bone Inverse Kinematics for humanoid arms.
   * Uses forward-biased pole vectors so elbows naturally flare outward and forward.
   */
  private solveTwoBoneIK(
    shoulderName: string,
    foreArmName: string,
    shoulderPos: THREE.Vector3,
    targetWrist: THREE.Vector3,
    L1: number,
    L2: number,
    pole: THREE.Vector3,
    dt: number
  ) {
    const dVec = new THREE.Vector3().subVectors(targetWrist, shoulderPos);
    let d = dVec.length();
    const maxReach = (L1 + L2) * 0.985;
    const minReach = Math.max(0.12, Math.abs(L1 - L2) * 1.05);
    d = Math.max(minReach, Math.min(maxReach, d));
    const dir = dVec.clone().normalize();

    // Law of Cosines
    const cosAlpha = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

    // Elbow bend plane defined by reach vector and pole
    const planeNormal = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const bendDir = new THREE.Vector3().crossVectors(planeNormal, dir).normalize();

    // Exact elbow position
    const elbowPos = shoulderPos.clone()
      .addScaledVector(dir, L1 * Math.cos(alpha))
      .addScaledVector(bendDir, L1 * Math.sin(alpha));

    // Orient upper arm and forearm
    this.solveBoneDirection(shoulderName, shoulderPos, elbowPos, dt);
    this.solveBoneDirection(foreArmName, elbowPos, targetWrist, dt);
  }

  private solveBoneDirection(
    boneName: string,
    pProx: THREE.Vector3,
    pDist: THREE.Vector3,
    dt: number
  ) {
    const bone = this.bones[boneName];
    if (!bone || !bone.parent) return;

    const vTarget = new THREE.Vector3().subVectors(pDist, pProx);
    if (vTarget.lengthSq() < 1e-6) return;
    vTarget.normalize();

    const uBind = this.uBindWorld[boneName];
    if (!uBind) return;

    const qRotWorld = new THREE.Quaternion().setFromUnitVectors(uBind, vTarget);
    const qTargetWorld = qRotWorld.multiply(this.bindWorldQ[boneName]);

    const parentWorldQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const qTargetLocal = parentWorldQ.invert().multiply(qTargetWorld);

    // Temporal smoothing
    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 22.0);
    bone.quaternion.slerp(qTargetLocal, alpha);
    this.lastLocalQ[boneName].copy(bone.quaternion);
    bone.updateMatrixWorld(true);
  }

  /**
   * Solves hand orientation in 3D world space.
   *
   * In ASL fingerspelling and fluent signing, the signing hand is held UPRIGHT
   * with fingers pointing UP (+Y in world space) and the palm facing FORWARD (+Z in world space)
   * toward the viewer, tilted slightly forward for optimal silhouette legibility.
   */
  private solveHandOrientation(prefix: "Left" | "Right", hPts: (number[] | null)[], dt: number) {
    const handBone = this.bones[`${prefix}Hand`];
    if (!handBone || !handBone.parent) return;

    // Upright hand orientation in world space:
    // Knuckles point UP/forward (pitch = 0.22 rad ≈ 12 deg forward)
    // Palm faces directly forward toward camera (+Z), angled slightly inward (yaw = ±0.14 rad)
    const inwardYaw = prefix === "Left" ? -0.14 : 0.14;
    const forwardPitch = 0.22;
    const uprightWorldQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(forwardPitch, inwardYaw, 0, "YXZ")
    );

    // Convert world target to parent (forearm) local space:
    const parentWorldQ = handBone.parent.getWorldQuaternion(new THREE.Quaternion());
    const targetLocalQ = parentWorldQ.invert().multiply(uprightWorldQ);

    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 16.0);
    handBone.quaternion.slerp(targetLocalQ, alpha);
  }

  /**
   * Crisp, unambiguous finger articulation.
   *
   * Uses a sharp sigmoid classification threshold (centered at ratio 0.46)
   * so fingers either stand tall and straight (curl = 0) or close tightly
   * into the palm (curl = max). This eliminates ambiguous half-bent claws
   * and makes ASL handshapes ('W', 'B', 'A', 'L', 'O', etc.) 100% readable.
   */
  private solveFingers(prefix: "Left" | "Right", hPts: (number[] | null)[], dt: number) {
    if (hPts.length < 21) return;

    const digitNames = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
    const digitIndices = [
      [1, 2, 3, 4],       // Thumb: CMC, MCP, IP, TIP
      [5, 6, 7, 8],       // Index: MCP, PIP, DIP, TIP
      [9, 10, 11, 12],    // Middle
      [13, 14, 15, 16],   // Ring
      [17, 18, 19, 20],   // Pinky
    ];

    // Anatomical curl angles (radians) at full closure: [phalanx1, phalanx2, phalanx3]
    const maxPhalanxFlex: number[][] = [
      [0.30, 0.60, 0.85],  // Thumb (CMC opposition, MCP, IP)
      [1.10, 1.40, 0.70],  // Index (MCP ~63°, PIP ~80°, DIP ~40°)
      [1.12, 1.42, 0.72],  // Middle
      [1.10, 1.40, 0.70],  // Ring
      [1.00, 1.30, 0.65],  // Pinky
    ];

    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 20.0);

    for (let d = 0; d < 5; d++) {
      const dName = digitNames[d];
      const indices = digitIndices[d];

      const p0 = hPts[indices[0]]; // base
      const p1 = hPts[indices[1]]; // joint 1
      const p2 = hPts[indices[2]]; // joint 2
      const p3 = hPts[indices[3]]; // tip
      if (!p0 || !p1 || !p2 || !p3) continue;

      const seg1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], (p1[2] || 0) - (p0[2] || 0));
      const seg2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], (p2[2] || 0) - (p1[2] || 0));
      const seg3 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1], (p3[2] || 0) - (p2[2] || 0));
      const maxReach = seg1 + seg2 + seg3;
      const directDist = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], (p3[2] || 0) - (p0[2] || 0));

      if (maxReach < 1e-4) continue;

      const curlRatio = THREE.MathUtils.clamp(directDist / maxReach, 0.0, 1.0);

      // Sharp, decisive classification: ratio >= 0.57 is OPEN (straight up), ratio <= 0.35 is CLOSED
      const norm = THREE.MathUtils.clamp((0.57 - curlRatio) / 0.22, 0.0, 1.0);
      const smoothedCurl = norm * norm * (3.0 - 2.0 * norm);

      for (let ph = 0; ph < 3; ph++) {
        const boneName = `${prefix}Hand${dName}${ph + 1}`;
        const bone = this.bones[boneName];
        if (!bone || !this.restLocalQ[boneName]) continue;

        const flex = maxPhalanxFlex[d][ph] * smoothedCurl;

        const targetQ = this.restLocalQ[boneName].clone().multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(flex, 0, 0, "YXZ"))
        );

        bone.quaternion.slerp(targetQ, alpha);
        this.lastLocalQ[boneName].copy(bone.quaternion);
      }
    }
  }

  /**
   * Smoothly relaxes hand and fingers into a natural curved resting posture.
   */
  private relaxHand(prefix: "Left" | "Right", dt: number) {
    const alpha = dt >= 1.0 ? 1.0 : 1.0 - Math.exp(-dt * 6.0);

    // 1. Relax wrist to natural resting orientation
    const handBone = this.bones[`${prefix}Hand`];
    if (handBone && this.restLocalQ[`${prefix}Hand`]) {
      const roll = prefix === "Left" ? 0.15 : -0.15;
      const yaw = prefix === "Left" ? -0.20 : 0.20;
      const pitch = 0.05;
      const targetQ = this.restLocalQ[`${prefix}Hand`].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"))
      );
      handBone.quaternion.slerp(targetQ, alpha);
    }

    // 2. Relax fingers into natural gentle curve
    const digitNames = ["Thumb", "Index", "Middle", "Ring", "Pinky"];
    const flexions = [
      [0.15, 0.20, 0.15], // Thumb
      [0.22, 0.28, 0.18], // Index
      [0.25, 0.32, 0.20], // Middle
      [0.22, 0.28, 0.18], // Ring
      [0.18, 0.22, 0.15], // Pinky
    ];

    for (let d = 0; d < 5; d++) {
      const dName = digitNames[d];
      for (let ph = 1; ph <= 3; ph++) {
        const boneName = `${prefix}Hand${dName}${ph}`;
        const bone = this.bones[boneName];
        if (!bone || !this.restLocalQ[boneName]) continue;

        const flex = flexions[d][ph - 1];
        const targetQ = this.restLocalQ[boneName].clone().multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(flex, 0, 0, "YXZ"))
        );
        bone.quaternion.slerp(targetQ, alpha);
      }
    }
  }

  private solveSpine(pts: (number[] | null)[], offsets: LandmarkOffsets, dt: number, timeSec: number) {
    const spine = this.bones["Spine"];
    if (!spine || !this.restLocalQ["Spine"] || pts.length < 2) return;

    const breath = Math.sin(timeSec * 1.85) * 0.003;
    if (this.restLocalPos["Spine"]) {
      spine.position.y = this.restLocalPos["Spine"].y + breath;
    }

    // Hand center of mass dynamic spine weight-shift
    let handMidX = 0;
    const lw = pts[offsets.lHandOffset];
    const rw = pts[offsets.rHandOffset];
    if (lw && rw) {
      handMidX = (lw[0] + rw[0]) * 0.5;
    } else if (rw) {
      handMidX = rw[0] * 0.5;
    } else if (lw) {
      handMidX = lw[0] * 0.5;
    }

    const rollZ = THREE.MathUtils.clamp(-handMidX * 0.15, -0.08, 0.08);
    const targetQ = this.restLocalQ["Spine"].clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(breath * 0.008, 0, rollZ, "YXZ"))
    );
    spine.quaternion.slerp(targetQ, 1.0 - Math.exp(-dt * 8.0));
  }

  /**
   * Solves head pose strictly clamped to physiological human neck limits.
   * Prevents any backward roll or inverted pitch.
   */
  private solveFace(fPts: (number[] | null)[], dt: number, timeSec: number) {
    if (!fPts || fPts.length < 16) return;

    const head = this.bones["Head"];
    if (head && this.restLocalQ["Head"]) {
      // Subsampled face points:
      // fPts[8] is lateral right cheek, fPts[4] is lateral left cheek, fPts[0] is chin
      const pLeft = fPts[4];
      const pRight = fPts[8];
      const pChin = fPts[0];

      let yaw = 0;
      let pitch = 0;
      let roll = 0;

      if (pLeft && pRight) {
        const midFaceX = (pLeft[0] + pRight[0]) * 0.5;
        // Subtle yaw derived from lateral face shift, strictly clamped
        yaw = THREE.MathUtils.clamp(midFaceX * 1.2, -0.15, 0.15);
      }

      if (pChin) {
        // Subtle pitch derived from chin height, strictly clamped
        pitch = THREE.MathUtils.clamp((pChin[1] - 0.48) * 0.8, -0.10, 0.10);
      }

      // Roll is kept strictly subtle (max +-2.5 deg)
      roll = THREE.MathUtils.clamp(Math.sin(timeSec * 0.35) * 0.008, -0.05, 0.05);

      const targetHeadQ = this.restLocalQ["Head"].clone().multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"))
      );
      head.quaternion.slerp(targetHeadQ, 1.0 - Math.exp(-dt * 10.0));
    }

    // Mouth Opening Morph Target on Wolf3D_Head & Wolf3D_Teeth
    // fPts[10] and fPts[12] are upper/lower mouth region
    const upperLip = fPts[12];
    const lowerLip = fPts[10];
    if (upperLip && lowerLip) {
      const dist = Math.hypot(upperLip[0] - lowerLip[0], upperLip[1] - lowerLip[1]);
      const open = THREE.MathUtils.clamp((dist - 0.02) * 5.0, 0, 0.7);

      if (this.headMesh?.morphTargetDictionary && this.headMesh?.morphTargetInfluences) {
        const idxOpen = this.headMesh.morphTargetDictionary["mouthOpen"];
        if (idxOpen !== undefined) this.headMesh.morphTargetInfluences[idxOpen] = open;
      }
      if (this.teethMesh?.morphTargetDictionary && this.teethMesh?.morphTargetInfluences) {
        const idxOpen = this.teethMesh.morphTargetDictionary["mouthOpen"];
        if (idxOpen !== undefined) this.teethMesh.morphTargetInfluences[idxOpen] = open;
      }
    }
  }
}
