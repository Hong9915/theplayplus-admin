/**
 * Slack Incoming Webhook 전송. 새 문의가 접수되면 Supabase Database Webhook이
 * /api/notify/inquiry 를 호출하고, 그 라우트가 여기서 만든 메시지를 Slack 채널로 보낸다.
 */

export interface InquirySlackInput {
  gameName: string;
  inquiryNo: string | null;
  groupLabel: string;
  typeLabel: string;
  title: string;
  gameAccount: string | null;
  detailUrl: string;
}

export interface SlackMessage {
  text: string;
  blocks: unknown[];
}

export function buildInquirySlackMessage(input: InquirySlackInput): SlackMessage {
  const category = `${input.groupLabel} > ${input.typeLabel}`;
  const inquiryNo = input.inquiryNo ?? "접수번호 없음";
  const account = input.gameAccount ?? "계정 없음";

  return {
    // 푸시 알림·알림 미리보기에 쓰이는 한 줄 요약.
    text: `[${input.gameName}] 새 문의 · ${category} · ${input.title}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${input.gameName}] 새 문의*\n*${category}*\n<${input.detailUrl}|${input.title}>`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `접수번호 ${inquiryNo} · 계정 ${account}` }],
      },
    ],
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
