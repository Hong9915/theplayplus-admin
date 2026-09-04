import { randomUUID } from "node:crypto";
import type { InboxScope } from "@/lib/inbox-scope";
import { google, type gmail_v1 } from "googleapis";

export interface InlineImage {
  /** HTML에서 `cid:<cid>`로 참조한다. */
  cid: string;
  contentType: string;
  filename: string;
  data: Buffer;
}

export interface SendReplyEmailInput {
  mailbox: Mailbox;
  to: string;
  subject: string;
  /** 텍스트 본문. HTML을 못 보는 메일 앱과 회신 동기화가 이 부분을 읽는다. */
  body: string;
  /** 있으면 multipart/alternative로 텍스트와 함께 보낸다. */
  html?: string;
  /** HTML이 참조하는 인라인 이미지(로고 등). html이 있을 때만 쓰인다. */
  inlineImages?: InlineImage[];
  /** 이전에 오간 메일이 있으면 같은 Gmail 스레드에 묶는다. */
  threadId?: string | null;
  /** 지금까지 오간 메일의 RFC 2822 Message-ID. 오래된 순. */
  references?: string[];
}

export interface SentEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  rfcMessageId: string;
}

export interface InboundEmail {
  gmailMessageId: string;
  rfcMessageId: string | null;
  fromEmail: string | null;
  body: string;
  sentAt: string;
}

/**
 * 답변이 나가는 메일함. 게임 문의는 help@, 서비스 문의는 info@처럼 계정이
 * 다르므로 스코프 종류(InboxScope.kind)와 같은 값으로 고른다.
 */
export type Mailbox = InboxScope["kind"];

interface MailboxCredentials {
  refreshToken: string;
  sender: string;
}

/**
 * 메일함별 토큰과 발신 주소. OAuth 클라이언트는 공용이고 계정마다 refresh
 * token이 다르다. 서비스용 두 값이 모두 비어 있으면 게임용으로 대신 보내
 * 설정 전에도 발송이 막히지 않게 한다. 하나만 있으면 설정 실수라 오류.
 */
function resolveMailbox(mailbox: Mailbox): MailboxCredentials {
  const gameToken = process.env.GMAIL_REFRESH_TOKEN;
  const gameSender = process.env.GMAIL_SENDER;
  if (!gameToken || !gameSender) {
    throw new Error("Missing one of GMAIL_REFRESH_TOKEN, GMAIL_SENDER environment variables");
  }
  if (mailbox === "game") {
    return { refreshToken: gameToken, sender: gameSender };
  }

  const serviceToken = process.env.GMAIL_SERVICE_REFRESH_TOKEN;
  const serviceSender = process.env.GMAIL_SERVICE_SENDER;
  if (!serviceToken && !serviceSender) {
    return { refreshToken: gameToken, sender: gameSender };
  }
  if (!serviceToken || !serviceSender) {
    throw new Error("Set both GMAIL_SERVICE_REFRESH_TOKEN and GMAIL_SERVICE_SENDER, or neither");
  }
  return { refreshToken: serviceToken, sender: serviceSender };
}

/** 그 메일함에서 나가는 메일의 From 주소. 메일 푸터에도 같은 주소를 찍는다. */
export function mailboxSender(mailbox: Mailbox): string {
  return resolveMailbox(mailbox).sender;
}

function getGmailClient(mailbox: Mailbox) {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing one of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET environment variables");
  }
  const { refreshToken, sender } = resolveMailbox(mailbox);

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return { gmail: google.gmail({ version: "v1", auth: oauth2Client }), sender };
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Message-ID는 우리가 직접 만든다. Gmail이 붙여주는 값을 다시 읽어오려면
 * 발송 뒤 조회를 한 번 더 해야 하는데, 직접 넣으면 Gmail이 그대로 보존한다.
 */
export function buildRfcMessageId(sender: string): string {
  const domain = sender.split("@")[1] || "theplayplus.com";
  return `<${randomUUID()}@${domain}>`;
}

