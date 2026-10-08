"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, quickDemoLogin } = useAuth();
  const [switching, setSwitching] = useState(false);

  const links = [
    { href: "/", label: "Overview" },
    { href: "/home", label: "Home", badge: "Workspace" },
    { href: "/community", label: "Social Hub", badge: "2-User" },
    { href: "/studio", label: "3D Studio" },
    { href: "/evaluation", label: "Evaluation" },
    { href: "/how-it-works", label: "Architecture" },
  ];

  const handleToggleUser = async () => {
    if (!user || switching) return;
    setSwitching(true);
    try {
      const nextTarget = user.username === "maya_lin" ? "alex" : "maya";
      await quickDemoLogin(nextTarget);
    } catch {}
    setSwitching(false);
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-50 bg-[#FFFFFF]/95 backdrop-blur-md border-b border-[#E2E8F0]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand identity */}
        <Link
          href="/"
          className="flex items-center gap-3 group focus-visible:ring-2 focus-visible:ring-[#1D4ED8] rounded-lg p-1 shrink-0"
        >
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1E3A5F] to-[#1D4ED8] text-[#FFFFFF] flex items-center justify-center font-bold text-sm tracking-tight shadow-sm">
            🤟
          </span>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-[#0F172A] tracking-tight group-hover:text-[#1D4ED8] transition-colors">
                SignAvatar
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
                Pro
              </span>
            </div>
            <span className="text-[11px] text-[#475569] leading-tight">
              3D Diffusion &amp; Social Network
            </span>
          </div>
        </Link>

        {/* Primary navigation */}
        <nav className="hidden lg:flex items-center gap-1" aria-label="Main Navigation">
          {links.map((link) => {
            const isActive =
              link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  isActive
                    ? "text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE]/60"
                    : "text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
                }`}
              >
                <span>{link.label}</span>
                {link.badge && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      isActive
                        ? "bg-[#1D4ED8] text-[#FFFFFF]"
                        : "bg-[#F1F5F9] text-[#1E3A5F]"
                    }`}
                  >
                    {link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Right: Auth Status & Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {user ? (
            <>
              {/* 1-Click Peer Switcher for testing 2-user interactions */}
              <button
                type="button"
                onClick={handleToggleUser}
                disabled={switching}
                title="Switch between User 1 (Maya Lin) and User 2 (Dr. Alex Rivera) to test 2-user interactions"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] text-[11px] font-semibold text-[#1E3A5F] transition-colors"
              >
                <span>⇄</span>
                <span>
                  {switching
                    ? "Switching…"
                    : user.username === "maya_lin"
                    ? "Switch to User 2 (Alex)"
                    : "Switch to User 1 (Maya)"}
                </span>
              </button>

              <Link
                href="/home"
                className="flex items-center gap-2 px-2.5 py-1 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] hover:border-[#CBD5E1] transition-colors"
              >
                <span className="w-7 h-7 rounded-lg bg-[#1D4ED8] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                  {user.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <div className="hidden xl:flex flex-col text-left">
                  <span className="text-xs font-bold text-[#0F172A] leading-tight flex items-center gap-1">
                    {user.full_name}
                    {user.verified && (
                      <span className="text-[#1D4ED8]" title="Verified Signer">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-[#475569] leading-tight">
                    @{user.username} &middot; {user.preferred_variant}
                  </span>
                </div>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#0F172A] hover:bg-[#F1F5F9] border border-[#E2E8F0] transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold rounded-lg bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] transition-colors shadow-sm"
              >
                Get Started
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Mobile Secondary Navigation Strip */}
      <div className="flex lg:hidden items-center gap-1 px-4 py-2 overflow-x-auto border-t border-[#F1F5F9] bg-[#F8FAFC]">
        {links.map((link) => {
          const isActive =
            link.href === "/" ? pathname === "/" : pathname?.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap ${
                isActive
                  ? "bg-[#1D4ED8] text-[#FFFFFF]"
                  : "text-[#475569] hover:text-[#0F172A]"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
