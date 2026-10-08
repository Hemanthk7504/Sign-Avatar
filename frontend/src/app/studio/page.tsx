"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { MotionWebSocketClient, GlossToken, WsStatus } from "@/lib/websocket";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { createFeedPost } from "@/lib/api";

function StudioContent() {
  // Studio State
  const [textInput, setTextInput] = useState("Where is the hospital?");
  const [variant, setVariant] = useState("ASL");
  const [style, setStyle] = useState("neutral");
  const [status, setStatus] = useState<WsStatus>("connecting");
  const [statusText, setStatusText] = useState("Connecting to pipeline…");
  const [backend, setBackend] = useState("diffusion");
  const [fps, setFps] = useState(25);
  const [showDebug, setShowDebug] = useState(false);
  const [avatarModel, setAvatarModel] = useState<string>("/models/michelle.glb");
  const [glossTokens, setGlossTokens] = useState<GlossToken[]>([]);
  const [transcript, setTranscript] = useState("—");
  const [activeGlossIndex, setActiveGlossIndex] = useState<number>(-1);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [micStatus, setMicStatus] = useState("");
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const speechRecognitionRef = useRef<any>(null);

  // 3D Motion Frame Playback State
  const [currentFrame, setCurrentFrame] = useState<number[][] | null>(null);
  const wsClientRef = useRef<MotionWebSocketClient | null>(null);
  const frameQueueRef = useRef<number[][][]>([]);
  const playStartRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);

  // WebSocket Connection
  useEffect(() => {
    const wsClient = new MotionWebSocketClient({
      onStatusChange: (s, msg) => {
        setStatus(s);
        if (msg) setStatusText(msg);
      },
      onSessionReady: (config) => {
        setBackend(config.backend || "diffusion");
        setStatusText("Ready");
      },
      onTranscript: (t) => {
        setTranscript(t);
        setTextInput(t);
        setMicStatus(`"${t}"`);
        setTimeout(() => setMicStatus(""), 4000);
      },
      onGloss: (tokens) => {
        setGlossTokens(tokens);
      },
      onSequenceStart: (meta) => {
        frameQueueRef.current = [];
        playStartRef.current = performance.now();
        isPlayingRef.current = true;
        setStatusText("Signing…");
      },
      onFrames: (frames) => {
        frameQueueRef.current.push(...frames);
      },
      onSequenceEnd: (duration) => {
        const totalDurationMs = Math.max(300, (duration || 0.5) * 1000);
        setTimeout(() => {
          isPlayingRef.current = false;
          setCurrentFrame(null);
          setStatusText("Ready");
        }, totalDurationMs + 200);
      },
      onError: (err) => {
        setStatusText(err);
        if (err.toLowerCase().includes("speech") || err.toLowerCase().includes("audio")) {
          setMicStatus(err);
          setTimeout(() => setMicStatus(""), 4500);
        }
      },
    });

    wsClient.connect();
    wsClientRef.current = wsClient;

    // 25 FPS motion tick loop
    const tick = (now: number) => {
      if (isPlayingRef.current && frameQueueRef.current.length > 0) {
        const queue = frameQueueRef.current;
        const targetFps = 25;
        const elapsedSec = (now - playStartRef.current) / 1000;
        const frameIdx = Math.floor(elapsedSec * targetFps);

        if (frameIdx < queue.length) {
          if (queue[frameIdx]) {
            setCurrentFrame(queue[frameIdx]);
          }
        } else {
          // Finished playing all frames in the stream: return cleanly to side-by-side rest
          isPlayingRef.current = false;
          setCurrentFrame(null);
          setStatusText("Ready");
        }
      }
      animFrameIdRef.current = requestAnimationFrame(tick);
    };

    animFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      wsClient.disconnect();
    };
  }, []);

  // Update backend config when variant, style, or backend engine changes
  const handleConfigChange = useCallback((newVariant: string, newStyle: string, newBackend: string) => {
    setVariant(newVariant);
    setStyle(newStyle);
    setBackend(newBackend);
    wsClientRef.current?.sendConfig(newVariant, newStyle, undefined, newBackend);
  }, []);

  const [shareStatus, setShareStatus] = useState("");

  // Submit Text Input
  const handleGenerateText = () => {
    if (!textInput.trim()) return;
    setStatusText("Synthesizing motion…");
    wsClientRef.current?.sendText(textInput.trim());
  };

  const handleShareToFeed = async () => {
    if (!textInput.trim()) return;
    try {
      await createFeedPost({
        content: textInput.trim(),
        variant,
        style,
        avatar_model: avatarModel,
        tags: [variant, "StudioSynthesis"],
      });
      setShareStatus("Published to Community Sign Feed!");
      setTimeout(() => setShareStatus(""), 3500);
    } catch (err: any) {
      setShareStatus(err?.message || "Failed to share");
      setTimeout(() => setShareStatus(""), 3500);
    }
  };

  // Microphone Audio Capture (Dual-Engine: Native Web Speech API with Fallback to Auto-Gain Linear PCM WAV)
  const startRecording = async () => {
    recordStartTimeRef.current = performance.now();
    setIsRecording(true);
    setMicStatus("Listening… Speak clearly");

    // Strategy A: Native Browser Web Speech Recognition (Chrome, Edge, etc.)
    const SpeechRecognition =
      typeof window !== "undefined" &&
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang =
          variant === "DSGS" ? "de-CH" : variant === "LSF-CH" ? "fr-CH" : variant === "LIS-CH" ? "it-CH" : "en-US";

        let currentResult = "";

        recognition.onresult = (event: any) => {
          let interim = "";
          let final = "";
          for (let i = 0; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              final += transcript + " ";
            } else {
              interim += transcript;
            }
          }
          currentResult = (final + interim).trim();
          if (currentResult) {
            setTextInput(currentResult);
            setMicStatus(`"${currentResult}"`);
          }
        };

        recognition.onerror = (e: any) => {
          console.warn("Native SpeechRecognition error:", e);
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
        return;
      } catch (err) {
        console.warn("Native SpeechRecognition start failed, falling back to AudioContext:", err);
      }
    }

    // Strategy B: Clean 16kHz PCM Stream with Auto-Gain Normalization
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      audioChunksRef.current = [];
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        audioChunksRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (err) {
      console.error("Microphone access failed:", err);
      setIsRecording(false);
      setMicStatus("Microphone access denied");
      setTimeout(() => setMicStatus(""), 3000);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);

    // If native speech recognition was running
    if (speechRecognitionRef.current) {
      const recognition = speechRecognitionRef.current;
      speechRecognitionRef.current = null;
      try {
        recognition.stop();
      } catch {}

      const duration = performance.now() - recordStartTimeRef.current;
      if (duration < 350) {
        setMicStatus("Hold while speaking");
        setTimeout(() => setMicStatus(""), 2000);
        return;
      }

      setMicStatus("Synthesizing…");
      setTimeout(() => {
        const currentText = textInput.trim();
        if (currentText) {
          handleGenerateText();
          setTimeout(() => setMicStatus(""), 2000);
        } else {
          setMicStatus("No speech detected");
          setTimeout(() => setMicStatus(""), 2500);
        }
      }, 300);
      return;
    }

    // AudioContext Fallback Pipeline
    if (!audioContextRef.current) return;

    // 1. Duration check
    const duration = performance.now() - recordStartTimeRef.current;
    const totalLength = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.length, 0);

    // Stop microphone hardware and audio nodes immediately
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.disconnect();
      } catch {}
      scriptProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }

    if (duration < 350 || totalLength < 4800) {
      setMicStatus("Hold to talk and release when finished");
      setTimeout(() => setMicStatus(""), 2500);
      return;
    }

    // 2. Peak amplitude analysis & silence gate
    let maxPeak = 0;
    for (const chunk of audioChunksRef.current) {
      for (let i = 0; i < chunk.length; i++) {
        const abs = Math.abs(chunk[i]);
        if (abs > maxPeak) maxPeak = abs;
      }
    }

    if (maxPeak < 0.005) {
      setMicStatus("No voice detected (mic quiet)");
      setTimeout(() => setMicStatus(""), 3000);
      return;
    }

    setMicStatus("Transcribing speech…");

    // 3. Dynamic Gain Normalization (boosts quiet speech up to 8x to reach clear ~0.85 peak)
    const gain = maxPeak > 0 ? Math.min(8.0, 0.85 / maxPeak) : 1.0;
    const pcmData = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunksRef.current) {
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i] * gain));
        pcmData[offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
    }

    // 4. Build RIFF WAV header (16kHz 16-bit Mono)
    const wavBuffer = new ArrayBuffer(44 + pcmData.byteLength);
    const view = new DataView(wavBuffer);
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + pcmData.byteLength, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Linear PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 16000, true); // 16kHz
    view.setUint32(28, 32000, true); // Byte rate (16000 * 2)
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16 bits
    writeString(view, 36, "data");
    view.setUint32(40, pcmData.byteLength, true);

    new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmData.buffer));

    // Send binary audio frame over WebSocket
    wsClientRef.current?.sendAudio(wavBuffer);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── LEFT COLUMN (62%): 3D SIGNING STAGE ──────────────────────────── */}
        <div className="lg:col-span-7 flex flex-col bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="relative aspect-[4/3] sm:aspect-[16/11] lg:aspect-[4/3] w-full bg-[#F8FAFC]">
            <AvatarStage
              currentFrame={currentFrame}
              showDebug={showDebug}
              modelUrl={avatarModel}
              onFpsUpdate={setFps}
              className="w-full h-full"
            />
          </div>

          {/* Status & Telemetry Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#FFFFFF] border-t border-[#E2E8F0] text-xs">
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status === "connected"
                    ? "bg-[#15803D]"
                    : status === "connecting"
                    ? "bg-[#B45309] animate-pulse"
                    : "bg-[#B91C1C]"
                }`}
              />
              <span className="font-medium text-[#0F172A]">{statusText}</span>
              <span className="text-[#E2E8F0]">|</span>
              <span className="px-2 py-0.5 rounded bg-[#F1F5F9] font-mono text-[11px] text-[#475569]">
                {backend}
              </span>
              <span className="font-mono text-[#475569]">{fps} fps</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#64748B]">Avatar:</span>
                <select
                  value={avatarModel}
                  onChange={(e) => setAvatarModel(e.target.value)}
                  className="px-2 py-1 text-xs rounded border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] font-medium outline-none focus:border-[#1D4ED8]"
                >
                  <option value="/models/michelle.glb">Human Interpreter (Michelle)</option>
                  <option value="/models/avatar.glb">Ready Player Me (Alex)</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#475569] hover:text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={showDebug}
                  onChange={(e) => setShowDebug(e.target.checked)}
                  className="rounded border-[#E2E8F0] text-[#1D4ED8] focus:ring-[#1D4ED8]"
                />
                <span>Biomechanical landmarks</span>
              </label>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN (38%): CONTROL CONSOLE ─────────────────────────── */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Text Input Deck */}
          <div className="flex flex-col p-5 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
            <label htmlFor="text-input" className="text-xs font-semibold text-[#0F172A] mb-2">
              Text input
            </label>
            <textarea
              id="text-input"
              rows={3}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Enter an English sentence, e.g. Where is the hospital?"
              className="w-full px-3 py-2 text-sm rounded border border-[#E2E8F0] focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] text-[#0F172A] resize-none outline-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleGenerateText}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 text-xs font-semibold rounded bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1D4ED8]"
              >
                Generate &amp; Sign (Live)
              </button>
              <button
                type="button"
                onClick={handleShareToFeed}
                className="inline-flex items-center justify-center px-3.5 py-2.5 text-xs font-semibold rounded bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
              >
                🤟 Share to Social Feed
              </button>
            </div>
            {shareStatus && (
              <div className="mt-2 text-xs font-semibold text-[#15803D]">
                ✓ {shareStatus}
              </div>
            )}
          </div>

          {/* Speech Input Deck */}
          <div className="flex flex-col p-5 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
            <label className="text-xs font-semibold text-[#0F172A] mb-2">
              Speech input
            </label>
            <div className="flex items-center gap-3">
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`flex-1 py-2.5 px-4 text-xs font-semibold rounded border transition-colors shadow-sm ${
                  isRecording
                    ? "bg-[#FEF2F2] border-[#B91C1C] text-[#B91C1C] animate-pulse"
                    : "bg-[#FFFFFF] border-[#E2E8F0] text-[#0F172A] hover:bg-[#F8FAFC]"
                }`}
              >
                {isRecording ? "Listening… Release to Synthesize" : "Hold to talk"}
              </button>
              {micStatus && (
                <span className="text-xs text-[#475569] font-medium">{micStatus}</span>
              )}
            </div>
          </div>

          {/* Linguistic & Engine Controls Row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col p-4 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
              <label htmlFor="variant-select" className="text-xs font-semibold text-[#0F172A] mb-1.5">
                Sign language variant
              </label>
              <select
                id="variant-select"
                value={variant}
                onChange={(e) => handleConfigChange(e.target.value, style, backend)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] outline-none"
              >
                <option value="ASL">ASL (American Sign Language)</option>
                <option value="DSGS">DSGS (Swiss German Sign Language)</option>
                <option value="LSF-CH">LSF-CH (Swiss French Sign Language)</option>
                <option value="LIS-CH">LIS-CH (Swiss Italian Sign Language)</option>
              </select>
            </div>

            <div className="flex flex-col p-4 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
              <label htmlFor="style-select" className="text-xs font-semibold text-[#0F172A] mb-1.5">
                Signing style
              </label>
              <select
                id="style-select"
                value={style}
                onChange={(e) => handleConfigChange(variant, e.target.value, backend)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] outline-none"
              >
                <option value="neutral">Neutral</option>
                <option value="expressive">Expressive</option>
                <option value="compact">Compact</option>
              </select>
            </div>

            {/* Motion Synthesis Engine Selector */}
            <div className="flex flex-col p-4 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="backend-select" className="text-xs font-semibold text-[#0F172A]">
                  Motion synthesis engine
                </label>
                <span className="text-[11px] font-medium text-[#1D4ED8]">
                  {backend === "diffusion" ? "Bilateral (both hands active)" : "Fingerspelling (dominant hand)"}
                </span>
              </div>
              <select
                id="backend-select"
                value={backend}
                onChange={(e) => handleConfigChange(variant, style, e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] outline-none font-medium"
              >
                <option value="diffusion">Neural Diffusion (Bilateral: Both Hands Active)</option>
                <option value="s2s">S2S Capture (Real Human Mocap: 1-Hand Dominant Fingerspelling)</option>
              </select>
            </div>
          </div>

          {/* Linguistic Gloss Token Stream */}
          <div className="flex flex-col p-5 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#0F172A]">Gloss sequence</span>
              <span className="text-[11px] text-[#475569]">Syntactic order</span>
            </div>
            <div className="min-h-[48px] p-3 rounded bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap gap-2 items-center">
              {glossTokens.length > 0 ? (
                glossTokens.map((token, idx) => (
                  <span
                    key={`${token.gloss}-${idx}`}
                    className="px-2 py-1 rounded bg-[#FFFFFF] border border-[#E2E8F0] font-mono text-xs font-semibold text-[#1E3A5F] shadow-xs"
                  >
                    {token.gloss}
                    {token.non_manual && token.non_manual.length > 0 && (
                      <span className="block text-[9px] text-[#B45309] font-sans font-normal">
                        [{token.non_manual.join(", ")}]
                      </span>
                    )}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[#475569] italic">—</span>
              )}
            </div>
          </div>

          {/* Speech Transcript Display */}
          <div className="flex flex-col p-5 bg-[#FFFFFF] rounded-lg border border-[#E2E8F0] shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#0F172A]">Speech transcript</span>
              <span className="text-[11px] text-[#475569]">ASR Output</span>
            </div>
            <div className="p-3 rounded bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A]">
              {transcript}
            </div>
          </div>

          {/* Pipeline Status Diagnostic Card */}
          <div className="p-4 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#475569] leading-relaxed">
            <strong className="text-[#0F172A]">Pipeline Architecture:</strong> Diffusion motion synthesis over 66-point spatial landmarks with Savitzky-Golay and One Euro temporal smoothing. Out-of-vocabulary terms automatically expand to fingerspelled letter sequences.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudioPage() {
  return (
    <AuthGuard featureName="the 3D Signing Studio">
      <StudioContent />
    </AuthGuard>
  );
}

