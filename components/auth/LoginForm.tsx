"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import StatusMessage from "@/components/ui/StatusMessage";

const INPUT =
  "bg-panel border border-line rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent transition-colors";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);

    if (signInError) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다. 다시 확인한 뒤 시도하세요.");
      // 실패한 자리로 초점을 되돌려 바로 고칠 수 있게 한다.
      emailRef.current?.focus();
      return;
    }

    router.push("/games");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
      <label className="flex flex-col gap-1">
        <span>이메일</span>
        <input
          ref={emailRef}
          type="email"
          name="email"
          autoComplete="email"
          spellCheck={false}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-invalid={error ? true : undefined}
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>비밀번호</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-invalid={error ? true : undefined}
          className={INPUT}
        />
      </label>
      <StatusMessage className="text-sm">{error}</StatusMessage>
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:opacity-50 transition-colors"
      >
        {submitting ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}
