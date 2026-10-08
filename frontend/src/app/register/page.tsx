"use client";

import React, { useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/home";
  const { register } = useAuth();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState("deaf_signer");
  const [variant, setVariant] = useState("ASL");
  const [avatarModel, setAvatarModel] = useState("/models/michelle.glb");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const passwordChecks = useMemo(() => {
    return [
      { label: "8+ characters", ok: password.length >= 8 },
      { label: "Uppercase (A-Z)", ok: /[A-Z]/.test(password) },
      { label: "Lowercase (a-z)", ok: /[a-z]/.test(password) },
      { label: "Number (0-9)", ok: /[0-9]/.test(password) },
      { label: "Special symbol (#!@$%)", ok: /[!@#$%^&*(),.?":{}|<>\-_+=\[\]\\;/`~]/.test(password) },
    ];
  }, [password]);

  const allPasswordChecksPass = passwordChecks.every((c) => c.ok);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!allPasswordChecksPass) {
      setError("Please satisfy all strict password complexity requirements before registering.");
      return;
    }
    setSubmitting(true);
    try {
      await register({
        full_name: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        password,
        role,
        preferred_variant: variant,
        avatar_model: avatarModel,
        bio: bio.trim(),
      });
      router.push(redirectPath);
    } catch (err: any) {
      setError(err?.message || "Registration failed. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-[#F8FAFC] via-[#EFF6FF]/30 to-[#F8FAFC]">
      <div className="max-w-lg w-full mx-auto">
        <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-xl p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                <span>🛡️</span>
                <span>Verified Signer Onboarding</span>
              </span>
              <h1 className="text-2xl font-bold text-[#0F172A] mt-2 tracking-tight">
                Create your SignAvatar account
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
            {/* Single name input per modern-web-guidance */}
            <div>
              <label htmlFor="full-name" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Full name
              </label>
              <input
                type="text"
                id="full-name"
                name="name"
                autoComplete="name"
                enterKeyHint="next"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Elena Rostova"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20 outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
                  placeholder="elena@signavatar.ai"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] outline-none"
                />
              </div>

              <div>
                <label htmlFor="username" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Community handle
                </label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  enterKeyHint="next"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="elena_signs"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="new-password" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Strict password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  id="new-password"
                  name="password"
                  autoComplete="new-password"
                  enterKeyHint="next"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password (e.g. SignAvatar#2026)"
                  className="w-full pl-3.5 pr-20 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] outline-none"
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

              {/* Real-time Password Strength Checklist */}
              <div className="mt-2.5 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                <div className="text-xs font-semibold text-[#0F172A] mb-2">
                  Strict Password Policy Requirements:
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {passwordChecks.map((check) => (
                    <div
                      key={check.label}
                      className={`flex items-center gap-1.5 text-xs font-medium ${
                        check.ok ? "text-[#15803D]" : "text-[#64748B]"
                      }`}
                    >
                      <span>{check.ok ? "✓" : "○"}</span>
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="role-select" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Community role
                </label>
                <select
                  id="role-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A]"
                >
                  <option value="deaf_signer">Deaf Native Signer</option>
                  <option value="certified_interpreter">Certified Interpreter</option>
                  <option value="hard_of_hearing">Hard of Hearing</option>
                  <option value="researcher">Linguistic Researcher</option>
                  <option value="hearing_learner">Hearing Sign Learner</option>
                </select>
              </div>

              <div>
                <label htmlFor="variant-select" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Primary sign language
                </label>
                <select
                  id="variant-select"
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A]"
                >
                  <option value="ASL">ASL (American)</option>
                  <option value="DSGS">DSGS (Swiss German)</option>
                  <option value="LSF-CH">LSF-CH (Swiss French)</option>
                  <option value="LIS-CH">LIS-CH (Swiss Italian)</option>
                </select>
              </div>

              <div>
                <label htmlFor="avatar-select" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                  Default 3D Avatar
                </label>
                <select
                  id="avatar-select"
                  value={avatarModel}
                  onChange={(e) => setAvatarModel(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A]"
                >
                  <option value="/models/michelle.glb">Michelle (Human Rig)</option>
                  <option value="/models/avatar.glb">Alex (RPM Morphs)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="bio" className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                Bio / Signing background (optional)
              </label>
              <input
                type="text"
                id="bio"
                enterKeyHint="done"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="e.g. ASL medical interpreter & accessibility advocate"
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 w-full py-3 px-5 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] text-sm font-semibold hover:bg-[#1E40AF] transition-all shadow-sm disabled:opacity-60"
            >
              {submitting ? "Creating Verified Account…" : "Create Account & Sign In"}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#F1F5F9] text-center text-xs text-[#475569]">
            Already have a verified account?{" "}
            <Link
              href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
              className="font-bold text-[#1D4ED8] hover:text-[#1E40AF]"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-[#475569]">Loading registration…</div>}>
      <RegisterFormContent />
    </Suspense>
  );
}
