import { randomUUID } from "node:crypto";
import type { InboxScope } from "@/lib/inbox-scope";
import { google, type gmail_v1 } from "googleapis";
import { isAllowedImageType, MAX_INBOUND_SOURCE_BYTES, type AllowedImageType } from "@/lib/attachment-rules";

export interface InlineImage {
  /** HTML에서 `cid:<cid>`로 참조한다. */
  cid: string;
  contentType: string;
  filename: string;
  data: Buffer;
}

/** 메일 아래쪽에 붙는 일반 첨부(답변에 붙인 사진). */
export interface MailAttachment {
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
  /** 메일 첨부. 있으면 본문 전체를 multipart/mixed로 감싼다. */
  attachments?: MailAttachment[];
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

/** 회신에 붙은 사진. 내용은 아직 안 받았고 attachmentId로 따로 내려받는다. */
export interface InboundAttachmentRef {
  attachmentId: string;
  filename: string;
  mimeType: AllowedImageType;
  size: number;
}

export interface InboundEmail {
  gmailMessageId: string;
  rfcMessageId: string | null;
  fromEmail: string | null;
  body: string;
  sentAt: string;
  /** 버킷이 받는 이미지만. 다른 종류의 첨부는 버린다. */
  attachments: InboundAttachmentRef[];
}

/** 메일함 전체에서 찾은 회신. 어느 문의인지 스레드 id로 맞춘다. */
export interface InboundEmailWithThread extends InboundEmail {
  threadId: string;
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
 * 보낼 때 넣는 Message-ID. Gmail API는 이 값을 보존하지 않고 `@mail.gmail.com`
 * 값으로 바꿔 보내므로(2026-09-16 실측) 발송 뒤 fetchSentRfcMessageId로 실제
 * 값을 읽어 저장한다. 이 값은 그 조회가 실패했을 때의 대체다.
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

/** 비ASCII 파일 이름을 헤더에 싣는다. 옛 메일 앱은 name의 encoded-word를, 요즘 것은 RFC 2231을 읽는다. */
function attachmentNameParams(filename: string): { name: string; filename: string } {
  const quoted = filename.replace(/["\\\r\n]/g, "_");
  if (/^[\x20-\x7e]*$/.test(quoted)) {
    return { name: `name="${quoted}"`, filename: `filename="${quoted}"` };
  }
  const encodedWord = `=?UTF-8?B?${Buffer.from(quoted, "utf-8").toString("base64")}?=`;
  return { name: `name="${encodedWord}"`, filename: `filename*=UTF-8''${encodeURIComponent(quoted)}` };
}

/** 본문 파트에 일반 첨부를 붙인다. 첨부가 없으면 본문 파트를 그대로 돌려준다. */
export function buildMessageParts(input: {
  body: string;
  html?: string;
  inlineImages?: InlineImage[];
  attachments?: MailAttachment[];
}): string[] {
  const bodyParts = buildBodyParts(input);
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) return bodyParts;

  const mixed = buildBoundary("mixed");
  const attachmentParts = attachments.map((attachment) => {
    const params = attachmentNameParams(attachment.filename);
    return [
      `Content-Type: ${attachment.contentType}; ${params.name}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; ${params.filename}`,
      "",
      base64Lines(attachment.data),
    ].join("\r\n");
  });
  return [
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    bodyParts.join("\r\n"),
    ...attachmentParts.flatMap((part) => [`--${mixed}`, part]),
    `--${mixed}--`,
  ];
}

interface Rfc2822Input {
  sender: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  inlineImages?: InlineImage[];
  attachments?: MailAttachment[];
  messageId: string;
  references?: string[];
}

export function encodeRfc2822Message(input: Rfc2822Input): string {
  return toBase64Url(buildRfc2822Message(input));
}

/** 인코딩 전의 RFC 2822 메일 원문. 첨부가 있으면 업로드 경로로 이 원문을 그대로 보낸다. */
export function buildRfc2822Message(input: Rfc2822Input): string {
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
  const [firstLine, ...rest] = buildMessageParts(input);
  return [...headers, firstLine, ...(rest.length > 0 ? rest : [""])].join("\r\n");
}

export async function sendReplyEmail(input: SendReplyEmailInput): Promise<SentEmail> {
  const { gmail, sender } = getGmailClient(input.mailbox);
  const rfcMessageId = buildRfcMessageId(sender);
  const message = buildRfc2822Message({
    sender,
    to: input.to,
    subject: input.subject,
    body: input.body,
    html: input.html,
    inlineImages: input.inlineImages,
    attachments: input.attachments,
    messageId: rfcMessageId,
    references: input.references,
  });
  const hasAttachments = (input.attachments ?? []).length > 0;
  const raw = hasAttachments ? null : toBase64Url(message);

  // 사진이 붙으면 메일이 커서 JSON 본문 대신 업로드 경로(message/rfc822, 35MB까지)로 보낸다.
  const send = (threadId: string | null | undefined) =>
    raw !== null
      ? gmail.users.messages.send({
          userId: "me",
          requestBody: { raw, ...(threadId ? { threadId } : {}) },
        })
      : gmail.users.messages.send({
          userId: "me",
          requestBody: threadId ? { threadId } : {},
          media: { mimeType: "message/rfc822", body: message },
        });

  let response;
  try {
    response = await send(input.threadId);
  } catch (error) {
    // 저장된 스레드가 이 메일함에 없으면(발신 계정을 바꾼 뒤 예전 계정이 만든
    // 스레드) Gmail이 404를 낸다. 새 스레드로 다시 보낸다. References 헤더는
    // 그대로라 사용자 메일함에서는 여전히 같은 대화로 묶이고, 호출부가 새
    // 스레드 id를 저장하면 그 뒤로는 정상적으로 이어진다.
    if (!input.threadId || !isNotFound(error)) throw error;
    console.warn("[gmail] thread not found in this mailbox, starting a new thread", { threadId: input.threadId });
    response = await send(null);
  }

  const gmailMessageId = response.data.id ?? "";
  let actualRfcMessageId: string | null = null;
  if (gmailMessageId) {
    try {
      actualRfcMessageId = await fetchSentRfcMessageId(gmail, gmailMessageId);
    } catch (error) {
      console.warn("[gmail] could not read back the sent Message-ID", { gmailMessageId }, error);
    }
  }

  return {
    gmailMessageId,
    gmailThreadId: response.data.threadId ?? "",
    rfcMessageId: actualRfcMessageId ?? rfcMessageId,
  };
}

/**
 * 보낸 메일에 Gmail이 실제로 붙인 Message-ID. 사용자 회신의 In-Reply-To /
 * References가 이 값을 가리키므로 스레드가 어긋난 회신을 맞출 때 쓴다.
 * gmail.readonly 스코프가 필요하다. 헤더가 없으면 null.
 */
export async function readSentRfcMessageId(mailbox: Mailbox, gmailMessageId: string): Promise<string | null> {
  return fetchSentRfcMessageId(getGmailClient(mailbox).gmail, gmailMessageId);
}

async function fetchSentRfcMessageId(gmail: gmail_v1.Gmail, gmailMessageId: string): Promise<string | null> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: gmailMessageId,
    format: "metadata",
    metadataHeaders: ["Message-ID"],
  });
  return header(response.data.payload?.headers, "Message-ID");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 404;
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
    const parsed = parseInboundMessage(message, senderAddress);
    if (parsed) inbound.push(parsed);
  }
  return inbound;
}

