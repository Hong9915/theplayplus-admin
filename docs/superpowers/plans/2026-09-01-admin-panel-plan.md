# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working, testable admin panel (`theplayplus-admin`) covering game management, per-game inquiry lists, status changes, Gmail-based reply sending, and account-history lookups — sharing the same Supabase project as the sibling `theplayplus-contact` repo.

**Architecture:** A self-contained Next.js 14 App Router project, same stack as `theplayplus-contact`. All business-data reads/writes (games, categories, inquiries, storage) go through one cached service-role Supabase client (`lib/supabase.ts`), matching `theplayplus-contact`'s existing pattern and bypassing RLS by design — there is no per-admin permission model (any authenticated admin sees everything). Supabase Auth (email+password) gates access at the route level only: `middleware.ts` uses `@supabase/ssr` purely to check "is someone logged in", delegating the redirect decision to a pure, unit-testable function, exactly like `theplayplus-contact`'s locale middleware. Category configuration (`games`/`inquiry_groups`/`inquiry_types`) is new schema owned by this repo; `inquiries`/`inquiry_attachments` already exist (or will be created) from `theplayplus-contact`'s migration, so this repo's migration only adds the columns/tables it needs with `if not exists` / `add column if not exists` guards, safe regardless of which repo's migration runs first.

**Tech Stack:** Next.js 14 (App Router, TypeScript), Tailwind CSS, Zod, `@supabase/supabase-js`, `@supabase/ssr`, `googleapis`, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-01-admin-panel-design.md`

## Global Constraints

- Dark theme colors must match the live site: background `#0a0a0a`, accent `#EA581F`.
- Admin UI is Korean-only — no i18n/messages files in this repo.
- All business-data access (games, categories, inquiries, storage) uses the service-role Supabase client (`lib/supabase.ts`); Supabase Auth session cookies are used only to gate route access in `middleware.ts`, never to scope data queries.
- No per-admin access control — any authenticated admin can see and edit every game's inquiries. The `owner_name` field on `games` is display-only.
- Account history matches strictly on `game_id` + `game_account` (never across games), and excludes inquiries with an empty `game_account`.
- Gmail reply sending: on failure, leave `status` unchanged and return an error the UI can retry; on success, set `status = 'resolved'`, `reply_content`, and `replied_at` together.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, etc.) live only in `.env`, never committed.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `postcss.config.mjs`
- Create: `tailwind.config.ts`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a buildable Next.js project with `@/*` path alias resolving to the repo root, Tailwind configured with the site's dark theme, and `npm test` wired to Vitest.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "theplayplus-admin",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/ssr": "^0.4.0",
    "@supabase/supabase-js": "^2.45.0",
    "googleapis": "^140.0.0",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^24.1.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.mjs**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Create postcss.config.mjs**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Create tailwind.config.ts**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0a",
        accent: "#EA581F",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Create vitest.config.ts and vitest.setup.ts**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

`vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Create app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 8: Create app/layout.tsx**

```tsx
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "THE PLAY+ Admin",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#0a0a0a] text-white antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create app/page.tsx (temporary placeholder, used only to verify the build)**

```tsx
export default function Home() {
  return <main className="p-8">theplayplus-admin scaffold</main>;
}
```

- [ ] **Step 10: Create .env.example**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_SENDER=info@theplayplus.com
```

- [ ] **Step 11: Create .gitignore**

```
/node_modules
/coverage
/.next/
/out/
/build
.DS_Store
*.pem
npm-debug.log*
.env
.env*.local
.vercel
*.tsbuildinfo
next-env.d.ts
```

- [ ] **Step 12: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `package-lock.json`.

- [ ] **Step 13: Verify the project builds**

Run: `npm run build`
Expected: build succeeds (Next.js will also generate `next-env.d.ts` at this point).

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts vitest.config.ts vitest.setup.ts app .env.example .gitignore
git commit -m "chore: scaffold Next.js project with Tailwind and Vitest"
```

---

## Task 2: Supabase Service-Role Client + Database Migration

**Files:**
- Create: `lib/supabase.ts`
- Create: `supabase/migrations/0001_admin_schema.sql`
- Test: `tests/lib/supabase.test.ts`

**Interfaces:**
- Consumes: `process.env.SUPABASE_URL`, `process.env.SUPABASE_SERVICE_ROLE_KEY`
- Produces: `getSupabaseServerClient(): SupabaseClient` (throws if env vars are missing; caches the client across calls). Used by Tasks 5, 6, 9, 11, 13, 15, 16.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/supabase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createClientMock = vi.fn().mockReturnValue({ marker: "fake-client" });

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

