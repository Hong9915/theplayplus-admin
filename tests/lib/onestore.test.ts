import { describe, it, expect, vi, afterEach } from "vitest";
import { OneStoreNotFoundError, fetchOneStoreProduct, mapOneStoreProduct, parseOneStoreProductId } from "@/lib/onestore";

const PRODUCT = {
  prodId: "0001007974",
  prodNm: "여신키우기: 방치형 RPG",
  categoryId: "DP01",
  categoryNm: "롤플레잉",
  useGrade: { code: "PD004403", minAge: 15, adultGrdYn: "N" },
  prodDesc: "켜두기만 해도 폭풍 성장! 여신들과 즐기는 방치형 RPG               네이버 공식 라운지에서 특별 쿠폰을 확인하세요! 🎁",
  prodExplain: "접속 즉시 SSS+ 여신 [달기] 증정!\r\n\r\n◆ 편안한 방치 플레이, 무리하지 않아도 강해진다!\r\n접속만 해도 보상 지급",
  statistics: { salesCnt: 9423 },
  descImage: { path: "https://img.onestore.co.kr/thumbnails/img_sac/0_0_A20_40%2Fdesc%2F0001007974_20260917172039.png", url: null },
  screenshotList: [
    { path: "https://img.onestore.co.kr/thumbnails/img_sac/0_0_A20_40%2Fpreview%2Fa.png", width: 1024, height: 578 },
    { path: "https://img.onestore.co.kr/thumbnails/img_sac/0_0_F20_95%2Fpreview%2Fb.jpg", width: 1024, height: 578 },
  ],
  siteList: [{ siteClsfCd: "PD016402", siteUrl: "https://game.naver.com/lounge/My_Goddess_Idle_RPG/home" }],
};

/** 원스토어 상품 페이지처럼, 다른 상품이 먼저 나오고 우리 상품이 flight 스트림 두 조각에 걸쳐 실린 HTML. */
function pageHtml(product: unknown) {
  const stream = `0:{"other":{"prodId":"0000000001","prodNm":"다른 게임"}}\n8:["$","$L1a",null,{"state":{"data":{"product":${JSON.stringify(product)}}}}]`;
  const half = Math.floor(stream.length / 2);
  const push = (chunk: string) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
  return `<html><body>${push(stream.slice(0, half))}${push(stream.slice(half))}</body></html>`;
}

describe("parseOneStoreProductId", () => {
  it.each([
    ["https://onesto.re/0001007974", "0001007974"],
    ["https://m.onestore.co.kr/v2/ko-kr/app/0001007974", "0001007974"],
    ["https://m.onestore.co.kr/mobilepoc/url/urlMapping.omp?param=0001007974", "0001007974"],
    ["https://onestore.co.kr/userpoc/game/view?prodId=0001007974", "0001007974"],
    [" 0001007974 ", "0001007974"],
  ])("reads %s", (input, expected) => {
    expect(parseOneStoreProductId(input)).toBe(expected);
  });

  it.each(["https://play.google.com/store/apps/details?id=x", "onesto.re/abc", "https://onesto.re/_2bZoU1F", ""])("rejects %s", (input) => {
    expect(parseOneStoreProductId(input)).toBeNull();
  });
});

describe("mapOneStoreProduct", () => {
  it("keeps the description as written and turns the age grade into a label", () => {
    const product = mapOneStoreProduct(PRODUCT);
    expect(product.title).toBe("여신키우기: 방치형 RPG");
    expect(product.genre).toBe("롤플레잉");
    expect(product.ageRating).toBe("15세 이용가");
    expect(product.description).toBe("접속 즉시 SSS+ 여신 [달기] 증정!\n\n◆ 편안한 방치 플레이, 무리하지 않아도 강해진다!\n접속만 해도 보상 지급");
    expect(product.tagline).toBe("켜두기만 해도 폭풍 성장! 여신들과 즐기는 방치형 RPG 네이버 공식 라운지에서 특별 쿠폰을 확인하세요! 🎁");
    expect(product.screenshotUrls).toHaveLength(2);
    expect(product.promoImageUrl).toContain("desc");
    expect(product.naverLoungeUrl).toBe("https://game.naver.com/lounge/My_Goddess_Idle_RPG/home");
    expect(product.url).toBe("https://onesto.re/0001007974");
  });

  it.each([
    [{ minAge: 0, adultGrdYn: "N" }, "전체 이용가"],
    [{ minAge: 19, adultGrdYn: "Y" }, "청소년 이용불가"],
    [null, null],
  ])("labels grade %j as %s", (useGrade, label) => {
    expect(mapOneStoreProduct({ ...PRODUCT, useGrade }).ageRating).toBe(label);
  });
});

describe("fetchOneStoreProduct", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finds this product in the page's data stream even after other products", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pageHtml(PRODUCT), { status: 200 })));
    const product = await fetchOneStoreProduct("0001007974");
    expect(product.title).toBe("여신키우기: 방치형 RPG");
    expect(product.description).toContain("◆ 편안한 방치 플레이");
  });

  it("throws a not-found error for a missing product", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(fetchOneStoreProduct("0000000000")).rejects.toBeInstanceOf(OneStoreNotFoundError);
  });

  it("throws when the page no longer carries product data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    await expect(fetchOneStoreProduct("0001007974")).rejects.toThrow(/not found/);
  });
});
