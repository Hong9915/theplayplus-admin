// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginForm from "@/components/auth/LoginForm";

const signInWithPasswordMock = vi.fn();
const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: { signInWithPassword: signInWithPasswordMock },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("signs in and redirects to /games on success", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText("이메일"), "admin@theplayplus.com");
    await userEvent.type(screen.getByLabelText("비밀번호"), "correct-password");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "admin@theplayplus.com",
      password: "correct-password",
    });
    expect(pushMock).toHaveBeenCalledWith("/games");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows an error message when sign-in fails", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    render(<LoginForm />);

    await userEvent.type(screen.getByLabelText("이메일"), "admin@theplayplus.com");
    await userEvent.type(screen.getByLabelText("비밀번호"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));

    expect(await screen.findByText("이메일 또는 비밀번호가 올바르지 않습니다.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
