import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm border border-line rounded-2xl p-8 bg-panel shadow-sm">
        <img src="/brand/theplayplus-logo.png" alt="THE PLAY+" width={224} height={225} className="mx-auto mb-5 h-24 w-auto" draggable={false} />
        <h1 className="text-xl font-bold mb-6 text-center">관리자 로그인</h1>
        <LoginForm />
      </div>
    </main>
  );
}