export interface UnthreadedReplyQuery {
  /** 문의의 회신 주소. 이 주소가 보낸 메일만 찾는다. */
  fromEmail: string;
  /** 첫 답변을 보낸 시각. 그 전 메일은 회신일 수 없다. */
  since: Date;
  /** 이 문의로 보낸 메일들의 실제 Message-ID(inquiry_messages.rfc_message_id). */
  rfcMessageIds: string[];
}

/**
 * 스레드 조회로는 안 보이는 회신을 찾는다. 사용자가 제목을 바꿔 답장하면 Gmail이
 * 새 스레드를 만들지만 In-Reply-To·References는 우리 메일을 가리키므로, 그
 * 주소가 첫 답변 이후 보낸 메일 중 우리 Message-ID를 참조하는 것만 고른다.
 * "회신 확인" 버튼이 스레드 조회와 함께 쓴다. gmail.readonly 스코프가 필요하다.
 */
export async function fetchUnthreadedReplies(mailbox: Mailbox, query: UnthreadedReplyQuery): Promise<InboundEmail[]> {
  if (query.rfcMessageIds.length === 0) return [];
  const { gmail, sender } = getGmailClient(mailbox);
  const senderAddress = sender.trim().toLowerCase();
  const wanted = new Set(query.rfcMessageIds);

  const q = `from:${query.fromEmail} after:${Math.floor(query.since.getTime() / 1000)} -from:${senderAddress}`;
  const listed = await gmail.users.messages.list({ userId: "me", q, maxResults: LIST_PAGE_SIZE });

  const inbound: InboundEmail[] = [];
  for (const entry of listed.data.messages ?? []) {
    if (!entry.id) continue;
    const response = await gmail.users.messages.get({ userId: "me", id: entry.id, format: "full" });
    const referenced = referencedMessageIds(response.data.payload?.headers);
    if (!referenced.some((id) => wanted.has(id))) continue;
    const parsed = parseInboundMessage(response.data, senderAddress);
    if (parsed) inbound.push(parsed);
  }
  return inbound;
}

