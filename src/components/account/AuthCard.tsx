"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";

export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-[20%] -translate-x-1/2 ei-hero-glow" />
      </div>
      <Link href="/" className="mb-10">
        <BrandWordmark />
      </Link>
      <div className="ei-panel ei-glow w-full max-w-md p-6">
        <p className="text-[11px] uppercase tracking-[0.32em] text-[#00DFFF] mb-3">RyanFenn.ai</p>
        <h1 className="font-display text-2xl font-bold text-white">{title}</h1>
        <p className="text-sm text-[#94A3B8] mt-1.5 mb-6">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
