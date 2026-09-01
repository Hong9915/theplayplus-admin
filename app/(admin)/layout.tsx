import type { ReactNode } from "react";
import AdminHeader from "@/components/layout/AdminHeader";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <AdminHeader />
      <main className="flex-1 w-full max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
