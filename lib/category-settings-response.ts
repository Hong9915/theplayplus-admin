import { NextResponse } from "next/server";
import type { z } from "zod";
import { invalidFields, mutationStatus, type MutationResult } from "@/lib/category-settings";

/** 문의 유형 설정 라우트들이 공유하는 응답 모양. */
export function unauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export function invalidInput(error?: z.ZodError) {
  return NextResponse.json({ success: false, error: "invalid_input", fields: error ? invalidFields(error) : [] }, { status: 400 });
}

export function fromResult(result: MutationResult) {
  if (result.ok) return NextResponse.json({ success: true });
  return NextResponse.json(
    { success: false, error: result.error, ...(result.message ? { message: result.message } : {}) },
    { status: mutationStatus(result.error) }
  );
}

/** 목록을 못 읽는 등 예상 밖 실패. */
export function failed() {
  return NextResponse.json({ success: false, error: "save_failed" }, { status: 500 });
}