function base64Lines(data: Buffer): string {
  // RFC 2045: base64 본문은 76자마다 줄을 바꾼다.
  return data.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function buildBoundary(label: string): string {
  return `${label}_${randomUUID().replace(/-/g, "")}`;
}

/**
 * 본문 파트를 만든다. HTML이 없으면 text/plain 하나, 있으면
 * multipart/alternative(text, html). 인라인 이미지가 있으면 html 쪽을
 * multipart/related(html, images)로 한 번 더 감싼다.
 */
export function buildBodyParts(input: { body: string; html?: string; inlineImages?: InlineImage[] }): string[] {
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", input.body].join(
    "\r\n"
  );
  if (!input.html) {
    return [textPart];
  }

  const htmlPart = [
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(input.html, "utf-8")),
  ].join("\r\n");

  const images = input.inlineImages ?? [];
  let htmlSection = htmlPart;
  if (images.length > 0) {
    const related = buildBoundary("related");
    const imageParts = images.map((image) =>
      [
        `Content-Type: ${image.contentType}; name="${image.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-ID: <${image.cid}>`,
        `Content-Disposition: inline; filename="${image.filename}"`,
        "",
        base64Lines(image.data),
      ].join("\r\n")
    );
    htmlSection = [
      `Content-Type: multipart/related; boundary="${related}"`,
      "",
      `--${related}`,
      htmlPart,
      ...imageParts.flatMap((part) => [`--${related}`, part]),
      `--${related}--`,
    ].join("\r\n");
  }

  const alternative = buildBoundary("alternative");
  return [
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    textPart,
    `--${alternative}`,
    htmlSection,
    `--${alternative}--`,
  ];
}

export function encodeRfc2822Message(input: {
  sender: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  inlineImages?: InlineImage[];
  messageId: string;
  references?: string[];
}): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(input.subject, "utf-8").toString("base64")}?=`;
  const headers = [
    `From: ${input.sender}`,
    `To: ${input.to}`,
    `Subject: ${encodedSubject}`,
    `Message-ID: ${input.messageId}`,
  ];

  // Gmail이 threadId만으로는 묶어주지 않는다. References/In-Reply-To까지
  // RFC 2822대로 채워야 같은 스레드로 들어간다.
  const references = input.references ?? [];
  if (references.length > 0) {
    headers.push(`In-Reply-To: ${references[references.length - 1]}`);
    headers.push(`References: ${references.join(" ")}`);
  }

  headers.push("MIME-Version: 1.0");

  // 파트의 첫 줄은 Content-Type 헤더라 그대로 헤더 블록에 이어 붙고,
  // 빈 줄이 헤더와 본문을 가른다.
  const [firstLine, ...rest] = buildBodyParts(input);
  return toBase64Url([...headers, firstLine, ...(rest.length > 0 ? rest : [""])].join("\r\n"));
}

export async function sendReplyEmail(input: SendReplyEmailInput): Promise<SentEmail> {
  const { gmail, sender } = getGmailClient(input.mailbox);
  const rfcMessageId = buildRfcMessageId(sender);
  const raw = encodeRfc2822Message({
    sender,
    to: input.to,
    subject: input.subject,
    body: input.body,
    html: input.html,
    inlineImages: input.inlineImages,
    messageId: rfcMessageId,
    references: input.references,
  });

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
  });

  return {
    gmailMessageId: response.data.id ?? "",
    gmailThreadId: response.data.threadId ?? "",
    rfcMessageId,
  };
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** multipart 안에서 text/plain 파트를 찾는다. 없으면 text/html을 태그만 벗겨 쓴다. */
export function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const stack: gmail_v1.Schema$MessagePart[] = [payload];
  let html: string | null = null;

  while (stack.length > 0) {
    const part = stack.shift()!;
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBody(part.body.data);
    }
    if (part.mimeType === "text/html" && part.body?.data && html === null) {
      html = decodeBody(part.body.data);
    }
    if (part.parts) {
      stack.push(...part.parts);
    }
  }

  if (html !== null) {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  return "";
}

/**
 * 사용자가 메일 앱에서 답장하면 우리가 보낸 본문이 인용문으로 딸려온다.
 * "On ... wrote:" / "님이 작성:" 같은 구분선 아래는 잘라낸다.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex(
    (line) =>
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /님이 작성:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      /^>/.test(line)
  );
  const kept = cut === -1 ? lines : lines.slice(0, cut);
  return kept.join("\n").trim();
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  const found = headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function extractAddress(from: string | null): string | null {
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * 스레드에서 우리가 보낸 것이 아닌 메일, 즉 사용자 회신만 골라낸다.
 * gmail.readonly 스코프가 필요하다.
 */
export async function fetchInboundReplies(threadId: string, mailbox: Mailbox): Promise<InboundEmail[]> {
  const { gmail, sender } = getGmailClient(mailbox);
  const response = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = response.data.messages ?? [];
  const senderAddress = sender.trim().toLowerCase();

  const inbound: InboundEmail[] = [];
  for (const message of messages) {
    const headers = message.payload?.headers;
    const fromEmail = extractAddress(header(headers, "From"));
    if (fromEmail === senderAddress) continue;
    if (!message.id) continue;

    const body = stripQuotedReply(extractPlainText(message.payload));
    const internalDate = message.internalDate ? Number(message.internalDate) : NaN;
    const sentAt = Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString();

    inbound.push({
      gmailMessageId: message.id,
      rfcMessageId: header(headers, "Message-ID"),
      fromEmail,
      body,
      sentAt,
    });
  }
  return inbound;
}
