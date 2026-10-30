import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase";
import { getAdminSession } from "@/lib/require-admin-session";
import { DEV_REPORT_MAX_INQUIRIES, buildDevReportWorkbook, loadDevReportInquiries } from "@/lib/dev-report";

export const maxDuration = 60;

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(DEV_REPORT_MAX_INQUIRIES),
});

/** 목록에서 고른 문의를 개발사 전달 양식의 엑셀로 내려준다. */
export async function POST(request: Request) {
  const actor = await getAdminSession();
  if (!actor) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  }

  let workbook: Buffer;
  try {
    const inquiries = await loadDevReportInquiries(getSupabaseServerClient(), parsed.data.ids);
    workbook = await buildDevReportWorkbook(inquiries);
  } catch {
    return NextResponse.json({ success: false, error: "export_failed" }, { status: 500 });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).replaceAll("-", "");
  const fileName = `개발사전달_${today}.xlsx`;
  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dev-report-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
