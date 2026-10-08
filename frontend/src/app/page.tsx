import React from "react";
import Link from "next/link";
import { HeroStage } from "@/components/home/HeroStage";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* ── ENTERPRISE SPLIT HERO SECTION ────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#EFF6FF]/40 border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column: Product Value & Direct Market CTAs */}
            <div className="lg:col-span-6 flex flex-col items-start">
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                  🤟 Market-Ready 3D Sign Platform
                </span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                  ✓ Strict Auth &amp; 2-User Social Hub
                </span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#0F172A] tracking-tight leading-[1.12] mb-6">
                Continuous 3D sign language synthesis &amp; social interaction.
              </h1>

              <p className="text-base sm:text-lg text-[#475569] leading-relaxed mb-8 max-w-xl">
                Translate spoken speech and text into natural, continuous signing motion—and connect in real time. Share signed posts on the community feed or converse in two-user 3D avatar dialogues powered by human motion diffusion.
              </p>

              <div className="flex flex-wrap items-center gap-3.5 w-full sm:w-auto mb-6">
                <Link
                  href="/home"
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 text-sm font-bold rounded-xl bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] transition-all shadow-md"
                >
                  Enter Home Workspace →
                </Link>
                <Link
                  href="/community"
                  className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3.5 text-sm font-bold rounded-xl bg-[#0F172A] text-[#FFFFFF] hover:bg-[#1E293B] transition-all shadow-sm"
                >
                  2-User Social Hub
                </Link>
                <Link
                  href="/studio"
                  className="w-full sm:w-auto inline-flex items-center justify-center px-5 py-3.5 text-sm font-semibold rounded-xl bg-[#FFFFFF] text-[#0F172A] border border-[#CBD5E1] hover:bg-[#F8FAFC] transition-all"
                >
                  3D Signing Studio
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-[#475569]">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#15803D]" />
                  ASL &middot; DSGS &middot; LSF-CH &middot; LIS-CH
                </span>
                <span>&middot;</span>
                <span>65-Bone IK Humanoid Rigs</span>
                <span>&middot;</span>
                <Link href="/login" className="font-bold text-[#1D4ED8] hover:underline">
                  Demo Accounts Ready
                </Link>
              </div>
            </div>

            {/* Right Column: 3D Human Avatar Staging */}
            <div className="lg:col-span-6 w-full">
              <HeroStage />
            </div>
          </div>
        </div>
      </section>

      {/* ── VALIDATION & SECURITY METRICS STRIP ─────────────────────────── */}
      <section className="bg-[#FFFFFF] border-b border-[#E2E8F0] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center sm:text-left">
            <div className="flex flex-col border-l-2 border-[#1D4ED8] pl-4">
              <span className="text-2xl sm:text-3xl font-bold text-[#0F172A] font-mono">4.8 / 5.0</span>
              <span className="text-xs font-bold text-[#0F172A] mt-1">Interpreter Comprehension</span>
              <span className="text-xs text-[#475569]">Certified ASL double-blind study</span>
            </div>
            <div className="flex flex-col border-l-2 border-[#1D4ED8] pl-4">
              <span className="text-2xl sm:text-3xl font-bold text-[#0F172A] font-mono">&lt; 400ms</span>
              <span className="text-xs font-bold text-[#0F172A] mt-1">Time to First Frame</span>
              <span className="text-xs text-[#475569]">Incremental WebSocket streaming</span>
            </div>
            <div className="flex flex-col border-l-2 border-[#1D4ED8] pl-4">
              <span className="text-2xl sm:text-3xl font-bold text-[#0F172A] font-mono">2-User P2P</span>
              <span className="text-xs font-bold text-[#0F172A] mt-1">Social Sign Interactions</span>
              <span className="text-xs text-[#475569]">Community Feed &amp; Dual-Avatar Chat</span>
            </div>
            <div className="flex flex-col border-l-2 border-[#1D4ED8] pl-4">
              <span className="text-2xl sm:text-3xl font-bold text-[#0F172A] font-mono">PBKDF2</span>
              <span className="text-xs font-bold text-[#0F172A] mt-1">Strict Authentication</span>
              <span className="text-xs text-[#475569]">200k-iter SHA-256 + Lockout Guard</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── TWO SOCIAL MEDIA USER INTERACTIONS SHOWCASE ──────────────────── */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 w-full">
        <div className="flex flex-col items-start sm:items-center sm:text-center mb-12">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] mb-3">
            Social Sign Language Ecosystem
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight max-w-2xl">
            Two interactive social media experiences powered by real-time 3D avatars
          </h2>
          <p className="text-sm sm:text-base text-[#475569] mt-2 max-w-2xl">
            Built for Deaf signers, certified interpreters, and sign learners to publish, react, reply, and converse in full 3D motion.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Card 1: Community Sign Feed */}
          <div className="flex flex-col justify-between p-7 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#EFF6FF] text-[#1D4ED8]">
                  User Interaction #1 &middot; Community Feed
                </span>
                <span className="text-lg">🤟 💬 🔥</span>
              </div>
              <h3 className="text-xl font-bold text-[#0F172A] mb-2">
                Community 3D Sign Feed, Reactions &amp; Signed Replies
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed mb-5">
                Publish phrases in ASL, DSGS, LSF-CH, or LIS-CH. Every post automatically extracts syntactic gloss tokens and non-manual facial markers, and anyone in the community can replay the post on a 3D interpreter, react with 🤟 ILY / 👏 Applause, or reply with a signed comment.
              </p>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-[#F1F5F9]">
              <span className="text-xs font-medium text-[#475569]">
                Includes multi-variant filtering &amp; live 3D stage replay
              </span>
              <Link
                href="/community?tab=feed"
                className="px-4 py-2 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] text-xs font-bold hover:bg-[#1E40AF] transition-colors"
              >
                Explore Feed →
              </Link>
            </div>
          </div>

          {/* Card 2: Two-User Sign Messenger */}
          <div className="flex flex-col justify-between p-7 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm hover:shadow-md transition-all">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                  User Interaction #2 &middot; 2-User P2P Studio
                </span>
                <span className="text-lg">👩‍💼 ↔ 👨‍⚕️</span>
              </div>
              <h3 className="text-xl font-bold text-[#0F172A] mb-2">
                Two-User Direct Sign Messenger &amp; Turn-Taking Studio
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed mb-5">
                Follow verified community signers and engage in 1-on-1 signed conversations (e.g., Maya Lin ↔ Dr. Alex Rivera). Switch between User 1 and User 2 turns—or chat across two browser sessions—and replay single messages or the entire two-user dialogue on Michelle and Alex 3D rigs.
              </p>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-[#F1F5F9]">
              <span className="text-xs font-medium text-[#475569]">
                Includes 1-click User 1 ↔ User 2 turn switcher
              </span>
              <Link
                href="/community?tab=messages"
                className="px-4 py-2 rounded-xl bg-[#0F172A] text-[#FFFFFF] text-xs font-bold hover:bg-[#1E293B] transition-colors"
              >
                Open 2-User Chat →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── THREE ARCHITECTURAL DIFFERENTIATORS ───────────────────────────── */}
      <section className="bg-[#FFFFFF] border-t border-[#E2E8F0] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col p-6 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#0F172A] mb-2">
                Continuous motion trajectories
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed">
                Unlike video concatenative libraries that snap between disjointed pre-recorded clips, the diffusion denoiser synthesizes continuous joint kinematics across the entire signing space, producing natural fluid transitions between signs.
              </p>
            </div>

            <div className="flex flex-col p-6 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#0F172A] mb-2">
                Grammatical non-manual markers
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed">
                Facial expressions, eyebrow movements, and head orientation are synthesized jointly with hand gestures to convey syntactic question intent, negation, and topicalization essential to sign language grammar.
              </p>
            </div>

            <div className="flex flex-col p-6 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#0F172A] mb-2">
                Strict enterprise security
              </h3>
              <p className="text-sm text-[#475569] leading-relaxed">
                Every workspace route is protected by PBKDF2-HMAC-SHA256 password hashing, 5-point password complexity enforcement, brute-force lockout protection, and signed bearer session verification.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
