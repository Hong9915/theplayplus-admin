import { z } from "zod";

/**
 * 원스토어 상품 페이지 읽기. 공식 API가 없어 모바일 웹 상품 페이지(Next.js)가 HTML에 실어 보내는
 * 상품 데이터(`self.__next_f.push` 스트림 안의 product 객체)를 꺼낸다(2026-10-17 실측).
 * 출시 전 사전예약 게임은 상품 페이지가 비어 있고 사전예약 페이지에만 prodInfo·imageInfo 로 실린다
 * (2026-10-19 실측, 0001009277). 상품 페이지에 없으면 사전예약 페이지를 읽는다.
 * 모양이 바뀌면 zod 검증이 던져 화면에 "불러오지 못했다"가 뜬다. 원스토어를 아는 파일은 여기 하나다.
 */

const PAGE_BASE = "https://m.onestore.co.kr/v2/ko-kr/app";
const PREREG_BASE = "https://m.onestore.co.kr/v2/ko-kr/event/preregistrations";
const TIMEOUT_MS = 10_000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "Accept-Language": "ko-KR,ko;q=0.9",
};
const PRODUCT_ID = /^\d{10}$/;
const LOUNGE_SITE_CODE = "PD016402";
const LOUNGE_URL = /^https:\/\/game\.naver\.com\/lounge\//;

const productSchema = z.object({
  prodId: z.string(),
  prodNm: z.string(),
  categoryNm: z.string().nullish(),
  useGrade: z.object({ minAge: z.number().nullish(), adultGrdYn: z.string().nullish() }).nullish(),
  prodDesc: z.string().nullish(),
  prodExplain: z.string().nullish(),
  descImage: z.object({ path: z.string().nullish() }).nullish(),
  screenshotList: z.array(z.object({ path: z.string() })).nullish(),
  siteList: z.array(z.object({ siteClsfCd: z.string(), siteUrl: z.string() })).nullish(),
  videos: z.object({ youtube: z.object({ youtubeUrl: z.string().nullish() }).nullish() }).nullish(),
});

const preregInfoSchema = z.object({
  prodId: z.string(),
  prodName: z.string(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  releasePlanDay: z.string().nullish(),
  oneLineDesc: z.string().nullish(),
  detailInfo: z.string().nullish(),
  gradeInfo: z.object({ minAge: z.string().nullish(), adultGradeYn: z.string().nullish() }).nullish(),
  videoUrl: z.string().nullish(),
  officialCommunity: z.array(z.object({ address: z.string() })).nullish(),
});

const preregImagesSchema = z.object({
  videoImage: z.string().nullish(),
  slideImages: z.array(z.string()).nullish(),
});

export interface OneStoreProduct {
  productId: string;
  url: string;
  title: string;
  genre: string | null;
  ageRating: string | null;
  tagline: string | null;
  description: string | null;
  /** 상품 상세 상단 대표 이미지(가로형). 목록 카드로 쓴다. */
  promoImageUrl: string | null;
  screenshotUrls: string[];
  naverLoungeUrl: string | null;
  youtubeUrl: string | null;
  /** 사전예약 페이지의 출시 예정 표기(숫자가 있을 때만). 상품 페이지의 releaseDate 는 최신 버전 배포일이라 쓰지 않는다. */
  releaseDate: string | null;
  /** 사전예약 기간 "2026.09.30 ~ 2026.10.30". 사전예약 페이지에만 있다. */
  preregPeriod: string | null;
}

/** onesto.re 단축 주소, 원스토어 웹 주소, 상품 ID(10자리) 어느 것이든 상품 ID를 뽑는다. */
export function parseOneStoreProductId(input: string): string | null {
  const trimmed = input.trim();
  if (PRODUCT_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host === "onesto.re") {
    const id = url.pathname.slice(1);
    return PRODUCT_ID.test(id) ? id : null;
  }
  if (!host.endsWith("onestore.co.kr")) return null;
  const fromPath = url.pathname.match(/\/(?:app|preregistrations)\/(\d{10})(?:\/|$)/)?.[1];
  const fromQuery = url.searchParams.get("param") ?? url.searchParams.get("prodId");
  const id = fromPath ?? fromQuery;
  return id && PRODUCT_ID.test(id) ? id : null;
}

/** HTML의 `self.__next_f.push([1,"…"])` 조각을 이어 붙여 하나의 문자열로. */
function readFlightStream(html: string): string {
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g);
  let stream = "";
  for (const [, chunk] of chunks) {
    stream += JSON.parse(`"${chunk}"`) as string;
  }
  return stream;
}

