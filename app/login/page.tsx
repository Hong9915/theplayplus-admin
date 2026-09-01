import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-6">관리자 로그인</h1>
      <LoginForm />
    </main>
  );
}
