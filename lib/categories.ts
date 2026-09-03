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

export async function listGames(supabase: SupabaseClient): Promise<GameRow[]> {
  const { data, error } = await supabase.from("games").select("*").order("created_at", { ascending: false });
  if (error) {
    throw new Error(`Failed to list games: ${error.message}`);
  }
  return (data ?? []).map(mapGameRow);
}