describe("getSupabaseServerClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockClear();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when environment variables are missing", async () => {
    delete process.env.SUPABASE_URL;
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    expect(() => getSupabaseServerClient()).toThrow(/SUPABASE_URL/);
  });

  it("creates a client using the configured credentials", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    getSupabaseServerClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) })
    );
  });

  it("caches the client across calls", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase");
    const first = getSupabaseServerClient();
    const second = getSupabaseServerClient();
    expect(first).toBe(second);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/supabase.test.ts`
Expected: FAIL — `@/lib/supabase` does not exist.

- [ ] **Step 3: Implement lib/supabase.ts**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/supabase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the Supabase migration SQL**

Create `supabase/migrations/0001_admin_schema.sql`:

```sql
create extension if not exists "pgcrypto";

create table if not exists games (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  status       text not null default 'active',
  logo_path    text,
  owner_name   text,
  created_at   timestamptz not null default now()
);

create table if not exists inquiry_groups (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  key          text not null,
  label_ko     text not null,
  label_zh     text,
  label_en     text,
  sort_order   int not null default 0
);

create table if not exists inquiry_types (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references inquiry_groups(id) on delete cascade,
  key                     text not null,
  label_ko                text not null,
  label_zh                text,
  label_en                text,
  requires_game_account   boolean not null default false,
  requires_company_name   boolean not null default false,
  allow_attachments       boolean not null default false,
  sort_order              int not null default 0
);

-- inquiries/inquiry_attachments may already exist from theplayplus-contact's
-- own migration. Create them if this repo's migration runs first, then
-- backfill the columns this repo needs either way.
create table if not exists inquiries (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid references games(id),
  locale         text not null default 'ko',
  group_key      text not null,
  type_key       text not null,
  game_account   text,
  company_name   text,
  reply_email    text not null,
  title          text not null,
  content        text not null,
  status         text not null default 'new',
  reply_content  text,
  replied_at     timestamptz,
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

alter table inquiries add column if not exists game_id uuid references games(id);
alter table inquiries add column if not exists reply_content text;
alter table inquiries add column if not exists replied_at timestamptz;

create table if not exists inquiry_attachments (
  id             uuid primary key default gen_random_uuid(),
  inquiry_id     uuid not null references inquiries(id) on delete cascade,
  file_path      text not null,
  file_name      text not null,
  created_at     timestamptz not null default now()
);

-- RLS: anon (used by theplayplus-contact) may read active games and all
-- categories, and insert inquiries/attachments. Everything else is
-- accessed only by this repo's service-role client, which bypasses RLS.
alter table games enable row level security;
alter table inquiry_groups enable row level security;
alter table inquiry_types enable row level security;

create policy "Public read active games" on games for select to anon using (status = 'active');
create policy "Public read inquiry_groups" on inquiry_groups for select to anon using (true);
create policy "Public read inquiry_types" on inquiry_types for select to anon using (true);

insert into storage.buckets (id, name, public)
values ('game-logos', 'game-logos', true)
on conflict (id) do nothing;

create policy "Public read game logos" on storage.objects for select
  using (bucket_id = 'game-logos');
```

Note: this file is not run automatically by the test suite; it must be applied to the shared Supabase project (via the Supabase CLI or SQL editor) before the admin panel can persist data end-to-end. That provisioning step is outside this plan's scope.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase.ts tests/lib/supabase.test.ts supabase/migrations/0001_admin_schema.sql
git commit -m "feat: add Supabase service-role client and admin schema migration"
```

---

## Task 3: Auth Redirect Logic + Middleware

**Files:**
- Create: `lib/auth-routing.ts`
- Create: `middleware.ts`
- Test: `tests/lib/auth-routing.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `resolveAdminAuthRedirect(pathname: string, isAuthenticated: boolean): string | null` — returns the path to redirect to, or `null` if no redirect is needed. Used only by `middleware.ts` in this task.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/auth-routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveAdminAuthRedirect } from "@/lib/auth-routing";

describe("resolveAdminAuthRedirect", () => {
  it("redirects an unauthenticated visitor away from a protected path", () => {
    expect(resolveAdminAuthRedirect("/games", false)).toBe("/login");
  });

  it("redirects an unauthenticated visitor away from a nested protected path", () => {
    expect(resolveAdminAuthRedirect("/inquiries/abc-123", false)).toBe("/login");
  });

  it("does not redirect an unauthenticated visitor already on /login", () => {
    expect(resolveAdminAuthRedirect("/login", false)).toBeNull();
  });

  it("does not redirect an authenticated visitor on a protected path", () => {
    expect(resolveAdminAuthRedirect("/games", true)).toBeNull();
  });

  it("redirects an authenticated visitor away from /login", () => {
    expect(resolveAdminAuthRedirect("/login", true)).toBe("/games");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/auth-routing.test.ts`
Expected: FAIL — `@/lib/auth-routing` does not exist.

- [ ] **Step 3: Implement lib/auth-routing.ts**

```ts
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function resolveAdminAuthRedirect(pathname: string, isAuthenticated: boolean): string | null {
  if (!isAuthenticated && !isPublicPath(pathname)) {
    return "/login";
  }
  if (isAuthenticated && pathname === "/login") {
    return "/games";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/auth-routing.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Implement middleware.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveAdminAuthRedirect } from "@/lib/auth-routing";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options) {
          response.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectPath = resolveAdminAuthRedirect(request.nextUrl.pathname, Boolean(user));
  if (!redirectPath) {
    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname = redirectPath;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
```

This is verified manually in the final task (via the dev server) rather than with an automated test, since it depends on the Next.js edge runtime request/response types and a live Supabase Auth session.

- [ ] **Step 6: Commit**

```bash
git add lib/auth-routing.ts middleware.ts tests/lib/auth-routing.test.ts
git commit -m "feat: add admin auth redirect middleware"
```

---

## Task 4: Supabase Browser Client + Login Page

**Files:**
- Create: `lib/supabase-browser.ts`
- Create: `app/login/page.tsx`
- Create: `components/auth/LoginForm.tsx`
- Test: `tests/components/LoginForm.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `getSupabaseBrowserClient(): SupabaseClient` (cached browser client using the anon key), `<LoginForm />` (client component, calls `supabase.auth.signInWithPassword` and redirects to `/games` on success).

- [ ] **Step 1: Implement lib/supabase-browser.ts**

```ts
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return cachedClient;
}
```

No dedicated test for this file — it is exercised through `LoginForm`'s tests below (mocked) and manually via the dev server, matching how `theplayplus-contact` treats its thin Supabase wrapper.

- [ ] **Step 2: Write the failing test**

Create `tests/components/LoginForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/LoginForm.test.tsx`
Expected: FAIL — `@/components/auth/LoginForm` does not exist.

- [ ] **Step 4: Implement components/auth/LoginForm.tsx**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);

    if (signInError) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }

    router.push("/games");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm">
      <label className="flex flex-col gap-1">
        <span>이메일</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>비밀번호</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
      >
        로그인
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/LoginForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Implement app/login/page.tsx**

```tsx
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-6">관리자 로그인</h1>
      <LoginForm />
    </main>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/supabase-browser.ts app/login components/auth tests/components/LoginForm.test.tsx
git commit -m "feat: add Supabase browser client and admin login page"
```

---

## Task 5: Categories Config — Default Template + DB Helpers

**Files:**
- Create: `lib/categories.ts`
- Test: `tests/lib/categories.test.ts`

**Interfaces:**
- Consumes: `getSupabaseServerClient` (Task 2)
- Produces: types `GameRow { id, name, status: "active"|"ended", logoPath: string|null, ownerName: string|null, createdAt: string }`, `DEFAULT_CATEGORY_TEMPLATE: DefaultCategoryGroup[]`, `createDefaultCategoriesForGame(supabase, gameId: string): Promise<void>`, `listGames(supabase): Promise<GameRow[]>`. Used by Tasks 6, 8.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/categories.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CATEGORY_TEMPLATE, createDefaultCategoriesForGame, listGames } from "@/lib/categories";

describe("DEFAULT_CATEGORY_TEMPLATE", () => {
  it("defines three groups in order with the expected type counts", () => {
    expect(DEFAULT_CATEGORY_TEMPLATE.map((g) => g.key)).toEqual(["game_usage", "business", "other"]);
    expect(DEFAULT_CATEGORY_TEMPLATE[0].types).toHaveLength(4);
    expect(DEFAULT_CATEGORY_TEMPLATE[1].types).toHaveLength(2);
    expect(DEFAULT_CATEGORY_TEMPLATE[2].types).toHaveLength(2);
  });

  it("every group and type has a Korean, Chinese, and English label", () => {
    for (const group of DEFAULT_CATEGORY_TEMPLATE) {
      expect(group.labelKo).toBeTruthy();
      expect(group.labelZh).toBeTruthy();
      expect(group.labelEn).toBeTruthy();
      for (const type of group.types) {
        expect(type.labelKo).toBeTruthy();
        expect(type.labelZh).toBeTruthy();
        expect(type.labelEn).toBeTruthy();
      }
    }
  });
});

describe("createDefaultCategoriesForGame", () => {
  function buildSupabaseMock() {
    const groupInsertResults = [{ id: "group-1" }, { id: "group-2" }, { id: "group-3" }];
    let groupCall = 0;

    const groupsSingle = vi.fn(() => Promise.resolve({ data: groupInsertResults[groupCall++], error: null }));
    const groupsSelect = vi.fn(() => ({ single: groupsSingle }));
    const groupsInsert = vi.fn(() => ({ select: groupsSelect }));

    const typesInsert = vi.fn(() => Promise.resolve({ error: null }));

    const from = vi.fn((table: string) => {
      if (table === "inquiry_groups") return { insert: groupsInsert };
      if (table === "inquiry_types") return { insert: typesInsert };
      throw new Error(`unexpected table: ${table}`);
    });

    return { from, groupsInsert, typesInsert };
  }

  it("creates one inquiry_groups row per template group, linked to the game", async () => {
    const supabase = buildSupabaseMock();
    await createDefaultCategoriesForGame(supabase as never, "game-abc");

    expect(supabase.groupsInsert).toHaveBeenCalledTimes(3);
    expect(supabase.groupsInsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ game_id: "game-abc", key: "game_usage" })
    );
  });

  it("creates inquiry_types rows scoped to the inserted group id", async () => {
    const supabase = buildSupabaseMock();
    await createDefaultCategoriesForGame(supabase as never, "game-abc");

    expect(supabase.typesInsert).toHaveBeenCalledTimes(3);
    const firstGroupTypes = supabase.typesInsert.mock.calls[0][0];
    expect(firstGroupTypes).toHaveLength(4);
    expect(firstGroupTypes[0]).toEqual(
      expect.objectContaining({ group_id: "group-1", key: "account_login", requires_game_account: true })
    );
  });

  it("throws if a group insert fails", async () => {
    const from = vi.fn(() => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "db error" } }) }),
      }),
    }));
    await expect(createDefaultCategoriesForGame({ from } as never, "game-abc")).rejects.toThrow(/game_usage/);
  });
});

describe("listGames", () => {
  it("maps snake_case rows to GameRow", async () => {
    const order = vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: "game-1",
            name: "여신키우기",
            status: "active",
            logo_path: "game-1/logo.png",
            owner_name: "홍길동",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      })
    );
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    const games = await listGames({ from } as never);
    expect(games).toEqual([
      {
        id: "game-1",
        name: "여신키우기",
        status: "active",
        logoPath: "game-1/logo.png",
        ownerName: "홍길동",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("throws on a query error", async () => {
    const order = vi.fn(() => Promise.resolve({ data: null, error: { message: "db error" } }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));

    await expect(listGames({ from } as never)).rejects.toThrow(/db error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: FAIL — `@/lib/categories` does not exist.

- [ ] **Step 3: Implement lib/categories.ts**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GameRow {
  id: string;
  name: string;
  status: "active" | "ended";
  logoPath: string | null;
  ownerName: string | null;
  createdAt: string;
}

export interface DefaultCategoryType {
  key: string;
  labelKo: string;
  labelZh: string;
  labelEn: string;
  requiresGameAccount: boolean;
  requiresCompanyName: boolean;
  allowAttachments: boolean;
  sortOrder: number;
}

export interface DefaultCategoryGroup {
  key: string;
  labelKo: string;
  labelZh: string;
  labelEn: string;
  sortOrder: number;
  types: DefaultCategoryType[];
}

export const DEFAULT_CATEGORY_TEMPLATE: DefaultCategoryGroup[] = [
  {
    key: "game_usage",
    labelKo: "게임 이용 문의",
    labelZh: "游戏使用咨询",
    labelEn: "Game Usage",
    sortOrder: 0,
    types: [
      {
        key: "account_login",
        labelKo: "계정/로그인",
        labelZh: "账号/登录",
        labelEn: "Account / Login",
        requiresGameAccount: true,
        requiresCompanyName: false,
        allowAttachments: false,
        sortOrder: 0,
      },
      {
        key: "payment_refund",
        labelKo: "결제/환불",
        labelZh: "付款/退款",
        labelEn: "Payment / Refund",
        requiresGameAccount: true,
        requiresCompanyName: false,
        allowAttachments: false,
        sortOrder: 1,
      },
      {
        key: "bug_report",
        labelKo: "버그·오류 신고",
        labelZh: "错误/漏洞举报",
        labelEn: "Bug / Error Report",
        requiresGameAccount: true,
        requiresCompanyName: false,
        allowAttachments: true,
        sortOrder: 2,
      },
      {
        key: "general",
        labelKo: "이용 문의",
        labelZh: "使用咨询",
        labelEn: "General Inquiry",
        requiresGameAccount: true,
        requiresCompanyName: false,
        allowAttachments: false,
        sortOrder: 3,
      },
    ],
  },
  {
    key: "business",
    labelKo: "사업 제휴 문의",
    labelZh: "商务合作咨询",
    labelEn: "Business Partnership",
    sortOrder: 1,
    types: [
      {
        key: "publishing",
        labelKo: "퍼블리싱/유통 제휴",
        labelZh: "发行/分销合作",
        labelEn: "Publishing / Distribution",
        requiresGameAccount: false,
        requiresCompanyName: true,
        allowAttachments: false,
        sortOrder: 0,
      },
      {
        key: "marketing",
        labelKo: "마케팅 제휴",
        labelZh: "市场合作",
        labelEn: "Marketing Partnership",
        requiresGameAccount: false,
        requiresCompanyName: true,
        allowAttachments: false,
        sortOrder: 1,
      },
    ],
  },
  {
    key: "other",
    labelKo: "기타 문의",
    labelZh: "其他咨询",
    labelEn: "Other",
    sortOrder: 2,
    types: [
      {
        key: "press",
        labelKo: "언론·취재",
        labelZh: "媒体采访",
        labelEn: "Press / Media",
        requiresGameAccount: false,
        requiresCompanyName: false,
        allowAttachments: false,
        sortOrder: 0,
      },
      {
        key: "etc",
        labelKo: "기타",
        labelZh: "其他",
        labelEn: "Other",
        requiresGameAccount: false,
        requiresCompanyName: false,
        allowAttachments: false,
        sortOrder: 1,
      },
    ],
  },
];

export async function createDefaultCategoriesForGame(supabase: SupabaseClient, gameId: string): Promise<void> {
  for (const group of DEFAULT_CATEGORY_TEMPLATE) {
    const { data: insertedGroup, error: groupError } = await supabase
      .from("inquiry_groups")
      .insert({
        game_id: gameId,
        key: group.key,
        label_ko: group.labelKo,
        label_zh: group.labelZh,
        label_en: group.labelEn,
        sort_order: group.sortOrder,
      })
      .select("id")
      .single();

    if (groupError || !insertedGroup) {
      throw new Error(`Failed to create inquiry group "${group.key}": ${groupError?.message ?? "unknown error"}`);
    }

    const typeRows = group.types.map((type) => ({
      group_id: insertedGroup.id,
      key: type.key,
      label_ko: type.labelKo,
      label_zh: type.labelZh,
      label_en: type.labelEn,
      requires_game_account: type.requiresGameAccount,
      requires_company_name: type.requiresCompanyName,
      allow_attachments: type.allowAttachments,
      sort_order: type.sortOrder,
    }));

    const { error: typesError } = await supabase.from("inquiry_types").insert(typeRows);
    if (typesError) {
      throw new Error(`Failed to create inquiry types for group "${group.key}": ${typesError.message}`);
    }
  }
}

function mapGameRow(row: {
  id: string;
  name: string;
  status: string;
  logo_path: string | null;
  owner_name: string | null;
  created_at: string;
}): GameRow {
  return {
    id: row.id,
    name: row.name,
    status: row.status as GameRow["status"],
    logoPath: row.logo_path,
    ownerName: row.owner_name,
    createdAt: row.created_at,
  };
}

export async function listGames(supabase: SupabaseClient): Promise<GameRow[]> {
  const { data, error } = await supabase.from("games").select("*").order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list games: ${error.message}`);
  }
  return (data ?? []).map(mapGameRow);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/categories.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/categories.ts tests/lib/categories.test.ts
