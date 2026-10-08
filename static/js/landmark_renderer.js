/**
 * Renders real MediaPipe Holistic landmark motion (the "landmarks" format
 * produced by the s2s backend) as a 3D skeleton: body, both 21-point hands,
 * and face landmarks.
 *
 * The backend sends normalized coordinates (centered on the shoulder
 * midpoint, scaled by shoulder width, y-up), so they're used directly as
 * world coordinates with no further transformation.
 *
 * Geometry is allocated once from the `components` metadata in the
 * sequence_start message, then only position buffers are updated per frame —
 * so playback stays smooth even at 25fps with ~178 points and ~246 bones.
 */

class LandmarkRenderer {
  constructor(containerEl) {
    this.container = containerEl;
    this.built = false;
    this._initScene();
    this._animate();
  }

  _initScene() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    this.camera.position.set(0, 0, 4.0);
    this.camera.lookAt(0, -0.2, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0xf8fafc, 1.0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 2, 3);
    this.scene.add(dir);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    window.addEventListener("resize", () => this._onResize());
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Style per component: high-contrast colors suited for daylight light theme. */
  _styleFor(name) {
    if (name.includes("FACE")) {
      return { color: 0x6d28d9, pointSize: 0.016, lineOpacity: 0.7, drawPoints: true };
    }
    if (name.includes("HAND")) {
      return { color: 0x1d4ed8, pointSize: 0.028, lineOpacity: 0.95, drawPoints: true };
    }
    return { color: 0x0f172a, pointSize: 0.038, lineOpacity: 0.95, drawPoints: true };
  }

  /**
   * Allocate geometry for a new sequence.
   * @param {Array} components - [{name, points, limbs, offset, count}]
   * @param {number} numPoints - total flattened point count
   */
  build(components, numPoints) {
    // Clear any previous skeleton
    while (this.root.children.length) {
      const c = this.root.children.pop();
      c.geometry?.dispose();
      c.material?.dispose();
      this.root.remove(c);
    }

    this.components = components;
    this.numPoints = numPoints;
    this.groups = [];

    for (const comp of components) {
      const style = this._styleFor(comp.name);

      // --- points ---
      const ptGeo = new THREE.BufferGeometry();
      const ptPos = new Float32Array(comp.count * 3);
      ptGeo.setAttribute("position", new THREE.BufferAttribute(ptPos, 3));
      const ptMat = new THREE.PointsMaterial({
        color: style.color,
        size: style.pointSize,
        sizeAttenuation: true,
        transparent: true,
        opacity: comp.name.includes("FACE") ? 0.75 : 1.0,
      });
      const points = new THREE.Points(ptGeo, ptMat);
      points.frustumCulled = false;
      this.root.add(points);

      // --- bones (line segments) ---
      let lines = null;
      let linePos = null;
      if (comp.limbs && comp.limbs.length) {
        const lnGeo = new THREE.BufferGeometry();
        linePos = new Float32Array(comp.limbs.length * 2 * 3);
        lnGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
        const lnMat = new THREE.LineBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: style.lineOpacity,
        });
        lines = new THREE.LineSegments(lnGeo, lnMat);
        lines.frustumCulled = false;
        this.root.add(lines);
      }

      this.groups.push({ comp, points, ptPos, lines, linePos });
    }

    this.built = true;
  }

  /**
   * Apply one frame.
   * @param {Array} frame - array of [x,y,z] or null, length == numPoints
   */
  applyFrame(frame) {
    if (!this.built || !frame) return;
    const HIDE = 9999; // push missing points far off-screen

    for (const g of this.groups) {
      const { comp, ptPos, linePos } = g;

      for (let i = 0; i < comp.count; i++) {
        const p = frame[comp.offset + i];
        const o = i * 3;
        if (p) {
          ptPos[o] = p[0];
          ptPos[o + 1] = p[1];
          ptPos[o + 2] = p[2];
        } else {
          ptPos[o] = ptPos[o + 1] = ptPos[o + 2] = HIDE;
        }
      }
      g.points.geometry.attributes.position.needsUpdate = true;

      if (g.lines && linePos) {
        for (let li = 0; li < comp.limbs.length; li++) {
          const [a, b] = comp.limbs[li];
          const pa = frame[comp.offset + a];
          const pb = frame[comp.offset + b];
          const o = li * 6;
          if (pa && pb) {
            linePos[o] = pa[0]; linePos[o + 1] = pa[1]; linePos[o + 2] = pa[2];
            linePos[o + 3] = pb[0]; linePos[o + 4] = pb[1]; linePos[o + 5] = pb[2];
          } else {
            // Degenerate segment -> invisible
            for (let k = 0; k < 6; k++) linePos[o + k] = HIDE;
          }
        }
        g.lines.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  setVisible(v) {
    this.root.visible = v;
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }
}

window.LandmarkRenderer = LandmarkRenderer;
