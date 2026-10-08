import React from "react";
import Link from "next/link";

export default function HowItWorksPage() {
  const steps = [
    {
      num: "1",
      title: "Audio Ingestion & Preprocessing",
      description:
        "The client browser captures 16kHz mono audio via the Web Audio API and packages it into standard RIFF WAV format. The backend ASR service transcribes spoken phrases into clean textual transcripts with zero external cloud dependencies.",
    },
    {
      num: "2",
      title: "Text-to-Gloss Translation & Marker Extraction",
      description:
        "Input text is parsed into linguistic sign gloss tokens following sign language syntactic grammar (Topic-Comment / OSV structure). Wh-questions, Yes/No inquiries, and negation triggers are automatically tagged with non-manual grammatical facial markers (furrowed brow, raised brow, head shake).",
    },
    {
      num: "3",
      title: "66-Point Motion Diffusion Synthesis",
      description:
        "A transformer-based diffusion denoiser predicts 66 continuous 3D spatial landmarks: 8 upper-body landmarks (shoulders, elbows, wrists, hips), 42 hand landmarks (21 per hand for full MANO-style finger articulation), and 16 facial anchor landmarks. Coarticulated transitions between consecutive signs are synthesized seamlessly.",
    },
    {
      num: "4",
      title: "Real-Time R3F Biomechanical Retargeting",
      description:
        "The React Three Fiber frontend streams landmark chunks over WebSocket. A parent-relative swing-twist solver derives bone quaternions from directional vectors, stabilized by a Casiez et al. One Euro Filter to eliminate tracking noise while preserving crisp finger articulation.",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 w-full">
      <div className="flex flex-col mb-12">
        <span className="text-xs font-semibold text-[#1E3A5F] mb-2">Technical Architecture</span>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#0F172A] tracking-tight mb-4">
          How the synthesis pipeline works
        </h1>
        <p className="text-base text-[#475569] leading-relaxed">
          From spoken audio or written text to real-time 3D signing kinematics, the pipeline operates in four strictly sequential stages designed for sub-400ms latency.
        </p>
      </div>

      {/* Sequential Pipeline Cards */}
      <div className="flex flex-col gap-6">
        {steps.map((step) => (
          <div
            key={step.num}
            className="flex flex-col sm:flex-row gap-6 p-6 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm"
          >
            <div className="w-10 h-10 rounded-md bg-[#1E3A5F] text-[#FFFFFF] font-mono text-base font-bold flex items-center justify-center shrink-0">
              {step.num}
            </div>
            <div className="flex flex-col">
              <h2 className="text-lg font-bold text-[#0F172A] mb-2">{step.title}</h2>
              <p className="text-sm text-[#475569] leading-relaxed">{step.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Next Step Action Box */}
      <div className="mt-12 p-8 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col">
          <h3 className="text-base font-bold text-[#0F172A] mb-1">Experience the live pipeline</h3>
          <p className="text-xs text-[#475569]">
            Test text generation and live speech transcription directly inside Studio.
          </p>
        </div>
        <Link
          href="/studio"
          className="inline-flex items-center justify-center px-5 py-2.5 text-xs font-semibold rounded bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] transition-colors shadow-sm shrink-0"
        >
          Launch Studio
        </Link>
      </div>
    </div>
  );
}
