"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

interface AuthGuardProps {
  children: React.ReactNode;
  featureName?: string;
}

export function AuthGuard({ children, featureName = "this workspace" }: AuthGuardProps) {
  const { user, loading, quickDemoLogin } = useAuth();
  const pathname = usePathname();
  const [signingInRole, setSigningInRole] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-24 px-4">
        <div className="flex flex-col items-center gap-3 p-8 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm max-w-sm w-full text-center">
          <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-[#1D4ED8] border-t-transparent animate-spin" />
          </div>
          <span className="text-sm font-semibold text-[#0F172A]">Verifying Cryptographic Session…</span>
          <span className="text-xs text-[#475569]">Checking PBKDF2-HMAC-SHA256 bearer credentials</span>
        </div>
      </div>
    );
  }

  if (!user) {
    const handleQuickDemo = async (who: "maya" | "alex") => {
      setSigningInRole(who);
      setErrorMsg("");
      try {
        await quickDemoLogin(who);
      } catch (err: any) {
        setErrorMsg(err?.message || "Authentication failed");
      } finally {
        setSigningInRole(null);
      }
    };

    return (
      <div className="flex-1 flex items-center justify-center py-16 px-4 bg-gradient-to-b from-[#F8FAFC] to-[#EFF6FF]/40">
        <div className="max-w-lg w-full bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-xl p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-[#1E3A5F] text-[#FFFFFF] flex items-center justify-center font-bold text-base shadow-sm">
              🔒
            </div>
            <div>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                Strict Authentication Enforced
              </span>
              <h1 className="text-xl font-bold text-[#0F172A] mt-0.5">
                Sign in required to access {featureName}
              </h1>
            </div>
          </div>

          <p className="text-sm text-[#475569] leading-relaxed mb-6">
            This route (<code className="px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#0F172A] font-mono text-xs">{pathname}</code>) is protected by strict session verification. Please sign in with your verified SignAvatar account or create a new account to continue.
          </p>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs font-medium text-[#B91C1C]">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <Link
              href={`/login?redirect=${encodeURIComponent(pathname || "/home")}`}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] text-xs font-semibold hover:bg-[#1E40AF] transition-all shadow-sm"
            >
              Sign In with Credentials
            </Link>
            <Link
              href={`/register?redirect=${encodeURIComponent(pathname || "/home")}`}
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#FFFFFF] text-[#0F172A] border border-[#CBD5E1] text-xs font-semibold hover:bg-[#F8FAFC] transition-all"
            >
              Create Verified Account
            </Link>
          </div>

          <div className="pt-5 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[#0F172A]">
                Instant 2-User Market Evaluation Accounts
              </span>
              <span className="text-[11px] text-[#475569]">1-Click Verified Session</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleQuickDemo("maya")}
                disabled={signingInRole !== null}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[#E2E8F0] hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/50 transition-all text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-[#1D4ED8] text-[#FFFFFF] font-bold text-xs flex items-center justify-center shrink-0">
                  ML
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#0F172A] truncate">
                    {signingInRole === "maya" ? "Signing in…" : "User 1: Maya Lin"}
                  </div>
                  <div className="text-[11px] text-[#475569] truncate">Deaf ASL Signer · Michelle</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickDemo("alex")}
                disabled={signingInRole !== null}
                className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[#E2E8F0] hover:border-[#1D4ED8] hover:bg-[#EFF6FF]/50 transition-all text-left"
              >
                <span className="w-8 h-8 rounded-lg bg-[#0F766E] text-[#FFFFFF] font-bold text-xs flex items-center justify-center shrink-0">
                  AR
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#0F172A] truncate">
                    {signingInRole === "alex" ? "Signing in…" : "User 2: Dr. Alex Rivera"}
                  </div>
                  <div className="text-[11px] text-[#475569] truncate">ASL Interpreter · Alex</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
