/**
 * 답변 메일의 HTML/텍스트 본문을 만든다.
 *
 * 메일 앱은 CSS 지원이 제각각이라 테이블 레이아웃과 인라인 스타일만 쓴다.
 * 로고는 외부 호스팅 대신 인라인 첨부(cid:)로 붙여 이미지 차단이나
 * webp 미지원과 무관하게 보이도록 한다.
 */

export interface ReplyEmailInquiry {
  inquiryNo: string | null;
  groupLabel: string | null;
  typeLabel: string | null;
  title: string;
  content: string;
}

export interface ReplyEmailInput {
  gameName: string;
  gameAccount: string | null;
  replyBody: string;
  inquiry: ReplyEmailInquiry;
  /** HTML 안에서 `cid:<logoCid>`로 참조되는 인라인 로고 첨부 ID */
  logoCid: string;
  contactUrl: string;
}

export const COMPANY = {
  name: "주식회사 더플레이플러스",
  representative: "강범준",
  registrationNo: "847-81-03647",
  address: "서울특별시 구로구 디지털로31길 38-21 이앤씨벤처드림타워3차 6층 602호",
  email: "info@theplayplus.com",
  siteUrl: "https://www.theplayplus.com/",
} as const;

const COLORS = {
  dark: "#0C0912",
  text: "#221E28",
  body: "#463F4F",
  muted: "#6F6878",
  faint: "#8B8391",
  mutedOnDark: "#A79FB0",
  line: "#D6CFDB",
  surface: "#F5F2F0",
  outer: "#ECE9E6",
  accent: "#EA581F",
} as const;

const FONT = `'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', Helvetica, Arial, sans-serif`;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 줄바꿈을 <br>로 살리면서 나머지는 모두 이스케이프한다. */
function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

function detailRow(label: string, value: string): string {
  return `
        <tr>
          <td width="64" valign="top" style="padding:0 12px 8px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.faint};white-space:nowrap;">${label}</td>
          <td valign="top" style="padding:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${COLORS.text};">${value}</td>
        </tr>`;
}

export function renderReplyEmailHtml(input: ReplyEmailInput): string {
  const gameName = escapeHtml(input.gameName);
  const greeting = input.gameAccount
    ? `<strong style="color:${COLORS.text};">${escapeHtml(input.gameAccount)}</strong>님, 안녕하세요.`
    : `고객님, 안녕하세요.`;

  const category = [input.inquiry.groupLabel, input.inquiry.typeLabel].filter(Boolean).map((v) => escapeHtml(v as string));

  const rows = [
    input.inquiry.inquiryNo ? detailRow("접수번호", `<span style="font-weight:500;">${escapeHtml(input.inquiry.inquiryNo)}</span>`) : "",
    category.length > 0 ? detailRow("문의 유형", category.join(" · ")) : "",
    input.gameAccount ? detailRow("게임 계정", escapeHtml(input.gameAccount)) : "",
    detailRow("제목", escapeHtml(input.inquiry.title)),
  ].join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${gameName} 고객센터 문의 답변</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.outer};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.outer};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#FFFFFF;">

        <tr>
          <td style="background-color:${COLORS.dark};padding:28px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left" valign="middle"><img src="cid:${input.logoCid}" alt="THE PLAY+" height="36" style="height:36px;width:auto;display:block;border:0;"></td>
                <td align="right" valign="middle" style="font-family:${FONT};font-size:13px;font-weight:500;color:${COLORS.mutedOnDark};letter-spacing:0.02em;">고객센터</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:40px 40px 0 40px;">
            <div style="font-family:${FONT};font-size:13px;font-weight:700;color:${COLORS.accent};letter-spacing:0.04em;">${gameName} 고객센터</div>
            <h1 style="margin:10px 0 0 0;font-family:${FONT};font-size:24px;font-weight:700;line-height:1.35;color:${COLORS.text};">문의하신 내용에 대한 답변입니다</h1>
            <p style="margin:16px 0 0 0;font-family:${FONT};font-size:15px;line-height:1.7;color:${COLORS.body};">${greeting}<br>보내주신 문의를 확인하고 아래와 같이 답변드립니다.</p>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 0 40px;">
            <div style="height:1px;line-height:1px;font-size:1px;background-color:${COLORS.line};">&nbsp;</div>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 40px 0 40px;font-family:${FONT};font-size:15px;line-height:1.8;color:${COLORS.body};">${multiline(input.replyBody)}</td>
        </tr>

        <tr>
          <td style="padding:32px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.surface};">
              <tr>
                <td style="padding:24px 28px;">
                  <div style="margin:0 0 14px 0;font-family:${FONT};font-size:14px;font-weight:700;color:${COLORS.text};">고객님께서 문의하신 내용</div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}
                  </table>
                  <div style="margin:6px 0 14px 0;height:1px;line-height:1px;font-size:1px;background-color:${COLORS.line};">&nbsp;</div>
                  <div style="font-family:${FONT};font-size:13px;line-height:1.7;color:${COLORS.body};">${multiline(input.inquiry.content)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 40px 0 40px;font-family:${FONT};font-size:13px;line-height:1.7;color:${COLORS.muted};">추가로 문의하실 내용이 있다면 <a href="${escapeHtml(input.contactUrl)}" style="color:${COLORS.accent};font-weight:500;text-decoration:none;">문의하기</a> 페이지를 이용해 주세요. 이 메일에 직접 답장하셔도 같은 담당자에게 전달됩니다.</td>
        </tr>

        <tr>
          <td style="padding:40px 0 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.surface};">
              <tr>
                <td style="padding:28px 40px;font-family:${FONT};font-size:11px;line-height:1.7;color:${COLORS.faint};">
                  <div style="font-weight:700;color:${COLORS.body};">${COMPANY.name}</div>
                  <div>대표 ${COMPANY.representative} · 사업자등록번호 ${COMPANY.registrationNo}</div>
                  <div>${COMPANY.address}</div>
                  <div>${COMPANY.email}</div>
                  <div style="margin-top:6px;">© 2026 ${COMPANY.name}. All rights reserved.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * HTML을 못 보는 메일 앱을 위한 텍스트 본문. 답변이 맨 앞에 오고
 * 그 아래에 원문을 붙인다. 회신 동기화가 text/plain을 우선 읽으므로
 * 사용자가 답장할 때 인용문으로 딸려와도 stripQuotedReply가 잘라낸다.
 */
export function renderReplyEmailText(input: ReplyEmailInput): string {
  const category = [input.inquiry.groupLabel, input.inquiry.typeLabel].filter(Boolean).join(" · ");
  const lines = [
    input.replyBody,
    "",
    "----------------------------------------",
    "[고객님께서 문의하신 내용]",
    input.inquiry.inquiryNo ? `접수번호: ${input.inquiry.inquiryNo}` : null,
    category ? `문의 유형: ${category}` : null,
    input.gameAccount ? `게임 계정: ${input.gameAccount}` : null,
    `제목: ${input.inquiry.title}`,
    "",
    input.inquiry.content,
    "",
    `추가 문의: ${input.contactUrl}`,
    "",
    `${COMPANY.name} · ${COMPANY.email}`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}
