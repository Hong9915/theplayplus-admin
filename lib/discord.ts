/**
 * Discord Webhook 전송. Slack 알림(lib/slack.ts)과 같은 때에 같은 내용을 Discord 채널로도 보낸다.
 *
 * Slack의 attachment 세로줄 대신 Discord는 embed의 color로 왼쪽 줄 색을 넣는다.
 * 휴대폰 푸시 미리보기에는 embed가 보이지 않으므로 말머리(긴급 여부)는 content에 둔다.
 * 사용자가 쓴 글에 `@everyone` 같은 멘션이 섞여도 울리지 않게 allowed_mentions를 비운다.
 */

import type { InquirySlackInput, LoungeSlackInput } from "@/lib/slack";

/** Slack과 같은 색을 Discord가 받는 정수로 쓴다. */
const URGENT_COLOR = 0xe01e5a;
const NORMAL_COLOR = 0x8d9298;
const LOUNGE_COLOR = 0x03c75a;
/** 채널을 뒤덮지 않도록 본문은 여기까지만 싣는다(Slack과 같음). */
const BODY_LIMIT = 600;
/** 한 메시지에 싣는 라운지 항목 수(Slack과 같음). Discord는 메시지당 embed 10개까지 받는다. */
const LOUNGE_ITEM_LIMIT = 5;
/** Discord embed 제한: 제목 256자, 필드 값 1024자. */
const TITLE_LIMIT = 256;
const FIELD_LIMIT = 1024;

export type InquiryDiscordInput = InquirySlackInput;
export type LoungeDiscordInput = LoungeSlackInput;

export interface DiscordEmbed {
  color: number;
  title: string;
  url?: string;
  description?: string;
  author?: { name: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

export interface DiscordMessage {
  content: string;
  embeds: DiscordEmbed[];
  allowed_mentions: { parse: never[] };
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * 사용자가 쓴 글이 Discord 마크다운(굵게·기울임·코드·스포일러·인용·링크)으로 바뀌지 않게
 * 문장부호 앞에 역슬래시를 붙인다. Discord는 문장부호 앞의 역슬래시를 화면에서 숨긴다.
 */
export function escapeDiscord(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()<:-])/g, "\\$1");
}

/** 본문을 인용문으로 만든다. 관리자 라벨과 사용자 글을 눈으로 가르기 위해서다. */
function quoteBody(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  const clipped = trimmed.length > BODY_LIMIT ? `${trimmed.slice(0, BODY_LIMIT)}…` : trimmed;
  return escapeDiscord(clipped)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildInquiryDiscordMessage(input: InquiryDiscordInput): DiscordMessage {
  const urgent = input.priority === "urgent";
  const heading = `[${escapeDiscord(input.gameName)}] ${urgent ? "긴급 문의" : "새 문의"}`;
  const category = `${escapeDiscord(input.groupLabel)} › ${escapeDiscord(input.typeLabel)}`;
  const body = input.content ? quoteBody(input.content) : null;

  const embed: DiscordEmbed = {
    color: urgent ? URGENT_COLOR : NORMAL_COLOR,
    title: clip(escapeDiscord(input.title.trim() || "(제목 없음)"), TITLE_LIMIT),
    url: input.detailUrl,
    fields: [
      { name: "유형", value: clip(category, FIELD_LIMIT), inline: true },
      { name: "접수번호", value: input.inquiryNo ?? "접수번호 없음", inline: true },
      { name: "계정", value: clip(escapeDiscord(input.gameAccount ?? "계정 없음"), FIELD_LIMIT), inline: true },
    ],
  };
  if (body) {
    embed.description = body;
  }

  return {
    content: `${urgent ? "🚨 " : ""}**${heading}**`,
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}

/** 라운지 새 글·댓글 알림. 게임마다 메시지 하나, 항목마다 embed 하나. items는 비어 있지 않아야 한다. */
export function buildLoungeDiscordMessage(input: LoungeDiscordInput): DiscordMessage {
  const gameName = escapeDiscord(input.gameName);
  const shown = input.items.slice(0, LOUNGE_ITEM_LIMIT);
  const moreCount = input.items.length - shown.length;

  const embeds = shown.map((item): DiscordEmbed => {
    const meta = [item.boardName, item.nickname].filter((part): part is string => Boolean(part)).map(escapeDiscord).join(" · ");
    const description = [meta, quoteBody(item.body)].filter(Boolean).join("\n");
    const embed: DiscordEmbed = {
      color: LOUNGE_COLOR,
      author: { name: `[${input.gameName}] ${item.kind === "post" ? "라운지 새 글" : "라운지 새 댓글"}` },
      title: clip(escapeDiscord(item.title.trim() || "(제목 없음)"), TITLE_LIMIT),
      url: item.url,
    };
    if (description) {
      embed.description = description;
    }
    return embed;
  });

  // <주소>로 감싸면 Discord가 관리자 페이지 링크 미리보기 카드를 붙이지 않는다.
  const more = moreCount > 0 ? ` · 외 ${moreCount}건` : "";
  return {
    content: `💬 **[${gameName}] 라운지 새 글 ${input.items.length}건**${more} · [관리자에서 보기](<${input.listUrl}>)`,
    embeds,
    allowed_mentions: { parse: [] },
  };
}

export async function sendDiscordMessage(webhookUrl: string, message: DiscordMessage): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${response.status} ${body}`.trim());
  }
}
