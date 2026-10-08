import React from "react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[#E2E8F0] bg-[#FFFFFF]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-col gap-1 text-center sm:text-left">
          <span className="text-xs font-semibold text-[#0F172A]">Sign Avatar Studio</span>
          <p className="text-xs text-[#475569]">
            Generative 3D sign language avatar synthesis with speech recognition and motion diffusion.
          </p>
        </div>

        <div className="flex items-center gap-6 text-xs text-[#475569]">
          <Link href="/how-it-works" className="hover:text-[#0F172A] transition-colors">
            Architecture
          </Link>
          <Link href="/about" className="hover:text-[#0F172A] transition-colors">
            Accessibility Gap
          </Link>
          <Link href="/evaluation" className="hover:text-[#0F172A] transition-colors">
            Interpreter Study
          </Link>
          <span className="text-[#E2E8F0]">|</span>
          <span className="text-[11px] text-[#475569]">ASL &middot; DSGS &middot; LSF-CH &middot; LIS-CH</span>
        </div>
      </div>
    </footer>
  );
}
