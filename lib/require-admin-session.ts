import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export interface AdminSession {
  id: string;
  email: string;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // 이메일 없는 계정은 이론적으로 가능하다. 이력에 빈 문자열이 남는 것보다
  // id라도 남기는 편이 낫다.
  return { id: user.id, email: user.email ?? user.id };
}

export async function requireAdminSession(): Promise<boolean> {
  return (await getAdminSession()) !== null;
}
