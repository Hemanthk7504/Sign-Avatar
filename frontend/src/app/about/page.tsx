import React from "react";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 w-full">
      <div className="flex flex-col mb-12">
        <span className="text-xs font-semibold text-[#1E3A5F] mb-2">Linguistic Accessibility</span>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#0F172A] tracking-tight mb-4">
          Bridging the communication gap with natural signed motion
        </h1>
        <p className="text-base text-[#475569] leading-relaxed">
          Over 70 million Deaf and Hard-of-Hearing individuals worldwide rely on signed languages as their primary mode of communication. Sign Avatar Studio provides an open, continuous generative framework for real-time accessible translation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
        <div className="flex flex-col p-6 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
          <h2 className="text-base font-bold text-[#0F172A] mb-3">
            Why traditional avatar systems fail
          </h2>
          <p className="text-sm text-[#475569] leading-relaxed mb-3">
            Most commercial signing avatars use concatenative libraries: pre-recorded animation clips stitched end-to-end. In continuous natural signing, the ending handshape and trajectory of one sign morph into the starting shape of the next (coarticulation).
          </p>
          <p className="text-sm text-[#475569] leading-relaxed">
            Stitched systems create severe mechanical jerkiness, lack grammatical non-manual markers, and cause significant cognitive fatigue for Deaf viewers trying to parse unnatural motions.
          </p>
        </div>

        <div className="flex flex-col p-6 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
          <h2 className="text-base font-bold text-[#0F172A] mb-3">
            The diffusion motion advantage
          </h2>
          <p className="text-sm text-[#475569] leading-relaxed mb-3">
            Our framework trains a diffusion denoiser directly on 66-point spatial landmark trajectories. Rather than stitching discrete clips, the model predicts continuous joint flows across time.
          </p>
          <p className="text-sm text-[#475569] leading-relaxed">
            Handshapes, wrist orientations, and grammatical facial expressions (such as eyebrow furrowing for Wh-questions) are generated in unified mathematical coordination, producing fluid, human-like signing.
          </p>
        </div>
      </div>

      <div className="p-8 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm mb-12">
        <h2 className="text-lg font-bold text-[#0F172A] mb-3">
          Clinical &amp; Linguistic Evaluation Methodology
        </h2>
        <p className="text-sm text-[#475569] leading-relaxed mb-4">
          To ensure credibility, motion synthesis quality is evaluated through double-blind human intelligibility studies conducted with certified sign language interpreters and native Deaf signers. Participants assess synthesized utterances across three core dimensions on a 1–5 scale:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded bg-[#F8FAFC] border border-[#E2E8F0]">
            <strong className="block text-[#0F172A] font-semibold mb-1">Comprehension</strong>
            Free-recall translation accuracy collected before disclosing target reference text.
          </div>
          <div className="p-4 rounded bg-[#F8FAFC] border border-[#E2E8F0]">
            <strong className="block text-[#0F172A] font-semibold mb-1">Naturalness</strong>
            Fluidity of hand transitions, arm kinematics, and avoidance of mechanical artifacts.
          </div>
          <div className="p-4 rounded bg-[#F8FAFC] border border-[#E2E8F0]">
            <strong className="block text-[#0F172A] font-semibold mb-1">Grammaticality</strong>
            Correct syntactic alignment of non-manual markers (eyebrows, head orientation, mouth).
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-6 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-[#0F172A]">Participate in the evaluation study</span>
          <span className="text-xs text-[#475569]">Certified interpreters can register and log evaluation scores.</span>
        </div>
        <Link
          href="/evaluation"
          className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold rounded bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] transition-colors shadow-sm"
        >
          Open Portal
        </Link>
      </div>
    </div>
  );
}