git commit -m "feat: add default category template and games/categories DB helpers"
```

---

## Task 6: Games API Route

**Files:**
- Create: `lib/game-schema.ts`
- Create: `app/api/games/route.ts`
- Test: `tests/api/games.test.ts`

**Interfaces:**
- Consumes: `getSupabaseServerClient` (Task 2); `createDefaultCategoriesForGame` (Task 5)
- Produces: `gameFormSchema` (Zod), `type GameFormInput`; `POST(request: Request): Promise<Response>` at `app/api/games/route.ts`, called with `multipart/form-data` (`name`, `status`, `ownerName`, optional `logo` file). Responds `{ success: true, id, logoWarning?: string }` (200) or `{ success: false, error }` (400/500). Used by Task 7 (`GameForm`, via `fetch`).

- [ ] **Step 1: Implement lib/game-schema.ts**

```ts
import { z } from "zod";

export const gameFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(["active", "ended"]).default("active"),
  ownerName: z.string().trim().optional().default(""),
});

export type GameFormInput = z.infer<typeof gameFormSchema>;
```

- [ ] **Step 2: Write the failing tests**

Create `tests/api/games.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/games/route";
import * as supabaseModule from "@/lib/supabase";
import * as categoriesModule from "@/lib/categories";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/categories", () => ({
  createDefaultCategoriesForGame: vi.fn(),
}));

function buildFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base = { name: "여신키우기", status: "active", ownerName: "홍길동" };
  const merged = { ...base, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    fd.set(key, value);
  }
  return fd;
}

