import type { InquiryStatus } from "@/lib/inquiries";

/**
 * 미처리 경과 시간의 온도. 목록 왼쪽 띠·대화 머리의 경과 표시가 같은 눈금을 쓴다.
 * stale 경계(72시간)는 "3일 이상 미처리" 보기와 같아야 한다.
 */
export type HeatLevel = "fresh" | "warm" | "hot" | "stale" | "done";

const HOUR = 3_600_000;

export const HEAT_LABELS: Record<HeatLevel, string> = {
  fresh: "4시간 미만",
  warm: "하루 미만",
  hot: "3일 미만",
  stale: "3일 이상",
  done: "완료",
};

/** 띠·점 배경. tailwind가 클래스 이름을 찾을 수 있게 통째로 적는다. */
export const HEAT_BG: Record<HeatLevel, string> = {
  fresh: "bg-heat-fresh",
  warm: "bg-heat-warm",
  hot: "bg-heat-hot",
  stale: "bg-heat-stale",
  done: "bg-line",
};

export const HEAT_TEXT: Record<HeatLevel, string> = {
  fresh: "text-heat-fresh",
  warm: "text-heat-warm",
  hot: "text-heat-hot",
  stale: "text-heat-stale",
  done: "text-muted",
};

export function heatLevel(createdAt: string, status: InquiryStatus, now: Date = new Date()): HeatLevel {
  if (status === "resolved") return "done";
  const hours = (now.getTime() - new Date(createdAt).getTime()) / HOUR;
  if (hours < 4) return "fresh";
  if (hours < 24) return "warm";
  if (hours < 72) return "hot";
  return "stale";
}