/**
 * Gmail 메시지 하나를 InboundEmail로 바꾼다. 우리 발신 주소에서 나간 메일이거나
 * id가 없으면 null.
 */
function parseInboundMessage(message: gmail_v1.Schema$Message, senderAddress: string): InboundEmail | null {
  const headers = message.payload?.headers;
  const fromEmail = extractAddress(header(headers, "From"));
  if (fromEmail === senderAddress) return null;
  if (!message.id) return null;

  const body = stripQuotedReply(extractPlainText(message.payload));
  const internalDate = message.internalDate ? Number(message.internalDate) : NaN;
  const sentAt = Number.isFinite(internalDate) ? new Date(internalDate).toISOString() : new Date().toISOString();

  return {
    gmailMessageId: message.id,
    rfcMessageId: header(headers, "Message-ID"),
    fromEmail,
    body,
    sentAt,
    attachments: extractImageAttachments(message.payload),
  };
}

/**
 * 메일에 붙은 사진을 찾는다. 첨부로 붙였든 본문에 끼워 넣었든(inline) attachmentId가
 * 있는 이미지 파트를 모두 고른다. 버킷이 받지 않는 종류는 빼고, 5MB를 넘는 사진은 저장할 때
 * 줄이므로 남기되 25MB(Gmail 메일 상한)를 넘는 것만 뺀다.
 */
export function extractImageAttachments(payload: gmail_v1.Schema$MessagePart | undefined): InboundAttachmentRef[] {
  if (!payload) return [];
  const found: InboundAttachmentRef[] = [];
  const stack: gmail_v1.Schema$MessagePart[] = [payload];
  while (stack.length > 0) {
    const part = stack.shift()!;
    if (part.parts) stack.push(...part.parts);
    const attachmentId = part.body?.attachmentId;
    const mimeType = part.mimeType?.toLowerCase() ?? "";
    if (!attachmentId || !isAllowedImageType(mimeType)) continue;
    const size = part.body?.size ?? 0;
    if (size > MAX_INBOUND_SOURCE_BYTES) continue;
    found.push({ attachmentId, filename: part.filename ?? "", mimeType, size });
  }
  return found;
}