function mockSupabaseSuccess() {
  const single = vi.fn().mockResolvedValue({ data: { id: "game-1" }, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  const from = vi.fn().mockReturnValue({ insert, update });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const storageFrom = vi.fn().mockReturnValue({ upload });
  const client = { from, storage: { from: storageFrom } };
  vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue(client as never);
  return client;
}

describe("POST /api/games", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(categoriesModule.createDefaultCategoriesForGame).mockReset().mockResolvedValue(undefined);
  });

  it("creates a game and seeds default categories", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true, id: "game-1" });
    expect(categoriesModule.createDefaultCategoriesForGame).toHaveBeenCalledWith(expect.anything(), "game-1");
  });

  it("rejects a missing name", async () => {
    mockSupabaseSuccess();
    const request = new Request("http://localhost/api/games", {
      method: "POST",
      body: buildFormData({ name: "" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 500 when the game insert fails", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: vi.fn() } } as never);

    const request = new Request("http://localhost/api/games", { method: "POST", body: buildFormData() });
    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  it("saves the game even if logo upload fails, reporting a warning", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "game-1" }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const upload = vi.fn().mockResolvedValue({ error: { message: "storage error" } });
    const storageFrom = vi.fn().mockReturnValue({ upload });
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from, storage: { from: storageFrom } } as never);

    const fd = buildFormData();
    fd.set("logo", new File(["fake image bytes"], "logo.png", { type: "image/png" }));

    const request = new Request("http://localhost/api/games", { method: "POST", body: fd });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.logoWarning).toBe("logo.png");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/api/games.test.ts`
Expected: FAIL — `@/app/api/games/route` does not exist.

- [ ] **Step 4: Implement app/api/games/route.ts**

```ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { gameFormSchema } from "@/lib/game-schema";
import { getSupabaseServerClient } from "@/lib/supabase";
import { createDefaultCategoriesForGame } from "@/lib/categories";

export async function POST(request: Request) {
  const formData = await request.formData();

  const parsed = gameFormSchema.safeParse({
    name: formData.get("name"),
    status: formData.get("status") || undefined,
    ownerName: formData.get("ownerName") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_input" }, { status: 400 });
  }

  const input = parsed.data;
  const supabase = getSupabaseServerClient();

  const { data: inserted, error: insertError } = await supabase
    .from("games")
    .insert({
      name: input.name,
      status: input.status,
      owner_name: input.ownerName || null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  let logoWarning: string | undefined;
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const path = `${inserted.id}/${randomUUID()}-${logo.name}`;
    const { error: uploadError } = await supabase.storage.from("game-logos").upload(path, logo);
    if (uploadError) {
      logoWarning = logo.name;
    } else {
      await supabase.from("games").update({ logo_path: path }).eq("id", inserted.id);
    }
  }

  await createDefaultCategoriesForGame(supabase, inserted.id);

  return NextResponse.json({ success: true, id: inserted.id, ...(logoWarning ? { logoWarning } : {}) }, { status: 200 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/games.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/game-schema.ts app/api/games/route.ts tests/api/games.test.ts
git commit -m "feat: add game creation API route with logo upload and category seeding"
```

---

## Task 7: GameForm + GameList Components

**Files:**
- Create: `components/games/GameForm.tsx`
- Create: `components/games/GameList.tsx`
- Test: `tests/components/GameForm.test.tsx`
- Test: `tests/components/GameList.test.tsx`

**Interfaces:**
- Consumes: `GameRow` (Task 5)
- Produces: `<GameForm onCreated={() => void} />` (posts to `POST /api/games`), `<GameList games={GameRow[]} />`. Used by Task 8.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/GameForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GameForm from "@/components/games/GameForm";

describe("GameForm", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, id: "game-1" }),
    }) as never;
  });

  it("requires a game name before submitting", async () => {
    render(<GameForm onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("submits the form data and calls onCreated on success", async () => {
    const onCreated = vi.fn();
    render(<GameForm onCreated={onCreated} />);

    await userEvent.type(screen.getByLabelText("게임명"), "여신키우기");
    await userEvent.click(screen.getByRole("button", { name: "게임 추가" }));

    expect(global.fetch).toHaveBeenCalledWith("/api/games", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("게임이 추가되었습니다.")).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalled();
  });
});
```

Create `tests/components/GameList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GameList from "@/components/games/GameList";
import type { GameRow } from "@/lib/categories";

describe("GameList", () => {
  const games: GameRow[] = [
    { id: "game-1", name: "여신키우기", status: "active", logoPath: null, ownerName: "홍길동", createdAt: "2026-01-01" },
    { id: "game-2", name: "종료된 게임", status: "ended", logoPath: null, ownerName: null, createdAt: "2025-01-01" },
  ];

  it("renders a link per game showing name and status", () => {
    render(<GameList games={games} />);
    expect(screen.getByText("여신키우기")).toBeInTheDocument();
    expect(screen.getByText("서비스중")).toBeInTheDocument();
    expect(screen.getByText("종료된 게임")).toBeInTheDocument();
    expect(screen.getByText("종료")).toBeInTheDocument();
  });

  it("shows an empty state when there are no games", () => {
    render(<GameList games={[]} />);
    expect(screen.getByText("등록된 게임이 없습니다.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/GameForm.test.tsx tests/components/GameList.test.tsx`
Expected: FAIL — components do not exist.

- [ ] **Step 3: Implement components/games/GameForm.tsx**

```tsx
"use client";

import { useState, type FormEvent } from "react";

export default function GameForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"active" | "ended">("active");
  const [ownerName, setOwnerName] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setSubmitting(true);
    setMessage(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("status", status);
    formData.set("ownerName", ownerName);
    if (logo) {
      formData.set("logo", logo);
    }

    const response = await fetch("/api/games", { method: "POST", body: formData });
    const json = await response.json();
    setSubmitting(false);

    if (!json.success) {
      setMessage("게임 추가에 실패했습니다. 다시 시도해주세요.");
      return;
    }

    if (json.logoWarning) {
      setMessage(`게임은 저장됐지만 로고 업로드에 실패했습니다: ${json.logoWarning}`);
    } else {
      setMessage("게임이 추가되었습니다.");
    }

    setName("");
    setOwnerName("");
    setLogo(null);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-sm">
      <label className="flex flex-col gap-1">
        <span>게임명</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>상태</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "active" | "ended")}
          className="bg-black border border-white/20 rounded px-3 py-2"
        >
          <option value="active">서비스중</option>
          <option value="ended">종료</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span>담당자</span>
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span>로고</span>
        <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
      </label>
      {message && <p className="text-sm">{message}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
      >
        게임 추가
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Implement components/games/GameList.tsx**

```tsx
import Link from "next/link";
import type { GameRow } from "@/lib/categories";

export default function GameList({ games }: { games: GameRow[] }) {
  if (games.length === 0) {
    return <p>등록된 게임이 없습니다.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {games.map((game) => (
        <li key={game.id} className="border border-white/10 rounded p-4">
          <Link href={`/games/${game.id}/inquiries`} className="flex items-center justify-between">
            <span className="font-medium">{game.name}</span>
            <span className="text-sm text-white/60">{game.status === "active" ? "서비스중" : "종료"}</span>
          </Link>
          {game.ownerName && <p className="text-sm text-white/60 mt-1">담당자: {game.ownerName}</p>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/components/GameForm.test.tsx tests/components/GameList.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add components/games tests/components/GameForm.test.tsx tests/components/GameList.test.tsx
git commit -m "feat: add game creation form and game list components"
```

---

## Task 8: Games Page

**Files:**
- Create: `app/games/page.tsx`
- Create: `components/games/GamesPageClient.tsx`

**Interfaces:**
- Consumes: `getSupabaseServerClient` (Task 2), `listGames` (Task 5), `GameForm`, `GameList` (Task 7)
- Produces: the `/games` route. `GamesPageClient` wraps `GameForm` + `GameList` and calls `router.refresh()` from `GameForm`'s `onCreated` to reload the server-fetched list.

- [ ] **Step 1: Implement components/games/GamesPageClient.tsx**

```tsx
"use client";

import { useRouter } from "next/navigation";
import GameForm from "@/components/games/GameForm";
import GameList from "@/components/games/GameList";
import type { GameRow } from "@/lib/categories";

export default function GamesPageClient({ games }: { games: GameRow[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">게임 추가</h2>
        <GameForm onCreated={() => router.refresh()} />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-3">게임 목록</h2>
        <GameList games={games} />
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Implement app/games/page.tsx**

```tsx
import { getSupabaseServerClient } from "@/lib/supabase";
import { listGames } from "@/lib/categories";
import GamesPageClient from "@/components/games/GamesPageClient";

export default async function GamesPage() {
  const supabase = getSupabaseServerClient();
  const games = await listGames(supabase);

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-6">게임 관리</h1>
      <GamesPageClient games={games} />
    </main>
  );
}
```

- [ ] **Step 3: Verify the project builds**

Run: `npm run build`
Expected: build succeeds (this route has no dedicated test — it is a thin composition of already-tested pieces, verified manually against a real Supabase project in the final task).

- [ ] **Step 4: Commit**

```bash
git add app/games/page.tsx components/games/GamesPageClient.tsx
git commit -m "feat: add /games page"
```

---

## Task 9: Inquiries + Attachments Query Lib

**Files:**
- Create: `lib/inquiries.ts`
- Test: `tests/lib/inquiries.test.ts`

**Interfaces:**
- Consumes: nothing beyond a `SupabaseClient` instance
- Produces: types `InquiryStatus = "new"|"in_progress"|"resolved"`, `InquiryRow`, `AttachmentWithUrl { id, fileName, signedUrl: string | null }`; functions `listInquiriesByGame(supabase, gameId: string, status?: InquiryStatus): Promise<InquiryRow[]>`, `getInquiryById(supabase, id: string): Promise<InquiryRow | null>`, `listAttachmentSignedUrls(supabase, inquiryId: string): Promise<AttachmentWithUrl[]>`. Used by Tasks 10, 16.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/inquiries.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { listInquiriesByGame, getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";

const sampleRow = {
  id: "inq-1",
  game_id: "game-1",
  group_key: "game_usage",
  type_key: "bug_report",
  game_account: "player1",
  company_name: null,
  reply_email: "a@b.com",
  title: "제목",
  content: "내용",
  status: "new",
  reply_content: null,
  replied_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("listInquiriesByGame", () => {
  it("filters by game_id and orders by created_at desc", async () => {
    const order = vi.fn().mockResolvedValue({ data: [sampleRow], error: null });
    const eqGame = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    const result = await listInquiriesByGame({ from } as never, "game-1");
    expect(eqGame).toHaveBeenCalledWith("game_id", "game-1");
    expect(result[0].gameAccount).toBe("player1");
  });

  it("applies an additional status filter when provided", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const eqStatus = vi.fn(() => ({ order }));
    const eqGame = vi.fn(() => ({ eq: eqStatus, order }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    await listInquiriesByGame({ from } as never, "game-1", "resolved");
    expect(eqStatus).toHaveBeenCalledWith("status", "resolved");
  });
});

describe("getInquiryById", () => {
  it("returns null when the query errors", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "missing");
    expect(result).toBeNull();
  });

  it("maps a found row", async () => {
    const single = vi.fn().mockResolvedValue({ data: sampleRow, error: null });
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await getInquiryById({ from } as never, "inq-1");
    expect(result?.status).toBe("new");
  });
});

describe("listAttachmentSignedUrls", () => {
  it("returns an empty array when there are no attachments", async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    const result = await listAttachmentSignedUrls({ from } as never, "inq-1");
    expect(result).toEqual([]);
  });

  it("signs a URL for each attachment", async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{ id: "att-1", file_path: "inq-1/screenshot.png", file_name: "screenshot.png" }],
      error: null,
    });
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/x" }, error: null });
    const storageFrom = vi.fn(() => ({ createSignedUrl }));

    const result = await listAttachmentSignedUrls({ from, storage: { from: storageFrom } } as never, "inq-1");
    expect(createSignedUrl).toHaveBeenCalledWith("inq-1/screenshot.png", 3600);
    expect(result).toEqual([{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: FAIL — `@/lib/inquiries` does not exist.

- [ ] **Step 3: Implement lib/inquiries.ts**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type InquiryStatus = "new" | "in_progress" | "resolved";

export interface InquiryRow {
  id: string;
  gameId: string;
  groupKey: string;
  typeKey: string;
  gameAccount: string | null;
  companyName: string | null;
  replyEmail: string;
  title: string;
  content: string;
  status: InquiryStatus;
  replyContent: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export interface AttachmentWithUrl {
  id: string;
  fileName: string;
  signedUrl: string | null;
}

function mapInquiryRow(row: {
  id: string;
  game_id: string;
  group_key: string;
  type_key: string;
  game_account: string | null;
  company_name: string | null;
  reply_email: string;
  title: string;
  content: string;
  status: string;
  reply_content: string | null;
  replied_at: string | null;
  created_at: string;
}): InquiryRow {
  return {
    id: row.id,
    gameId: row.game_id,
    groupKey: row.group_key,
    typeKey: row.type_key,
    gameAccount: row.game_account,
    companyName: row.company_name,
    replyEmail: row.reply_email,
    title: row.title,
    content: row.content,
    status: row.status as InquiryStatus,
    replyContent: row.reply_content,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
  };
}

export async function listInquiriesByGame(
  supabase: SupabaseClient,
  gameId: string,
  status?: InquiryStatus
): Promise<InquiryRow[]> {
  let query = supabase.from("inquiries").select("*").eq("game_id", gameId);
  if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list inquiries: ${error.message}`);
  }
  return (data ?? []).map(mapInquiryRow);
}

export async function getInquiryById(supabase: SupabaseClient, id: string): Promise<InquiryRow | null> {
  const { data, error } = await supabase.from("inquiries").select("*").eq("id", id).single();
  if (error || !data) {
    return null;
  }
  return mapInquiryRow(data);
}

export async function listAttachmentSignedUrls(
  supabase: SupabaseClient,
  inquiryId: string
): Promise<AttachmentWithUrl[]> {
  const { data, error } = await supabase
    .from("inquiry_attachments")
    .select("id, file_path, file_name")
    .eq("inquiry_id", inquiryId);

  if (error || !data) {
    return [];
  }

  const results: AttachmentWithUrl[] = [];
  for (const attachment of data) {
    const { data: signed } = await supabase.storage
      .from("inquiry-attachments")
      .createSignedUrl(attachment.file_path, 3600);
    results.push({ id: attachment.id, fileName: attachment.file_name, signedUrl: signed?.signedUrl ?? null });
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/inquiries.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/inquiries.ts tests/lib/inquiries.test.ts
git commit -m "feat: add inquiries and attachment query helpers"
```

---

## Task 10: InquiryList Component + Game Inquiries Page

**Files:**
- Create: `components/inquiries/InquiryList.tsx`
- Create: `app/games/[gameId]/inquiries/page.tsx`
- Test: `tests/components/InquiryList.test.tsx`

**Interfaces:**
- Consumes: `InquiryRow`, `InquiryStatus`, `listInquiriesByGame` (Task 9); `getSupabaseServerClient` (Task 2)
- Produces: `<InquiryList inquiries={InquiryRow[]} activeStatus={InquiryStatus | "all"} gameId={string} />`, the `/games/[gameId]/inquiries?status=...` route.

- [ ] **Step 1: Write the failing test**

Create `tests/components/InquiryList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryList from "@/components/inquiries/InquiryList";
import type { InquiryRow } from "@/lib/inquiries";

describe("InquiryList", () => {
  const inquiries: InquiryRow[] = [
    {
      id: "inq-1",
      gameId: "game-1",
      groupKey: "game_usage",
      typeKey: "bug_report",
      gameAccount: "player1",
      companyName: null,
      replyEmail: "a@b.com",
      title: "버그 제보",
      content: "내용",
      status: "new",
      replyContent: null,
      repliedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("renders a link per inquiry with title and status", () => {
    render(<InquiryList inquiries={inquiries} activeStatus="all" gameId="game-1" />);
    expect(screen.getByText("버그 제보")).toBeInTheDocument();
    expect(screen.getByText("접수")).toBeInTheDocument();
  });

  it("renders status filter links including the current game id", () => {
    render(<InquiryList inquiries={inquiries} activeStatus="all" gameId="game-1" />);
    const link = screen.getByRole("link", { name: "처리중" });
    expect(link.getAttribute("href")).toBe("/games/game-1/inquiries?status=in_progress");
  });

  it("shows an empty state when there are no inquiries", () => {
    render(<InquiryList inquiries={[]} activeStatus="all" gameId="game-1" />);
    expect(screen.getByText("접수된 문의가 없습니다.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/InquiryList.test.tsx`
Expected: FAIL — `@/components/inquiries/InquiryList` does not exist.

- [ ] **Step 3: Implement components/inquiries/InquiryList.tsx**

```tsx
import Link from "next/link";
import type { InquiryRow, InquiryStatus } from "@/lib/inquiries";

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

const FILTERS: Array<{ value: InquiryStatus | "all"; label: string }> = [
  { value: "all", label: "전체" },
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

export default function InquiryList({
  inquiries,
  activeStatus,
  gameId,
}: {
  inquiries: InquiryRow[];
  activeStatus: InquiryStatus | "all";
  gameId: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-3 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "all" ? `/games/${gameId}/inquiries` : `/games/${gameId}/inquiries?status=${filter.value}`}
            className={filter.value === activeStatus ? "font-bold text-accent" : "text-white/60"}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {inquiries.length === 0 ? (
        <p>접수된 문의가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inquiries.map((inquiry) => (
            <li key={inquiry.id} className="border border-white/10 rounded p-4">
              <Link href={`/inquiries/${inquiry.id}`} className="flex items-center justify-between">
                <span>{inquiry.title}</span>
                <span className="text-sm text-white/60">{STATUS_LABEL[inquiry.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/InquiryList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement app/games/[gameId]/inquiries/page.tsx**

```tsx
import { getSupabaseServerClient } from "@/lib/supabase";
import { listInquiriesByGame, type InquiryStatus } from "@/lib/inquiries";
import InquiryList from "@/components/inquiries/InquiryList";

const VALID_STATUSES: InquiryStatus[] = ["new", "in_progress", "resolved"];

export default async function GameInquiriesPage({
  params,
  searchParams,
}: {
  params: { gameId: string };
  searchParams: { status?: string };
}) {
  const status = VALID_STATUSES.includes(searchParams.status as InquiryStatus)
    ? (searchParams.status as InquiryStatus)
    : undefined;

  const supabase = getSupabaseServerClient();
  const inquiries = await listInquiriesByGame(supabase, params.gameId, status);

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold mb-6">문의 목록</h1>
      <InquiryList inquiries={inquiries} activeStatus={status ?? "all"} gameId={params.gameId} />
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/inquiries/InquiryList.tsx app/games/\[gameId\]/inquiries/page.tsx tests/components/InquiryList.test.tsx
git commit -m "feat: add per-game inquiry list with status filters"
```

---

## Task 11: Account History Lib

**Files:**
- Create: `lib/account-history.ts`
- Test: `tests/lib/account-history.test.ts`

**Interfaces:**
- Consumes: nothing beyond a `SupabaseClient` instance
- Produces: `AccountHistoryEntry { id, title, status: InquiryStatus, groupKey, typeKey, createdAt }`, `getAccountHistory(supabase, gameId: string, gameAccount: string | null, excludeInquiryId: string): Promise<AccountHistoryEntry[]>`. Used by Task 12.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/account-history.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { getAccountHistory } from "@/lib/account-history";

describe("getAccountHistory", () => {
  it("returns an empty array without querying when game_account is empty", async () => {
    const from = vi.fn();
    const result = await getAccountHistory({ from } as never, "game-1", "", "inq-1");
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns an empty array without querying when game_account is null", async () => {
    const from = vi.fn();
    const result = await getAccountHistory({ from } as never, "game-1", null, "inq-1");
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("filters by game_id, game_account, and excludes the current inquiry", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: "inq-2",
          title: "이전 문의",
          status: "resolved",
          group_key: "game_usage",
          type_key: "account_login",
          created_at: "2025-06-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const neq = vi.fn(() => ({ order }));
    const eqAccount = vi.fn(() => ({ neq }));
    const eqGame = vi.fn(() => ({ eq: eqAccount }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    const result = await getAccountHistory({ from } as never, "game-1", "player1", "inq-1");

    expect(eqGame).toHaveBeenCalledWith("game_id", "game-1");
    expect(eqAccount).toHaveBeenCalledWith("game_account", "player1");
    expect(neq).toHaveBeenCalledWith("id", "inq-1");
    expect(result).toEqual([
      {
        id: "inq-2",
        title: "이전 문의",
        status: "resolved",
        groupKey: "game_usage",
        typeKey: "account_login",
        createdAt: "2025-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("throws when the query errors", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const neq = vi.fn(() => ({ order }));
    const eqAccount = vi.fn(() => ({ neq }));
    const eqGame = vi.fn(() => ({ eq: eqAccount }));
    const select = vi.fn(() => ({ eq: eqGame }));
    const from = vi.fn(() => ({ select }));

    await expect(getAccountHistory({ from } as never, "game-1", "player1", "inq-1")).rejects.toThrow(/db error/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/account-history.test.ts`
Expected: FAIL — `@/lib/account-history` does not exist.

- [ ] **Step 3: Implement lib/account-history.ts**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InquiryStatus } from "@/lib/inquiries";

export interface AccountHistoryEntry {
  id: string;
  title: string;
  status: InquiryStatus;
  groupKey: string;
  typeKey: string;
  createdAt: string;
}

export async function getAccountHistory(
  supabase: SupabaseClient,
  gameId: string,
  gameAccount: string | null,
  excludeInquiryId: string
): Promise<AccountHistoryEntry[]> {
  if (!gameAccount || !gameAccount.trim()) {
    return [];
  }

  const { data, error } = await supabase
    .from("inquiries")
    .select("id, title, status, group_key, type_key, created_at")
    .eq("game_id", gameId)
    .eq("game_account", gameAccount)
    .neq("id", excludeInquiryId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load account history: ${error.message}`);
  }

  return (data ?? []).map((row: { id: string; title: string; status: string; group_key: string; type_key: string; created_at: string }) => ({
    id: row.id,
    title: row.title,
    status: row.status as InquiryStatus,
    groupKey: row.group_key,
    typeKey: row.type_key,
    createdAt: row.created_at,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/account-history.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/account-history.ts tests/lib/account-history.test.ts
git commit -m "feat: add account history query helper (same game_id + game_account)"
```

---

## Task 12: AccountHistoryPanel Component

**Files:**
- Create: `components/inquiries/AccountHistoryPanel.tsx`
- Test: `tests/components/AccountHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `AccountHistoryEntry` (Task 11)
- Produces: `<AccountHistoryPanel history={AccountHistoryEntry[]} gameAccount={string | null} />`. Used by Task 16.

- [ ] **Step 1: Write the failing test**

Create `tests/components/AccountHistoryPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";
import type { AccountHistoryEntry } from "@/lib/account-history";

describe("AccountHistoryPanel", () => {
  it("shows a message when there is no game account on this inquiry", () => {
    render(<AccountHistoryPanel history={[]} gameAccount={null} />);
    expect(screen.getByText("게임 계정 정보가 없어 이력을 조회할 수 없습니다.")).toBeInTheDocument();
  });

  it("shows an empty-history message when the account has no past inquiries", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" />);
    expect(screen.getByText("이전 문의 이력이 없습니다.")).toBeInTheDocument();
  });

  it("lists past inquiries for the account", () => {
    const history: AccountHistoryEntry[] = [
      { id: "inq-2", title: "이전 문의", status: "resolved", groupKey: "game_usage", typeKey: "account_login", createdAt: "2025-06-01T00:00:00.000Z" },
    ];
    render(<AccountHistoryPanel history={history} gameAccount="player1" />);
    expect(screen.getByText("이전 문의")).toBeInTheDocument();
  });

  it("always shows the event-participation extension placeholder", () => {
    render(<AccountHistoryPanel history={[]} gameAccount="player1" />);
    expect(screen.getByText("이벤트 참여 이력 (준비 중)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AccountHistoryPanel.test.tsx`
Expected: FAIL — `@/components/inquiries/AccountHistoryPanel` does not exist.

- [ ] **Step 3: Implement components/inquiries/AccountHistoryPanel.tsx**

```tsx
import type { AccountHistoryEntry } from "@/lib/account-history";

const STATUS_LABEL: Record<AccountHistoryEntry["status"], string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료",
};

export default function AccountHistoryPanel({
  history,
  gameAccount,
}: {
  history: AccountHistoryEntry[];
  gameAccount: string | null;
}) {
  return (
    <aside className="border border-white/10 rounded p-4 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold mb-2">계정 이력</h2>
        {!gameAccount ? (
          <p className="text-sm text-white/60">게임 계정 정보가 없어 이력을 조회할 수 없습니다.</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-white/60">이전 문의 이력이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li key={entry.id} className="text-sm">
                <span>{entry.title}</span>
                <span className="text-white/60"> · {STATUS_LABEL[entry.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        {/* Extension point: once an event_participants table exists, join it
            here on game_id + game_account, the same matching rule as above. */}
        <h2 className="font-semibold mb-2">이벤트 참여 이력 (준비 중)</h2>
        <p className="text-sm text-white/60">아직 연동된 이벤트 데이터가 없습니다.</p>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AccountHistoryPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/inquiries/AccountHistoryPanel.tsx tests/components/AccountHistoryPanel.test.tsx
git commit -m "feat: add account history panel with event-history extension point"
```

---

## Task 13: Status Update API Route + StatusSelect Component

**Files:**
- Create: `app/api/inquiries/[id]/status/route.ts`
- Create: `components/inquiries/StatusSelect.tsx`
- Test: `tests/api/inquiry-status.test.ts`
- Test: `tests/components/StatusSelect.test.tsx`

**Interfaces:**
- Consumes: `getSupabaseServerClient` (Task 2)
- Produces: `PATCH(request, { params: { id } }): Promise<Response>` at `app/api/inquiries/[id]/status/route.ts`, responding `{ success: true }` (200) or `{ success: false, error }` (400/500); `<StatusSelect inquiryId={string} currentStatus={InquiryStatus} />`. Used by Task 16.

- [ ] **Step 1: Write the failing API test**

Create `tests/api/inquiry-status.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/inquiries/[id]/status/route";
import * as supabaseModule from "@/lib/supabase";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

describe("PATCH /api/inquiries/[id]/status", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
  });

  it("updates the status and returns success", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    const json = await response.json();

    expect(update).toHaveBeenCalledWith({ status: "in_progress" });
    expect(eq).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("rejects an invalid status value", async () => {
    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "bogus" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
  });

  it("returns 500 when the update fails", async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);

    const request = new Request("http://localhost/api/inquiries/inq-1/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "resolved" }),
    });
    const response = await PATCH(request, { params: { id: "inq-1" } });
    expect(response.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/inquiry-status.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement app/api/inquiries/[id]/status/route.ts**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";

const statusSchema = z.object({ status: z.enum(["new", "in_progress", "resolved"]) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_status" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("inquiries").update({ status: parsed.data.status }).eq("id", params.id);

  if (error) {
    return NextResponse.json({ success: false, error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/inquiry-status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing component test**

Create `tests/components/StatusSelect.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatusSelect from "@/components/inquiries/StatusSelect";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("StatusSelect", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
  });

  it("sends a PATCH request and refreshes on change", async () => {
    render(<StatusSelect inquiryId="inq-1" currentStatus="new" />);
    await userEvent.selectOptions(screen.getByLabelText("상태"), "완료");

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" }),
      })
    );
    expect(refreshMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/StatusSelect.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 7: Implement components/inquiries/StatusSelect.tsx**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InquiryStatus } from "@/lib/inquiries";

const OPTIONS: Array<{ value: InquiryStatus; label: string }> = [
  { value: "new", label: "접수" },
  { value: "in_progress", label: "처리중" },
  { value: "resolved", label: "완료" },
];

export default function StatusSelect({
  inquiryId,
  currentStatus,
}: {
  inquiryId: string;
  currentStatus: InquiryStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: InquiryStatus) {
    const previous = status;
    setStatus(next);
    setError(null);

    const response = await fetch(`/api/inquiries/${inquiryId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    const json = await response.json();

    if (!json.success) {
      setStatus(previous);
      setError("상태 변경에 실패했습니다.");
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <label className="flex items-center gap-2">
        <span>상태</span>
        <select
          value={status}
          onChange={(e) => handleChange(e.target.value as InquiryStatus)}
          className="bg-black border border-white/20 rounded px-2 py-1"
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/components/StatusSelect.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add app/api/inquiries/\[id\]/status components/inquiries/StatusSelect.tsx tests/api/inquiry-status.test.ts tests/components/StatusSelect.test.tsx
git commit -m "feat: add inquiry status update API route and selector"
```

---

## Task 14: Gmail Client

**Files:**
- Create: `lib/gmail.ts`
- Test: `tests/lib/gmail.test.ts`

**Interfaces:**
- Consumes: `process.env.GMAIL_CLIENT_ID`, `process.env.GMAIL_CLIENT_SECRET`, `process.env.GMAIL_REFRESH_TOKEN`, `process.env.GMAIL_SENDER`
- Produces: `sendReplyEmail(input: { to: string; subject: string; body: string }): Promise<void>` (throws on missing env vars or a send failure). Used by Task 15.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/gmail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
const setCredentialsMock = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: setCredentialsMock })),
    },
    gmail: vi.fn(() => ({ users: { messages: { send: sendMock } } })),
  },
}));

describe("sendReplyEmail", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset().mockResolvedValue({});
    setCredentialsMock.mockReset();
    process.env.GMAIL_CLIENT_ID = "client-id";
    process.env.GMAIL_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_REFRESH_TOKEN = "refresh-token";
    process.env.GMAIL_SENDER = "info@theplayplus.com";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when Gmail environment variables are missing", async () => {
    delete process.env.GMAIL_REFRESH_TOKEN;
    const { sendReplyEmail } = await import("@/lib/gmail");
    await expect(sendReplyEmail({ to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow(/GMAIL_REFRESH_TOKEN/);
  });

  it("sends a base64url-encoded RFC 2822 message via the Gmail API", async () => {
    const { sendReplyEmail } = await import("@/lib/gmail");
    await sendReplyEmail({ to: "user@example.com", subject: "답변입니다", body: "본문 내용" });

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const call = sendMock.mock.calls[0][0];
    expect(call.userId).toBe("me");

    const decoded = Buffer.from(
      call.requestBody.raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf-8");
    expect(decoded).toContain("From: info@theplayplus.com");
    expect(decoded).toContain("To: user@example.com");
    expect(decoded).toContain("본문 내용");
  });

  it("propagates an error when the Gmail API call fails", async () => {
    sendMock.mockRejectedValue(new Error("gmail down"));
    const { sendReplyEmail } = await import("@/lib/gmail");
    await expect(sendReplyEmail({ to: "a@b.com", subject: "s", body: "b" })).rejects.toThrow("gmail down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/gmail.test.ts`
Expected: FAIL — `@/lib/gmail` does not exist.

- [ ] **Step 3: Implement lib/gmail.ts**

```ts
import { google } from "googleapis";

export interface SendReplyEmailInput {
  to: string;
  subject: string;
  body: string;
}

function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const sender = process.env.GMAIL_SENDER;

  if (!clientId || !clientSecret || !refreshToken || !sender) {
    throw new Error(
      "Missing one of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER environment variables"
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return { gmail: google.gmail({ version: "v1", auth: oauth2Client }), sender };
}

function encodeRfc2822Message(sender: string, to: string, subject: string, body: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const message = [
    `From: ${sender}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");

  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendReplyEmail(input: SendReplyEmailInput): Promise<void> {
  const { gmail, sender } = getGmailClient();
  const raw = encodeRfc2822Message(sender, input.to, input.subject, input.body);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/gmail.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/gmail.ts tests/lib/gmail.test.ts
git commit -m "feat: add Gmail API client for sending inquiry replies"
```

---

## Task 15: Reply API Route

**Files:**
- Create: `app/api/inquiries/[id]/reply/route.ts`
- Test: `tests/api/inquiry-reply.test.ts`

**Interfaces:**
- Consumes: `getSupabaseServerClient` (Task 2); `sendReplyEmail` (Task 14)
- Produces: `POST(request, { params: { id } }): Promise<Response>` at `app/api/inquiries/[id]/reply/route.ts`, called with JSON `{ replyContent: string }`. Responds `{ success: true }` (200) or `{ success: false, error }` (400/404/500). On success, sets `status = 'resolved'`, `reply_content`, `replied_at`. Used by Task 16.

- [ ] **Step 1: Write the failing test**

Create `tests/api/inquiry-reply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/inquiries/[id]/reply/route";
import * as supabaseModule from "@/lib/supabase";
import * as gmailModule from "@/lib/gmail";

vi.mock("@/lib/supabase", () => ({
  getSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/gmail", () => ({
  sendReplyEmail: vi.fn(),
}));

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/inquiries/inq-1/reply", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/inquiries/[id]/reply", () => {
  beforeEach(() => {
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReset();
    vi.mocked(gmailModule.sendReplyEmail).mockReset();
  });

  function mockFetchInquiry(inquiry: { id: string; reply_email: string; title: string } | null, error: { message: string } | null = null) {
    const single = vi.fn().mockResolvedValue({ data: inquiry, error });
    const eqSelect = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq: eqSelect }));
    const eqUpdate = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq: eqUpdate }));
    const from = vi.fn(() => ({ select, update }));
    vi.mocked(supabaseModule.getSupabaseServerClient).mockReturnValue({ from } as never);
    return { update, eqUpdate };
  }

  it("sends the email and marks the inquiry resolved on success", async () => {
    const { update, eqUpdate } = mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    vi.mocked(gmailModule.sendReplyEmail).mockResolvedValue(undefined);

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });
    const json = await response.json();

    expect(gmailModule.sendReplyEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Re: 제목",
      body: "답변 내용입니다",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "resolved", reply_content: "답변 내용입니다" })
    );
    expect(eqUpdate).toHaveBeenCalledWith("id", "inq-1");
    expect(json).toEqual({ success: true });
  });

  it("rejects an empty reply", async () => {
    mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    const response = await POST(jsonRequest({ replyContent: "" }), { params: { id: "inq-1" } });
    expect(response.status).toBe(400);
    expect(gmailModule.sendReplyEmail).not.toHaveBeenCalled();
  });

  it("returns 404 when the inquiry does not exist", async () => {
    mockFetchInquiry(null, { message: "not found" });
    const response = await POST(jsonRequest({ replyContent: "답변" }), { params: { id: "missing" } });
    expect(response.status).toBe(404);
  });

  it("returns 500 and does not update status when the email send fails", async () => {
    const { update } = mockFetchInquiry({ id: "inq-1", reply_email: "user@example.com", title: "제목" });
    vi.mocked(gmailModule.sendReplyEmail).mockRejectedValue(new Error("gmail down"));

    const response = await POST(jsonRequest({ replyContent: "답변 내용입니다" }), { params: { id: "inq-1" } });

    expect(response.status).toBe(500);
    expect(update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/inquiry-reply.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement app/api/inquiries/[id]/reply/route.ts**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { sendReplyEmail } from "@/lib/gmail";

const replySchema = z.object({ replyContent: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_reply" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: inquiry, error: fetchError } = await supabase
    .from("inquiries")
    .select("id, reply_email, title")
    .eq("id", params.id)
    .single();

  if (fetchError || !inquiry) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }

  try {
    await sendReplyEmail({
      to: inquiry.reply_email,
      subject: `Re: ${inquiry.title}`,
      body: parsed.data.replyContent,
    });
  } catch {
    return NextResponse.json({ success: false, error: "send_failed" }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("inquiries")
    .update({
      status: "resolved",
      reply_content: parsed.data.replyContent,
      replied_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (updateError) {
    return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/inquiry-reply.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/inquiries/\[id\]/reply tests/api/inquiry-reply.test.ts
git commit -m "feat: add reply API route sending via Gmail and resolving the inquiry"
```

---

## Task 16: InquiryDetail + ReplyForm Components + Inquiry Detail Page

**Files:**
- Create: `components/inquiries/InquiryDetail.tsx`
- Create: `components/inquiries/ReplyForm.tsx`
- Create: `app/inquiries/[id]/page.tsx`
- Test: `tests/components/InquiryDetail.test.tsx`
- Test: `tests/components/ReplyForm.test.tsx`

**Interfaces:**
- Consumes: `InquiryRow`, `AttachmentWithUrl` (Task 9); `getInquiryById`, `listAttachmentSignedUrls` (Task 9); `getAccountHistory` (Task 11); `AccountHistoryPanel` (Task 12); `StatusSelect` (Task 13); `getSupabaseServerClient` (Task 2)
- Produces: `<InquiryDetail inquiry={InquiryRow} attachments={AttachmentWithUrl[]} />`, `<ReplyForm inquiryId={string} />`, the `/inquiries/[id]` route composing all of the above.

- [ ] **Step 1: Write the failing InquiryDetail test**

Create `tests/components/InquiryDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import type { InquiryRow } from "@/lib/inquiries";

describe("InquiryDetail", () => {
  const inquiry: InquiryRow = {
    id: "inq-1",
    gameId: "game-1",
    groupKey: "game_usage",
    typeKey: "bug_report",
    gameAccount: "player1",
    companyName: null,
    replyEmail: "user@example.com",
    title: "버그 제보",
    content: "화면이 멈춰요",
    status: "new",
    replyContent: null,
    repliedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("renders the inquiry content and reply email", () => {
    render(<InquiryDetail inquiry={inquiry} attachments={[]} />);
    expect(screen.getByText("버그 제보")).toBeInTheDocument();
    expect(screen.getByText("화면이 멈춰요")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
  });

  it("renders a link per attachment", () => {
    render(
      <InquiryDetail
        inquiry={inquiry}
        attachments={[{ id: "att-1", fileName: "screenshot.png", signedUrl: "https://signed.example/x" }]}
      />
    );
    const link = screen.getByRole("link", { name: "screenshot.png" });
    expect(link.getAttribute("href")).toBe("https://signed.example/x");
  });

  it("shows the previous reply when the inquiry is already resolved", () => {
    render(
      <InquiryDetail
        inquiry={{ ...inquiry, status: "resolved", replyContent: "확인 후 조치했습니다", repliedAt: "2026-01-02T00:00:00.000Z" }}
        attachments={[]}
      />
    );
    expect(screen.getByText("확인 후 조치했습니다")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/InquiryDetail.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement components/inquiries/InquiryDetail.tsx**

```tsx
import type { InquiryRow, AttachmentWithUrl } from "@/lib/inquiries";

export default function InquiryDetail({
  inquiry,
  attachments,
}: {
  inquiry: InquiryRow;
  attachments: AttachmentWithUrl[];
}) {
  return (
    <article className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold">{inquiry.title}</h1>
        <p className="text-sm text-white/60">
          {inquiry.groupKey} · {inquiry.typeKey} · {new Date(inquiry.createdAt).toLocaleString("ko-KR")}
        </p>
      </header>

      <dl className="text-sm flex flex-col gap-1">
        {inquiry.gameAccount && (
          <div>
            <dt className="inline text-white/60">게임 계정: </dt>
            <dd className="inline">{inquiry.gameAccount}</dd>
          </div>
        )}
        {inquiry.companyName && (
          <div>
            <dt className="inline text-white/60">회사명: </dt>
            <dd className="inline">{inquiry.companyName}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-white/60">회신 이메일: </dt>
          <dd className="inline">{inquiry.replyEmail}</dd>
        </div>
      </dl>

      <p className="whitespace-pre-wrap">{inquiry.content}</p>

      {attachments.length > 0 && (
        <div>
          <h2 className="font-semibold mb-2">첨부파일</h2>
          <ul className="flex flex-col gap-1">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.signedUrl ? (
                  <a href={attachment.signedUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {attachment.fileName}
                  </a>
                ) : (
                  <span>{attachment.fileName} (링크 생성 실패)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inquiry.replyContent && (
        <div className="border border-white/10 rounded p-4">
          <h2 className="font-semibold mb-2">
            보낸 답변 {inquiry.repliedAt && `(${new Date(inquiry.repliedAt).toLocaleString("ko-KR")})`}
          </h2>
          <p className="whitespace-pre-wrap">{inquiry.replyContent}</p>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/InquiryDetail.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing ReplyForm test**

Create `tests/components/ReplyForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReplyForm from "@/components/inquiries/ReplyForm";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

describe("ReplyForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
  });

  it("sends the reply and refreshes on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: true }) }) as never;
    render(<ReplyForm inquiryId="inq-1" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    await userEvent.click(screen.getByRole("button", { name: "답변 발송" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/inquiries/inq-1/reply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ replyContent: "확인 후 조치하겠습니다" }),
      })
    );
    expect(await screen.findByText("답변이 발송되었습니다.")).toBeInTheDocument();
  });

  it("keeps the typed content and shows an error when sending fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({ json: () => Promise.resolve({ success: false, error: "send_failed" }) }) as never;
    render(<ReplyForm inquiryId="inq-1" />);

    await userEvent.type(screen.getByLabelText("답변 내용"), "확인 후 조치하겠습니다");
    await userEvent.click(screen.getByRole("button", { name: "답변 발송" }));

    expect(await screen.findByText("발송 실패, 다시 시도해주세요.")).toBeInTheDocument();
    expect(screen.getByLabelText("답변 내용")).toHaveValue("확인 후 조치하겠습니다");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/components/ReplyForm.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 7: Implement components/inquiries/ReplyForm.tsx**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ReplyForm({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [replyContent, setReplyContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch(`/api/inquiries/${inquiryId}/reply`, {
      method: "POST",
      body: JSON.stringify({ replyContent }),
    });
    const json = await response.json();
    setSubmitting(false);

    if (!json.success) {
      setMessage("발송 실패, 다시 시도해주세요.");
      return;
    }

    setMessage("답변이 발송되었습니다.");
    setReplyContent("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span>답변 내용</span>
        <textarea
          value={replyContent}
          onChange={(e) => setReplyContent(e.target.value)}
          required
          rows={6}
          className="bg-black border border-white/20 rounded px-3 py-2"
        />
      </label>
      {message && <p className="text-sm">{message}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="bg-accent text-white rounded px-4 py-2 disabled:opacity-50 self-start"
      >
        답변 발송
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/components/ReplyForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Implement app/inquiries/[id]/page.tsx**

```tsx
import { notFound } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getInquiryById, listAttachmentSignedUrls } from "@/lib/inquiries";
import { getAccountHistory } from "@/lib/account-history";
import InquiryDetail from "@/components/inquiries/InquiryDetail";
import StatusSelect from "@/components/inquiries/StatusSelect";
import ReplyForm from "@/components/inquiries/ReplyForm";
import AccountHistoryPanel from "@/components/inquiries/AccountHistoryPanel";

export default async function InquiryDetailPage({ params }: { params: { id: string } }) {
  const supabase = getSupabaseServerClient();
  const inquiry = await getInquiryById(supabase, params.id);

  if (!inquiry) {
    notFound();
  }

  const [attachments, history] = await Promise.all([
    listAttachmentSignedUrls(supabase, inquiry.id),
    getAccountHistory(supabase, inquiry.gameId, inquiry.gameAccount, inquiry.id),
  ]);

  return (
    <main className="p-8 grid grid-cols-[2fr_1fr] gap-8">
      <div className="flex flex-col gap-6">
        <InquiryDetail inquiry={inquiry} attachments={attachments} />
        <StatusSelect inquiryId={inquiry.id} currentStatus={inquiry.status} />
        <ReplyForm inquiryId={inquiry.id} />
      </div>
      <AccountHistoryPanel history={history} gameAccount={inquiry.gameAccount} />
    </main>
  );
}
```

- [ ] **Step 10: Verify the project builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add components/inquiries/InquiryDetail.tsx components/inquiries/ReplyForm.tsx app/inquiries tests/components/InquiryDetail.test.tsx tests/components/ReplyForm.test.tsx
git commit -m "feat: add inquiry detail page wiring status, reply, and account history"
```

- [ ] **Step 12: Manual end-to-end check**

Against a real Supabase project with `supabase/migrations/0001_admin_schema.sql` applied and `.env` populated (including a real Gmail OAuth refresh token for `info@theplayplus.com`):

1. Run `npm run dev`, sign in at `/login` with an admin account created in the Supabase Auth dashboard.
2. Add a game on `/games`; confirm it appears with default categories seeded (verify in the Supabase table editor).
3. Manually insert a test row into `inquiries` for that `game_id` (until `theplayplus-contact`'s game-selection step is implemented, this is the only way to get data in).
4. Open `/games/<gameId>/inquiries`, confirm the row appears and status filters work.
5. Open the inquiry detail page, change its status, send a reply, and confirm the email arrives and the inquiry flips to `완료` with the reply text saved.
6. Insert a second inquiry with the same `game_id` + `game_account` and confirm it shows up in the account history panel of the first.
