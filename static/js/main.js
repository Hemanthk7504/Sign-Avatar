/**
 * Frontend controller.
 *
 * Opens a WebSocket to /ws/generate, sends text or microphone audio, and
 * plays back incoming motion frames. Picks a renderer based on the server's
 * declared format:
 *   "landmarks" -> LandmarkRenderer  (real MediaPipe capture, s2s backend)
 *   "joints"    -> SignAvatar        (primitive rig, procedural backend)
 *
 * Playback is clock-driven (requestAnimationFrame + elapsed time) rather than
 * setInterval, so frames land at the right wall-clock time even if the
 * browser throttles timers, and playback starts as soon as the first chunk
 * arrives instead of waiting for the full sequence.
 */
(function () {
  const canvasHost = document.getElementById("avatar-canvas");
  if (!canvasHost) return;

  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const fpsBadge = document.getElementById("fps-badge");
  const glossOutput = document.getElementById("gloss-output");
  const transcriptOutput = document.getElementById("transcript-output");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-text-btn");
  const variantSelect = document.getElementById("variant-select");
  const styleSelect = document.getElementById("style-select");
  const micBtn = document.getElementById("mic-btn");
  const micStatus = document.getElementById("mic-status");
  const backendBadge = document.getElementById("backend-badge");
  const debugToggle = document.getElementById("skeleton-debug-toggle");

  // Production 3D Skinned Avatar with PBR shading & retargeter
  const avatar = new (window.SkinnedAvatarRenderer || window.LandmarkRenderer)(canvasHost);
  if (debugToggle && avatar.setWireframeDebug) {
    debugToggle.addEventListener("change", (e) => {
      avatar.setWireframeDebug(e.target.checked);
    });
  }

  let ws = null;
  let format = "landmarks";
  let fps = 25;

  // Playback state
  let queue = [];
  let playing = false;
  let playStartMs = 0;
  let framesConsumed = 0;
  let sequenceComplete = false;

  function setStatus(kind, text) {
    statusDot.className = `dot ${kind}`;
    statusText.textContent = text;
  }

  function connect() {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${window.location.host}/ws/generate`);
    setStatus("connecting", "Connecting…");

    ws.onopen = () => { setStatus("connected", "Ready"); sendConfig(); };
    ws.onclose = () => { setStatus("error", "Disconnected — retrying…"); setTimeout(connect, 1500); };
    ws.onerror = () => setStatus("error", "Connection error");
    ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  }

  function sendConfig() {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "config",
        variant: variantSelect.value,
        style: styleSelect.value,
      }));
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "session_ready":
        fps = msg.config.fps || 25;
        if (backendBadge) backendBadge.textContent = msg.config.backend || "";
        break;

      case "transcript":
        transcriptOutput.textContent = msg.text;
        break;

      case "gloss":
        renderGloss(msg.tokens);
        break;

      case "sequence_start":
        format = msg.format;
        fps = msg.fps || fps;
        fpsBadge.textContent = `${fps} fps · ${msg.backend}`;
        if (backendBadge) backendBadge.textContent = msg.backend;

        queue = [];
        framesConsumed = 0;
        sequenceComplete = false;
        break;

      case "frames":
        queue.push(...msg.frames);
        if (msg.final) sequenceComplete = true;
        if (!playing) startPlayback();
        break;

      case "sequence_end":
        sequenceComplete = true;
        break;

      case "error":
        setStatus("error", `Error: ${msg.message}`);
        break;
    }
  }

  function renderGloss(tokens) {
    if (!tokens || !tokens.length) {
      glossOutput.textContent = "(no signable content)";
      return;
    }
    glossOutput.innerHTML = tokens.map((t) => {
      const nm = t.non_manual?.length
        ? `<span class="nm">${t.non_manual.join(", ")}</span>` : "";
      return `<span class="gloss-token">${t.gloss}${nm}</span>`;
    }).join(" ");
  }

  function startPlayback() {
    playing = true;
    playStartMs = performance.now();
    framesConsumed = 0;
    setStatus("connected", "Signing…");
    requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!playing) return;

    // Which frame index should be showing at this wall-clock moment?
    const target = Math.floor(((now - playStartMs) / 1000) * fps);

    if (target >= queue.length) {
      if (sequenceComplete && framesConsumed >= queue.length) {
        playing = false;
        setStatus("connected", "Ready");
        return;
      }
      // Buffer underrun: waiting on more frames from the server.
      requestAnimationFrame(tick);
      return;
    }

    const frame = queue[target];
    framesConsumed = target + 1;

    avatar.applyFrame(frame);

    requestAnimationFrame(tick);
  }

  // --- text input ---
  sendBtn.addEventListener("click", () => {
    const text = textInput.value.trim();
    if (!text) return;
    transcriptOutput.textContent = "—";
    setStatus("connecting", "Generating…");
    ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "text", text }));
  });

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendBtn.click();
  });

  variantSelect.addEventListener("change", sendConfig);
  styleSelect.addEventListener("change", sendConfig);

  // --- microphone (hold to talk with direct WAV/PCM encoding) ---
  let audioCtx = null;
  let micStream = null;
  let micProcessor = null;
  let recordedSamples = [];

  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    function writeString(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 channel
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // 16 bits
    writeString(36, "data");
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  async function startRecording() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      micProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
      recordedSamples = [];
      micProcessor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < input.length; i++) {
          recordedSamples.push(input[i]);
        }
      };
      source.connect(micProcessor);
      micProcessor.connect(audioCtx.destination);
      micBtn.classList.add("recording");
      micBtn.textContent = "🔴 Release to send";
      micStatus.textContent = "Listening…";
    } catch (err) {
      micStatus.textContent = `Mic error: ${err.message}`;
    }
  }

  function stopRecording() {
    if (!micStream) return;
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤 Hold to talk";
    micStatus.textContent = "Transcribing…";

    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor = null;
    }
    if (audioCtx) {
      const sampleRate = audioCtx.sampleRate || 16000;
      audioCtx.close();
      audioCtx = null;
      if (recordedSamples.length > 0 && ws?.readyState === WebSocket.OPEN) {
        const wavBuffer = encodeWAV(recordedSamples, sampleRate);
        ws.send(wavBuffer);
      }
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
  }

  micBtn.addEventListener("mousedown", startRecording);
  micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
  micBtn.addEventListener("mouseup", stopRecording);
  micBtn.addEventListener("mouseleave", stopRecording);
  micBtn.addEventListener("touchend", stopRecording);

  // --- Evaluation Suite Controls ---
  const tabStudyBtn = document.getElementById("tab-study-btn");
  const tabMetricsBtn = document.getElementById("tab-metrics-btn");
  const tabStudyContent = document.getElementById("tab-study-content");
  const tabMetricsContent = document.getElementById("tab-metrics-content");

  if (tabStudyBtn && tabMetricsBtn) {
    tabStudyBtn.addEventListener("click", () => {
      tabStudyBtn.classList.add("active");
      tabMetricsBtn.classList.remove("active");
      tabStudyContent.classList.add("active");
      tabMetricsContent.classList.remove("active");
    });
    tabMetricsBtn.addEventListener("click", () => {
      tabMetricsBtn.classList.add("active");
      tabStudyBtn.classList.remove("active");
      tabMetricsContent.classList.add("active");
      tabStudyContent.classList.remove("active");
    });
  }

  let activeParticipantId = null;
  const evalRole = document.getElementById("eval-role");
  const evalYears = document.getElementById("eval-years");
  const evalFreeRecall = document.getElementById("eval-free-recall");
  const evalSubmitBtn = document.getElementById("eval-submit-btn");
  const evalSummaryBtn = document.getElementById("eval-summary-btn");
  const evalStatus = document.getElementById("eval-status");
  const runMetricsBtn = document.getElementById("run-metrics-btn");
  const metricsResult = document.getElementById("metrics-result");

  async function ensureParticipant() {
    if (activeParticipantId) return activeParticipantId;
    try {
      const res = await fetch("/api/evaluation/participant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: evalRole.value,
          years_signing: parseFloat(evalYears.value) || 0,
        }),
      });
      const data = await res.json();
      activeParticipantId = data.participant_id;
      return activeParticipantId;
    } catch (err) {
      evalStatus.textContent = `Participant reg failed: ${err.message}`;
      return null;
    }
  }

  if (evalSubmitBtn) {
    evalSubmitBtn.addEventListener("click", async () => {
      const recall = evalFreeRecall.value.trim();
      if (!recall) {
        evalStatus.textContent = "Please write what you understood (free recall) first.";
        return;
      }
      const pid = await ensureParticipant();
      if (!pid) return;

      const getRating = (name) => {
        const el = document.querySelector(`input[name="${name}"]:checked`);
        return el ? parseInt(el.value, 10) : 4;
      };

      try {
        evalStatus.textContent = "Submitting rating…";
        const res = await fetch("/api/evaluation/response", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participant_id: pid,
            role: evalRole.value,
            stimulus_text: textInput.value.trim() || "Hello",
            backend: backendBadge?.textContent || "diffusion",
            variant: variantSelect.value,
            free_recall: recall,
            ratings: {
              comprehension: getRating("comp"),
              naturalness: getRating("nat"),
              grammaticality: getRating("gram"),
            },
          }),
        });
        const data = await res.json();
        evalStatus.textContent = `Response saved (ID: ${data.response_id})`;
        evalFreeRecall.value = "";
      } catch (err) {
        evalStatus.textContent = `Submission error: ${err.message}`;
      }
    });
  }

  if (evalSummaryBtn) {
    evalSummaryBtn.addEventListener("click", async () => {
      try {
        evalStatus.textContent = "Loading summary…";
        const res = await fetch("/api/evaluation/summary");
        const data = await res.json();
        if (data.n === 0) {
          evalStatus.textContent = "No responses recorded yet.";
          return;
        }
        let summaryText = `Total: ${data.n} ratings. `;
        if (data.by_role) {
          summaryText += Object.entries(data.by_role)
            .map(([r, s]) => `${r}: ${s.n} reviews`)
            .join(" | ");
        }
        evalStatus.textContent = summaryText;
      } catch (err) {
        evalStatus.textContent = `Error: ${err.message}`;
      }
    });
  }

  if (runMetricsBtn) {
    runMetricsBtn.addEventListener("click", async () => {
      metricsResult.innerHTML = "<span style='color:var(--muted)'>Evaluating diffusion motion realism vs real capture… (may take a few seconds)</span>";
      try {
        const res = await fetch("/api/evaluation/metrics?backend=diffusion&max_glosses=10", {
          method: "POST",
        });
        const d = await res.json();
        metricsResult.innerHTML = `
          <table class="metrics-table">
            <thead>
              <tr><th>Metric</th><th>Score</th><th>Target / Reference</th></tr>
            </thead>
            <tbody>
              <tr><td>APE (Spatial Error)</td><td>${d.ape.toFixed(3)}</td><td>Lower is better</td></tr>
              <tr><td>DTW (Time Warping)</td><td>${d.dtw.toFixed(3)}</td><td>Lower is better</td></tr>
              <tr><td>Jerk Ratio (Smoothness)</td><td>${d.jerk_ratio.toFixed(1)}x</td><td>1.0 = matches human capture</td></tr>
              <tr><td>Diversity (Mode Collapse)</td><td>${d.diversity.toFixed(3)}</td><td>Higher = distinct signs</td></tr>
            </tbody>
          </table>
        `;
      } catch (err) {
        metricsResult.innerHTML = `<span style="color:var(--bad)">Metrics failed: ${err.message}</span>`;
      }
    });
  }

  connect();
})();

