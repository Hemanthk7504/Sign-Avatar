"use client";

import React, { useState } from "react";
import { registerParticipant, submitEvaluationResponse, Participant } from "@/lib/api";
import { AuthGuard } from "@/components/auth/AuthGuard";

function EvaluationContent() {
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [role, setRole] = useState("certified_interpreter");
  const [yearsSigning, setYearsSigning] = useState("10");
  const [primaryLang, setPrimaryLang] = useState("ASL");

  // Form states
  const [stimulusText, setStimulusText] = useState("Where is the hospital?");
  const [freeRecall, setFreeRecall] = useState("");
  const [comprehension, setComprehension] = useState(5);
  const [naturalness, setNaturalness] = useState(4);
  const [grammaticality, setGrammaticality] = useState(5);
  const [notes, setNotes] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const p = await registerParticipant(role, parseFloat(yearsSigning) || 0, primaryLang);
      setParticipant(p);
      setSubmitStatus(`Participant registered: ID ${p.participant_id.slice(0, 8)}`);
    } catch (err) {
      setSubmitStatus(`Registration failed: ${err}`);
    }
  };

  const handleSubmitResponse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!participant) {
      setSubmitStatus("Please register a participant first.");
      return;
    }
    try {
      await submitEvaluationResponse({
        participant_id: participant.participant_id,
        role: participant.role,
        stimulus_text: stimulusText,
        backend: "diffusion",
        variant: "ASL",
        free_recall: freeRecall,
        ratings: {
          comprehension,
          naturalness,
          grammaticality,
        },
        notes,
      });
      setSubmitStatus("Evaluation response logged successfully to study dataset.");
      setFreeRecall("");
      setNotes("");
    } catch (err) {
      setSubmitStatus(`Submission failed: ${err}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 w-full">
      <div className="flex flex-col mb-10">
        <span className="text-xs font-semibold text-[#1E3A5F] mb-2">Clinical Validation</span>
        <h1 className="text-3xl sm:text-4xl font-bold text-[#0F172A] tracking-tight mb-3">
          Sign Language Intelligibility Study
        </h1>
        <p className="text-sm text-[#475569] leading-relaxed">
          Standardized evaluation protocol for certified interpreters and native Deaf signers to score synthesis accuracy, fluidity, and grammatical validity.
        </p>
      </div>

      {submitStatus && (
        <div className="mb-8 p-4 rounded-md bg-[#F1F5F9] border border-[#E2E8F0] text-xs font-medium text-[#0F172A]">
          {submitStatus}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Registration Column */}
        <div className="md:col-span-5 flex flex-col p-6 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
          <h2 className="text-sm font-bold text-[#0F172A] mb-4">
            1. Participant Registration
          </h2>
          <form onSubmit={handleRegister} className="flex flex-col gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">Participant role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A]"
              >
                <option value="certified_interpreter">Certified Interpreter</option>
                <option value="deaf_native_signer">Deaf Native Signer</option>
                <option value="asl_teacher">ASL Educator</option>
                <option value="linguist">Sign Language Linguist</option>
                <option value="researcher">Accessibility Researcher</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">Years signing</label>
              <input
                type="number"
                value={yearsSigning}
                onChange={(e) => setYearsSigning(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">Primary language</label>
              <input
                type="text"
                value={primaryLang}
                onChange={(e) => setPrimaryLang(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] text-[#0F172A]"
              />
            </div>

            <button
              type="submit"
              className="mt-2 w-full py-2.5 px-4 rounded bg-[#1E3A5F] text-[#FFFFFF] font-semibold hover:bg-[#162c46] transition-colors shadow-sm"
            >
              Register Participant
            </button>
          </form>
        </div>

        {/* Evaluation Scoring Form */}
        <div className="md:col-span-7 flex flex-col p-6 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
          <h2 className="text-sm font-bold text-[#0F172A] mb-4">
            2. Intelligibility Scoring
          </h2>
          <form onSubmit={handleSubmitResponse} className="flex flex-col gap-4 text-xs">
            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">Stimulus phrase</label>
              <input
                type="text"
                value={stimulusText}
                onChange={(e) => setStimulusText(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">
                Free recall (what you understood from the avatar)
              </label>
              <textarea
                rows={2}
                value={freeRecall}
                onChange={(e) => setFreeRecall(e.target.value)}
                placeholder="Type your translation before reading reference text..."
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] text-[#0F172A] resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Comprehension (1-5)</label>
                <select
                  value={comprehension}
                  onChange={(e) => setComprehension(parseInt(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded border border-[#E2E8F0] text-[#0F172A]"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Naturalness (1-5)</label>
                <select
                  value={naturalness}
                  onChange={(e) => setNaturalness(parseInt(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded border border-[#E2E8F0] text-[#0F172A]"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#0F172A] mb-1">Grammar (1-5)</label>
                <select
                  value={grammaticality}
                  onChange={(e) => setGrammaticality(parseInt(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded border border-[#E2E8F0] text-[#0F172A]"
                >
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#0F172A] mb-1.5">Linguistic notes / feedback</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observed handshape issues, non-manual timing, etc."
                className="w-full px-3 py-2 rounded border border-[#E2E8F0] text-[#0F172A] resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={!participant}
              className={`py-2.5 px-4 rounded text-xs font-semibold shadow-sm transition-colors ${
                participant
                  ? "bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]"
                  : "bg-[#F1F5F9] text-[#94A3B8] cursor-not-allowed"
              }`}
            >
              Submit Rating to Study Dataset
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function EvaluationPage() {
  return (
    <AuthGuard featureName="the Clinical Intelligibility Study">
      <EvaluationContent />
    </AuthGuard>
  );
}