/** `start`의 `{`부터 짝이 맞는 `}`까지 잘라 JSON으로 읽는다. 잘려 있으면 null. */
function readObjectAt(stream: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let i = start; i < stream.length; i += 1) {
    const char = stream[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(stream.slice(start, i + 1));
  }
  return null;
}

/**
 * 스트림의 `"{name}":{…}` 객체 중 prodId가 이 상품인 것을 찾는다. 필드 순서는 원스토어가 바꾼 적이
 * 있어(2026-10-17, 앞에 badge가 붙음) 기대하지 않는다. 같은 페이지의 다른 상품(비슷한 게임 등)은 건너뛴다.
 * prodId 를 보지 않으면(`productId` 없음) 처음 나온 객체를 돌려준다. 없으면 null.
 */
function findObject(stream: string, name: string, productId?: string): unknown {
  const key = `"${name}":{`;
  for (let at = stream.indexOf(key); at !== -1; at = stream.indexOf(key, at + key.length)) {
    const candidate = readObjectAt(stream, at + key.length - 1);
    if (candidate && typeof candidate === "object" && (!productId || (candidate as { prodId?: unknown }).prodId === productId)) {
      return candidate;
    }
  }
  return null;
}

function youtubeUrl(url: string | null | undefined): string | null {
  return url && /^https:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//.test(url) ? url : null;
}

function ageRatingLabel(grade: z.infer<typeof productSchema>["useGrade"]): string | null {
  if (!grade) return null;
  if (grade.adultGrdYn === "Y") return "청소년 이용불가";
  if (grade.minAge === 0) return "전체 이용가";
  return typeof grade.minAge === "number" ? `${grade.minAge}세 이용가` : null;
}

/** 원스토어 이미지 주소는 `0_0_…` 크기(원본)로 온다. https 주소만 받는다. */
function fullSizeImage(url: string | null | undefined): string | null {
  if (!url || !url.startsWith("https://")) return null;
  return url;
}

export function mapOneStoreProduct(raw: unknown): OneStoreProduct {
  const product = productSchema.parse(raw);
  const description = product.prodExplain?.replace(/\r\n/g, "\n").trim() || null;
  // 원스토어 짧은 설명은 문단 사이를 공백 여러 칸으로 띄워 둔다.
  const tagline = product.prodDesc?.replace(/\s{2,}/g, " ").trim() || null;
  return {
    productId: product.prodId,
    url: `https://onesto.re/${product.prodId}`,
    title: product.prodNm.trim(),
    genre: product.categoryNm?.trim() || null,
    ageRating: ageRatingLabel(product.useGrade),
    tagline,
    description,
    promoImageUrl: fullSizeImage(product.descImage?.path),
    screenshotUrls: (product.screenshotList ?? []).map((shot) => fullSizeImage(shot.path)).filter((url): url is string => url !== null),
    naverLoungeUrl: product.siteList?.find((site) => site.siteClsfCd === LOUNGE_SITE_CODE)?.siteUrl ?? null,
    youtubeUrl: youtubeUrl(product.videos?.youtube?.youtubeUrl),
    releaseDate: null,
    preregPeriod: null,
  };
}

