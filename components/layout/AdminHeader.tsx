"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AdminHeader() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-white/10">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/games" className="font-bold tracking-tight">
          THE PLAY+ <span className="text-white/50 font-normal">Admin</span>
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-white/60 hover:text-white transition-colors"
        >
          로그아웃
        </button>
      </div>
    </header>
  );
}
