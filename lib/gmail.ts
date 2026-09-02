import { randomUUID } from "node:crypto";
import { google, type gmail_v1 } from "googleapis";

export interface SendReplyEmailInput {
  to: string;
  subject: string;
  body: string;
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

function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const sender = process.env.GMAIL_SENDER;

  if (!clientId || !clientSecret || !refreshToken || !sender) {
    throw new Error(
      "Missing one of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER environment variables"
    );
  }

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

export function encodeRfc2822Message(input: {
  sender: string;
  to: string;
  subject: string;
  body: string;
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

  headers.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8");

  return toBase64Url([...headers, "", input.body].join("\r\n"));
}

export async function sendReplyEmail(input: SendReplyEmailInput): Promise<SentEmail> {
  const { gmail, sender } = getGmailClient();
  const rfcMessageId = buildRfcMessageId(sender);
  const raw = encodeRfc2822Message({
    sender,
    to: input.to,
    subject: input.subject,
    body: input.body,
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
export async function fetchInboundReplies(threadId: string): Promise<InboundEmail[]> {
  const { gmail, sender } = getGmailClient();
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