/**
 * 사전예약 페이지의 prodInfo·imageInfo 를 상품과 같은 모양으로. 장르 이름은 실려 있지 않다(코드만 있음).
 * 가로형 영상 썸네일(videoImage, 1024×578)을 목록 카드로, 슬라이드 이미지를 스크린샷으로 쓴다.
 */
export function mapOneStorePreregistration(rawInfo: unknown, rawImages: unknown): OneStoreProduct {
  const info = preregInfoSchema.parse(rawInfo);
  const images = preregImagesSchema.nullish().parse(rawImages);
  const minAge = info.gradeInfo?.minAge ? Number(info.gradeInfo.minAge) : null;
  return {
    productId: info.prodId,
    url: `${PREREG_BASE}/${info.prodId}`,
    title: info.prodName.trim(),
    genre: null,
    ageRating: ageRatingLabel(info.gradeInfo ? { minAge: Number.isFinite(minAge) ? minAge : null, adultGrdYn: info.gradeInfo.adultGradeYn } : null),
    tagline: info.oneLineDesc?.trim() || null,
    description: info.detailInfo?.replace(/\r\n/g, "\n").trim() || null,
    promoImageUrl: fullSizeImage(images?.videoImage),
    screenshotUrls: (images?.slideImages ?? []).map(fullSizeImage).filter((url): url is string => url !== null),
    naverLoungeUrl: info.officialCommunity?.find((site) => LOUNGE_URL.test(site.address))?.address ?? null,
    youtubeUrl: youtubeUrl(info.videoUrl),
    // "출시 예정"처럼 날짜가 없는 표기는 관리자가 적은 값을 덮지 않게 버린다.
    releaseDate: info.releasePlanDay && /\d/.test(info.releasePlanDay) ? info.releasePlanDay.trim() : null,
    preregPeriod: preregPeriod(info.startDate, info.endDate),
  };
}

/** "20260930190000" → "2026.09.30". 모양이 다르면 null. */
function dotDate(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function preregPeriod(start: string | null | undefined, end: string | null | undefined): string | null {
  const from = dotDate(start);
  const to = dotDate(end);
  return from && to ? `${from} ~ ${to}` : null;
}

async function fetchStream(url: string): Promise<{ status: number; stream: string }> {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok && response.status !== 404) throw new Error(`onestore request failed: ${response.status}`);
  return { status: response.status, stream: response.ok ? readFlightStream(await response.text()) : "" };
}

export async function fetchOneStoreProduct(productId: string): Promise<OneStoreProduct> {
  const app = await fetchStream(`${PAGE_BASE}/${productId}`);
  const product = findObject(app.stream, "product", productId);
  if (product) return mapOneStoreProduct(product);

  const prereg = await fetchStream(`${PREREG_BASE}/${productId}`);
  const info = findObject(prereg.stream, "prodInfo", productId);
  if (info) return mapOneStorePreregistration(info, findObject(prereg.stream, "imageInfo"));

  if (app.status === 404 && prereg.status === 404) throw new OneStoreNotFoundError(productId);
  throw new Error("onestore product data not found");
}

export class OneStoreNotFoundError extends Error {
  constructor(productId: string) {
    super(`onestore product ${productId} not found`);
  }
}

/** 원스토어 이미지를 받아 온다. 형식이 이미지가 아니거나 너무 크면 null. */
export async function downloadOneStoreImage(url: string, maxBytes: number): Promise<{ data: ArrayBuffer; contentType: string; fileName: string } | null> {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.startsWith("image/")) return null;
  const data = await response.arrayBuffer();
  if (data.byteLength > maxBytes) return null;
  const extension = contentType.split("/")[1]?.split(";")[0] ?? "png";
  // 썸네일 주소의 마지막 조각(…%2F0001007974_20261006121256.png)이 원래 파일 이름이다.
  const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").split("/").pop() ?? "";
  const fileName = /\.[a-z0-9]+$/i.test(last) ? last : `onestore.${extension === "jpeg" ? "jpg" : extension}`;
  return { data, contentType, fileName };
}
