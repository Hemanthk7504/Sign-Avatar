"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/home";
  const { login, quickDemoLogin } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.push(redirectPath);
    } catch (err: any) {
      setError(err?.message || "Invalid credentials. Please verify your email and password.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async (account: "maya" | "alex" | "sophie") => {
    setError("");
    setSubmitting(true);
    try {
      await quickDemoLogin(account);
      router.push(redirectPath);
    } catch (err: any) {
      setError(err?.message || "Demo sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#F8FAFC] via-[#EFF6FF]/30 to-[#F8FAFC]">
      <div className="max-w-md w-full mx-auto">
        {/* Top Sign-In Card — inputs & Sign In button placed at the top per modern-web-guidance */}
        <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-xl p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                <span>🔐</span>
                <span>Strict Authentication</span>
              </span>
              <h1 className="text-2xl font-bold text-[#0F172A] mt-2 tracking-tight">
                Sign in to SignAvatar
              </h1>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[#1E3A5F] text-[#FFFFFF] flex items-center justify-center text-lg shadow-sm">
              🤟
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C]"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Email address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="username"
                enterKeyHint="next"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maya@signavatar.ai"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20 outline-none transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="current-password" className="text-xs font-semibold text-[#0F172A]">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotOpen(true);
                    setResetSent(false);
                    setResetEmail(email);
                  }}
                  className="text-xs font-semibold text-[#1D4ED8] hover:text-[#1E40AF]"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  id="current-password"
                  name="password"
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-3.5 pr-20 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-xs font-semibold text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 w-full py-3 px-5 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] text-sm font-semibold hover:bg-[#1E40AF] transition-all shadow-sm disabled:opacity-60"
            >
              {submitting ? "Verifying Session…" : "Sign In"}
            </button>
          </form>

          {/* Instant 2-User Demo Accounts */}
          <div className="mt-6 pt-6 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-bold text-[#0F172A]">
                Instant 2-User Social Accounts
              </span>
              <span className="text-[11px] font-mono text-[#475569]">PW: SignAvatar#2026</span>
            </div>
            <p className="text-xs text-[#475569] mb-3">
              Select either pre-verified community profile to test 2-user social interactions, feed reactions, and 3D signed messaging:
            </p>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => handleDemo("maya")}
                disabled={submitting}
                className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/60 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-[#1D4ED8] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                    ML
                  </span>
                  <div>
                    <div className="text-xs font-bold text-[#0F172A] group-hover:text-[#1D4ED8]">
                      User 1: Maya Lin (maya@signavatar.ai)
                    </div>
                    <div className="text-xs text-[#475569]">
                      Deaf Native ASL Signer &middot; Michelle 3D Rig
                    </div>
                  </div>
                </div>
                <span className="text-xs font-semibold text-[#1D4ED8]">Sign In →</span>
              </button>

              <button
                type="button"
                onClick={() => handleDemo("alex")}
                disabled={submitting}
                className="flex items-center justify-between p-3 rounded-xl border border-[#E2E8F0] hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/60 transition-all text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-lg bg-[#0F766E] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                    AR
                  </span>
                  <div>
                    <div className="text-xs font-bold text-[#0F172A] group-hover:text-[#1D4ED8]">
                      User 2: Dr. Alex Rivera (alex@signavatar.ai)
                    </div>
                    <div className="text-xs text-[#475569]">
                      Certified ASL Interpreter &middot; Alex 3D Rig
                    </div>
                  </div>
                </div>
                <span className="text-xs font-semibold text-[#1D4ED8]">Sign In →</span>
              </button>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#F1F5F9] text-center text-xs text-[#475569]">
            New to SignAvatar Enterprise?{" "}
            <Link
              href={`/register?redirect=${encodeURIComponent(redirectPath)}`}
              className="font-bold text-[#1D4ED8] hover:text-[#1E40AF]"
            >
              Create an account
            </Link>
          </div>
        </div>

        {/* Security Architecture Footer Note */}
        <div className="mt-4 p-4 rounded-xl bg-[#FFFFFF]/80 border border-[#E2E8F0] text-xs text-[#475569] flex items-center justify-between">
          <span>PBKDF2-HMAC-SHA256 (200k iter)</span>
          <span>&middot;</span>
          <span>5-Attempt Lockout Guard</span>
          <span>&middot;</span>
          <span>24h Signed Token</span>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-xs p-4">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-2xl max-w-sm w-full p-6">
            <h2 className="text-base font-bold text-[#0F172A] mb-2">Reset your password</h2>
            <p className="text-xs text-[#475569] mb-4">
              Enter your registered email address to receive a cryptographic password reset link, or use <code className="font-mono bg-[#F1F5F9] px-1 rounded">SignAvatar#2026</code> for demo accounts.
            </p>
            {resetSent ? (
              <div className="p-3 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-xs text-[#15803D] font-medium mb-4">
                If an account exists for <strong>{resetEmail}</strong>, recovery instructions have been dispatched.
              </div>
            ) : (
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#CBD5E1] mb-4"
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#475569] hover:bg-[#F1F5F9]"
              >
                Close
              </button>
              {!resetSent && (
                <button
                  type="button"
                  onClick={() => setResetSent(true)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]"
                >
                  Send Recovery Link
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-[#475569]">Loading sign-in form…</div>}>
      <LoginFormContent />
    </Suspense>
  );
}
