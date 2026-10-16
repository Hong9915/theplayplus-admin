import { z } from "zod";

/**
 * 원스토어 상품 페이지 읽기. 공식 API가 없어 모바일 웹 상품 페이지(Next.js)가 HTML에 실어 보내는
 * 상품 데이터(`self.__next_f.push` 스트림 안의 product 객체)를 꺼낸다(2026-10-17 실측).
 * 모양이 바뀌면 zod 검증이 던져 화면에 "불러오지 못했다"가 뜬다. 원스토어를 아는 파일은 여기 하나다.
 */

const PAGE_BASE = "https://m.onestore.co.kr/v2/ko-kr/app";
const TIMEOUT_MS = 10_000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "Accept-Language": "ko-KR,ko;q=0.9",
};
const PRODUCT_ID = /^\d{10}$/;
const LOUNGE_SITE_CODE = "PD016402";

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
  const fromPath = url.pathname.match(/\/app\/(\d{10})(?:\/|$)/)?.[1];
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

/** 스트림에서 `{"prodId":"{id}","prodNm"` 로 시작하는 객체 하나를 괄호를 세어 잘라 낸다. */
function extractProductObject(stream: string, productId: string): unknown {
  const start = stream.indexOf(`{"prodId":"${productId}","prodNm"`);
  if (start === -1) throw new Error("onestore product data not found");
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
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(stream.slice(start, i + 1));
    }
  }
  throw new Error("onestore product data is truncated");
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
  };
}

export async function fetchOneStoreProduct(productId: string): Promise<OneStoreProduct> {
  const response = await fetch(`${PAGE_BASE}/${productId}`, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) throw new OneStoreNotFoundError(productId);
  if (!response.ok) throw new Error(`onestore request failed: ${response.status}`);
  const stream = readFlightStream(await response.text());
  return mapOneStoreProduct(extractProductObject(stream, productId));
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