async function fetchAttachmentData(gmail: gmail_v1.Gmail, messageId: string, attachmentId: string): Promise<Buffer> {
  const response = await gmail.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
  const data = response.data.data;
  if (!data) throw new Error("empty attachment");
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** 회신 사진 하나를 내려받는다. "회신 확인" 버튼 경로가 쓴다. gmail.readonly 스코프가 필요하다. */
export async function downloadInboundAttachment(mailbox: Mailbox, messageId: string, attachmentId: string): Promise<Buffer> {
  return fetchAttachmentData(getGmailClient(mailbox).gmail, messageId, attachmentId);
}

/** 한 번의 동기화에서 훑는 메일 상한. 넘치면 다음 실행이 이어서 본다. */
const LIST_INBOUND_LIMIT = 500;
const LIST_PAGE_SIZE = 100;

export interface InboundMessageRef {
  id: string;
  threadId: string;
}

/**
 * 메일함 하나를 읽는 핸들. 회신 자동 동기화가 쓴다. OAuth 클라이언트를 한 번만
 * 만들어 메시지마다 토큰을 새로 받지 않는다. gmail.readonly 스코프가 필요하다.
 */
export interface MailboxReader {
  /** 이 메일함의 발신 주소. 서비스 계정이 게임 계정으로 대체되면 같은 값이 나온다. */
  sender: string;
  /**
   * `since` 이후 받은 메일의 id와 스레드 id만 가져온다. 본문은 안 읽으므로
   * 호출부가 스레드로 문의를 먼저 맞춰 보고 필요한 것만 getInboundMessage로 연다.
   * Gmail 검색의 after:는 초 단위 epoch만 받는다.
   */
  listInboundIdsSince(since: Date): Promise<InboundMessageRef[]>;
  /**
   * 메일이 답장하는 상대의 Message-ID들(In-Reply-To 먼저, 그다음 References).
   * 사용자가 제목을 바꿔 답장하면 Gmail이 새 스레드로 만들어 스레드 id로는
   * 못 맞추므로, 이 값을 우리가 보낸 메일의 rfc_message_id와 대조한다.
   * 본문은 읽지 않는다.
   */
  getReplyHeaders(id: string): Promise<string[]>;
  /** 메일 하나를 본문까지 읽는다. 우리 발신 주소에서 나간 메일이면 null. */
  getInboundMessage(id: string): Promise<InboundEmailWithThread | null>;
  /** 회신에 붙은 사진 하나의 내용. */
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
}

/** In-Reply-To·References 헤더에서 `<…>` 꼴 Message-ID를 순서대로, 중복 없이 뽑는다. */
export function referencedMessageIds(headers: gmail_v1.Schema$MessagePartHeader[] | undefined): string[] {
  const raw = [header(headers, "In-Reply-To"), header(headers, "References")].filter((v): v is string => !!v);
  const ids: string[] = [];
  for (const value of raw) {
    for (const match of value.match(/<[^<>\s]+>/g) ?? []) {
      if (!ids.includes(match)) ids.push(match);
    }
  }
  return ids;
}

export function openMailbox(mailbox: Mailbox): MailboxReader {
  const { gmail, sender } = getGmailClient(mailbox);
  const senderAddress = sender.trim().toLowerCase();

  return {
    sender,
    async listInboundIdsSince(since) {
      const q = `after:${Math.floor(since.getTime() / 1000)} -from:${senderAddress}`;
      const refs: InboundMessageRef[] = [];
      let pageToken: string | undefined;
      do {
        const response = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: LIST_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        });
        for (const entry of response.data.messages ?? []) {
          if (entry.id && entry.threadId) refs.push({ id: entry.id, threadId: entry.threadId });
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken && refs.length < LIST_INBOUND_LIMIT);
      return refs;
    },
    async getReplyHeaders(id) {
      const response = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["In-Reply-To", "References"],
      });
      return referencedMessageIds(response.data.payload?.headers);
    },
    async getInboundMessage(id) {
      const response = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const parsed = parseInboundMessage(response.data, senderAddress);
      if (!parsed || !response.data.threadId) return null;
      return { ...parsed, threadId: response.data.threadId };
    },
    getAttachment(messageId, attachmentId) {
      return fetchAttachmentData(gmail, messageId, attachmentId);
    },
  };
}
