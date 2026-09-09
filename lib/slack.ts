/**
 * Slack Incoming Webhook 전송. 새 문의가 접수되면 Supabase Database Webhook이
 * /api/notify/inquiry 를 호출하고, 그 라우트가 여기서 만든 메시지를 Slack 채널로 보낸다.
 *
 * 메시지를 attachment 하나로 감싸는 이유는 색 때문이다. Slack에서 메시지에 색을
 * 넣을 수 있는 자리는 attachment의 왼쪽 세로줄뿐이라, 긴급 문의를 빨간 줄로
 * 구분하려면 블록을 attachment 안에 넣어야 한다.
 */

/** 긴급 문의의 세로줄 색(Slack이 경고에 쓰는 빨강). */
const URGENT_COLOR = "#E01E5A";
/** 그 밖의 문의(=서비스 문의) 세로줄 색. */
const NORMAL_COLOR = "#8D9298";
/** 채널을 뒤덮지 않도록 본문은 여기까지만 싣는다. */
const BODY_LIMIT = 600;

export interface InquirySlackInput {
  gameName: string;
  inquiryNo: string | null;
  groupLabel: string;
  typeLabel: string;
  title: string;
  content: string | null;
  gameAccount: string | null;
  priority: string | null;
  detailUrl: string;
}

export interface SlackAttachment {
  color: string;
  blocks: unknown[];
}

export interface SlackMessage {
  text: string;
  attachments: SlackAttachment[];
}

/**
 * 문의 제목·본문은 사용자가 쓴 글이라 Slack 마크업 문자가 섞여 있을 수 있다.
 * `<...>`는 Slack이 링크로 삼키므로 escape해서 쓴 그대로 보이게 한다.
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 본문을 인용문으로 만든다. 관리자가 쓴 라벨과 사용자가 쓴 글을 눈으로 가르기 위해서다. */
function quoteBody(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }
  const clipped = trimmed.length > BODY_LIMIT ? `${trimmed.slice(0, BODY_LIMIT)}…` : trimmed;
  return escapeMrkdwn(clipped)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function buildInquirySlackMessage(input: InquirySlackInput): SlackMessage {
  const urgent = input.priority === "urgent";
  // 구분자 ">"는 우리가 넣는 글자라 escape 대상이 아니다. 라벨만 따로 씻는다.
  const category = `${escapeMrkdwn(input.groupLabel)} > ${escapeMrkdwn(input.typeLabel)}`;
  const inquiryNo = input.inquiryNo ?? "접수번호 없음";
  const account = input.gameAccount ?? "계정 없음";
  const title = escapeMrkdwn(input.title);
  // 색이 안 보이는 휴대폰 푸시 미리보기에서도 긴급 건을 가릴 수 있게 말머리로도 표시한다.
  const heading = `[${escapeMrkdwn(input.gameName)}] ${urgent ? "긴급 문의" : "새 문의"}`;
  const body = input.content ? quoteBody(input.content) : null;

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${urgent ? "🚨 " : ""}*${heading}*\n*${category}*\n<${input.detailUrl}|${title}>`,
      },
    },
  ];

  if (body) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: body } });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `접수번호 ${inquiryNo} · 계정 ${escapeMrkdwn(account)}` }],
  });

  return {
    // 푸시 알림·알림 미리보기에 쓰이는 한 줄 요약.
    text: `${heading} · ${category} · ${title}`,
    attachments: [{ color: urgent ? URGENT_COLOR : NORMAL_COLOR, blocks }],
  };
}

export async function sendSlackMessage(webhookUrl: string, message: SlackMessage): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${response.status} ${body}`.trim());
  }
}
