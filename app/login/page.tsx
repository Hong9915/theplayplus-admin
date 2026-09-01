import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm border border-line rounded-2xl p-8 bg-panel shadow-sm">
        <h1 className="text-xl font-bold mb-6">관리자 로그인</h1>
        <LoginForm />
      </div>
    </main>
  );
}
