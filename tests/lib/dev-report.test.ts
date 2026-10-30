import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildDevReportWorkbook, devReportProblem, devReportTime, type DevReportInquiry } from "@/lib/dev-report";

// 1×1 투명 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

const base: DevReportInquiry = {
  occurredAt: "2026-10-29T21:30",
  createdAt: "2026-10-30T01:00:00.000Z",
  serverName: "1서버",
  characterId: "123456",
  characterName: "숲지기",
  title: "보상이 안 들어와요",
  content: "출석 보상이 우편함에 없습니다.",
  translations: {},
  screenshots: [],
};

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook.worksheets[0];
}

describe("devReportTime", () => {
  it("uses the occurrence time as written", () => {
    expect(devReportTime("2026-10-29T21:30", "2026-10-30T01:00:00.000Z")).toBe("2026-10-29 21:30");
  });

  it("falls back to the received time in Seoul", () => {
    expect(devReportTime(null, "2026-10-30T01:00:00.000Z")).toBe("2026-10-30 10:00");
  });
});

describe("devReportProblem", () => {
  it("joins title and content and appends the Chinese translation when present", () => {
    expect(devReportProblem(base)).toBe("보상이 안 들어와요\n출석 보상이 우편함에 없습니다.");
    expect(devReportProblem({ ...base, translations: { zh: "签到奖励没有到邮箱。" } })).toBe(
      "보상이 안 들어와요\n출석 보상이 우편함에 없습니다.\n\n[中文]\n签到奖励没有到邮箱。"
    );
  });
});

describe("buildDevReportWorkbook", () => {
  it("writes the two-language header and one row per inquiry", async () => {
    const sheet = await readBack(await buildDevReportWorkbook([base]));
    expect(sheet.getRow(1).values).toEqual([undefined, "시간", "서버(구역)", "캐릭터 ID", "캐릭터명", "문제", "문제 스크린샷", "문제 스크린샷"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "时间", "区服", "角色ID", "角色名", "问题", "问题截图", "问题截图"]);
    expect((sheet.getRow(3).values as unknown[]).slice(1, 6)).toEqual([
      "2026-10-29 21:30",
      "1서버",
      "123456",
      "숲지기",
      "보상이 안 들어와요\n출석 보상이 우편함에 없습니다.",
    ]);
  });

  it("embeds image attachments and widens the screenshot columns to the largest count", async () => {
    const shots = [1, 2, 3].map((n) => ({ fileName: `s${n}.png`, data: PNG }));
    const sheet = await readBack(await buildDevReportWorkbook([{ ...base, screenshots: shots }]));
    expect(sheet.getRow(1).cellCount).toBe(8);
    const images = sheet.getImages();
    expect(images).toHaveLength(3);
    expect(images.map((image) => Math.floor(image.range.tl.col))).toEqual([5, 6, 7]);
  });

  it("writes the file name when an attachment cannot be embedded", async () => {
    const sheet = await readBack(
      await buildDevReportWorkbook([{ ...base, screenshots: [{ fileName: "a.webp", data: Buffer.from("RIFF0000WEBP") }, { fileName: "b.png", data: null }] }])
    );
    expect(sheet.getImages()).toHaveLength(0);
    expect(sheet.getRow(3).getCell(6).value).toBe("a.webp");
    expect(sheet.getRow(3).getCell(7).value).toBe("b.png");
  });
});
