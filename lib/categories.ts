import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxScope } from "@/lib/inbox-scope";

export interface GameRow {
  id: string;
  name: string;
  status: "active" | "ended";
  logoPath: string | null;
  ownerName: string | null;
  createdAt: string;
}

export type InquiryTypePriority = "urgent" | "high" | "normal" | "low";

export interface DefaultCategoryType {
  key: string;
  labelKo: string;
  labelZh: string;
  labelEn: string;
  requiresGameAccount: boolean;
  requiresCompanyName: boolean;
  allowAttachments: boolean;
  requiresAttachments: boolean;
  collectsPaymentNo: boolean;
  collectsOccurredAt: boolean;
  collectsDeviceInfo: boolean;
  /** 스토어 종류(Google Play / App Store / 원스토어 / 기타)를 필수로 받는다. 게임 유형 전부(2026-09-14). */
  collectsStore: boolean;
  /** 접수 시 트리거(마이그레이션 0009)가 이 값을 문의 우선순위로 넣는다. */
  defaultPriority: InquiryTypePriority;
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

/** 게임 유형 공통 플래그. 모든 유형이 게임 계정과 스토어 종류를 받고 첨부를 허용한다. */
const GAME_TYPE = {
  requiresGameAccount: true,
  requiresCompanyName: false,
  allowAttachments: true,
  requiresAttachments: false,
  collectsPaymentNo: false,
  collectsOccurredAt: false,
  collectsDeviceInfo: false,
  collectsStore: true,
  defaultPriority: "normal" as InquiryTypePriority,
};

/**
 * 새 게임에 복사되는 문의 종류·유형 시드. 여신 키우기에서 운영하며 다듬은
 * 구성을 그대로 쓴다. 유형 키는 lib/default-templates.ts의 자동 답변 템플릿과
 * 짝을 이루므로 바꾸면 그쪽도 함께 바꿔야 한다.
 */
export const DEFAULT_CATEGORY_TEMPLATE: DefaultCategoryGroup[] = [
  {
    key: "account_security",
    labelKo: "계정/보안",
    labelZh: "账号/安全",
    labelEn: "Account/Security",
    sortOrder: 0,
    types: [
      { ...GAME_TYPE, key: "account_inquiry", labelKo: "계정 문의", labelZh: "账号咨询", labelEn: "Account Inquiry", sortOrder: 0 },
      { ...GAME_TYPE, key: "account_restriction", labelKo: "계정이용제한", labelZh: "账号使用限制", labelEn: "Account Restriction", sortOrder: 1 },
    ],
  },
  {
    key: "game_usage",
    labelKo: "게임 이용",
    labelZh: "游戏使用",
    labelEn: "Game Usage",
    sortOrder: 1,
    types: [
      { ...GAME_TYPE, key: "suggestion", labelKo: "건의 사항", labelZh: "建议事项", labelEn: "Suggestion", defaultPriority: "low", sortOrder: 0 },
      { ...GAME_TYPE, key: "game_content", labelKo: "게임 내용", labelZh: "游戏内容", labelEn: "Game Content", sortOrder: 1 },
      { ...GAME_TYPE, key: "bug_report", labelKo: "버그 제보(기타)", labelZh: "错误反馈(其他)", labelEn: "Bug Report (Other)", sortOrder: 2 },
      { ...GAME_TYPE, key: "restore_request", labelKo: "복구 문의", labelZh: "恢复咨询", labelEn: "Restore Request", defaultPriority: "urgent", sortOrder: 3 },
      {
        ...GAME_TYPE,
        key: "install_connect",
        labelKo: "설치/접속/실행",
        labelZh: "安装/连接/运行",
        labelEn: "Install/Connect/Launch",
        requiresAttachments: true,
        collectsDeviceInfo: true,
        sortOrder: 4,
      },
      { ...GAME_TYPE, key: "event_inquiry", labelKo: "이벤트 문의", labelZh: "活动咨询", labelEn: "Event Inquiry", sortOrder: 5 },
    ],
  },
  {
    key: "payment_refund",
    labelKo: "결제/환불",
    labelZh: "支付/退款",
    labelEn: "Payment/Refund",
    sortOrder: 2,
    types: [
      { ...GAME_TYPE, key: "payment", labelKo: "결제", labelZh: "支付", labelEn: "Payment", collectsOccurredAt: true, defaultPriority: "urgent", sortOrder: 0 },
      {
        ...GAME_TYPE,
        key: "refund",
        labelKo: "환불",
        labelZh: "退款",
        labelEn: "Refund",
        collectsPaymentNo: true,
        collectsOccurredAt: true,
        defaultPriority: "urgent",
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
      requires_attachments: type.requiresAttachments,
      collects_payment_no: type.collectsPaymentNo,
      collects_occurred_at: type.collectsOccurredAt,
      collects_device_info: type.collectsDeviceInfo,
      collects_store: type.collectsStore,
      default_priority: type.defaultPriority,
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

export interface CategoryLabelMaps {
  groupLabels: Record<string, string>;
  typeLabels: Record<string, string>;
  /** 그룹 sort_order → 유형 sort_order 순의 유형 key. 문의함 보기 열이 이 순서로 나열한다. */
  typeOrder: string[];
}

export async function listCategoryLabels(supabase: SupabaseClient, gameId: string): Promise<CategoryLabelMaps> {
  const groupLabels: Record<string, string> = {};
  const typeLabels: Record<string, string> = {};
  const typeOrder: string[] = [];

  const { data: groups, error: groupsError } = await supabase
    .from("inquiry_groups")
    .select("id, key, label_ko")
    .eq("game_id", gameId)
    .order("sort_order", { ascending: true });

  if (groupsError || !groups || groups.length === 0) {
    return { groupLabels, typeLabels, typeOrder };
  }

  for (const group of groups) {
    groupLabels[group.key] = group.label_ko;
  }

  const { data: types, error: typesError } = await supabase
    .from("inquiry_types")
    .select("key, label_ko, group_id")
    .in(
      "group_id",
      groups.map((group) => group.id)
    )
    .order("sort_order", { ascending: true });

  if (!typesError && types) {
    for (const type of types) {
      typeLabels[type.key] = type.label_ko;
    }
    for (const group of groups) {
      for (const type of types) {
        if (type.group_id === group.id) typeOrder.push(type.key);
      }
    }
  }

  return { groupLabels, typeLabels, typeOrder };
}

/**
 * 서비스 문의(제휴·기타)의 전역 카테고리 라벨. 접수 폼 저장소가 만든
 * service_groups/service_types(마이그레이션 0013 사본)에서 읽는다. 게임과 무관하게
 * 하나뿐이라 game_id 조건이 없다. 실패하면 빈 맵 — 라벨은 부가 정보다.
 */
export async function listServiceCategoryLabels(supabase: SupabaseClient): Promise<CategoryLabelMaps> {
  const groupLabels: Record<string, string> = {};
  const typeLabels: Record<string, string> = {};
  const typeOrder: string[] = [];

  const { data: groups, error: groupsError } = await supabase
    .from("service_groups")
    .select("id, key, label_ko")
    .order("sort_order", { ascending: true });

  if (groupsError || !groups || groups.length === 0) {
    return { groupLabels, typeLabels, typeOrder };
  }

  for (const group of groups) {
    groupLabels[group.key] = group.label_ko;
  }

  const { data: types, error: typesError } = await supabase
    .from("service_types")
    .select("key, label_ko, group_id")
    .in(
      "group_id",
      groups.map((group) => group.id)
    )
    .order("sort_order", { ascending: true });

  if (!typesError && types) {
    for (const type of types) {
      typeLabels[type.key] = type.label_ko;
    }
    for (const group of groups) {
      for (const type of types) {
        if (type.group_id === group.id) typeOrder.push(type.key);
      }
    }
  }

  return { groupLabels, typeLabels, typeOrder };
}

/** 스코프에 맞는 라벨. 게임이면 그 게임의 카테고리, 서비스면 전역 서비스 카테고리. */
export async function listCategoryLabelsForScope(supabase: SupabaseClient, scope: InboxScope): Promise<CategoryLabelMaps> {
  return scope.kind === "game" ? listCategoryLabels(supabase, scope.gameId) : listServiceCategoryLabels(supabase);
}

export async function listGames(supabase: SupabaseClient): Promise<GameRow[]> {
  const { data, error } = await supabase.from("games").select("*").order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list games: ${error.message}`);
  }
  return (data ?? []).map(mapGameRow);
}
