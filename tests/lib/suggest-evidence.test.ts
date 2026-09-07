import { describe, it, expect } from "vitest";
import { EVIDENCE_DELIMITER, splitSuggestion } from "@/lib/suggest-evidence";

describe("splitSuggestion", () => {
  it("returns the whole text as body when there is no delimiter", () => {
    expect(splitSuggestion("안녕하세요.\n확인 후 안내드리겠습니다.")).toEqual({
      body: "안녕하세요.\n확인 후 안내드리겠습니다.",
      evidence: [],
    });
  });

  it("splits the body from the evidence lines and strips list markers", () => {
    const text = `안녕하세요.\n${EVIDENCE_DELIMITER}\n- VIP 시트 VIP 탭 7행\n1. 과거 답변 R-20260902-0001\n\n• 운영 가이드 문서 '환불' 항목\n`;
    expect(splitSuggestion(text)).toEqual({
      body: "안녕하세요.\n",
      evidence: ["VIP 시트 VIP 탭 7행", "과거 답변 R-20260902-0001", "운영 가이드 문서 '환불' 항목"],
    });
  });

  it("treats '없음' as no evidence", () => {
    expect(splitSuggestion(`본문\n${EVIDENCE_DELIMITER}\n없음`)).toEqual({ body: "본문\n", evidence: [] });
  });

  it("holds back a partial delimiter at the end of a streaming chunk", () => {
    expect(splitSuggestion("본문\n=== 근")).toEqual({ body: "본문\n", evidence: [] });
    expect(splitSuggestion("본문\n=")).toEqual({ body: "본문\n", evidence: [] });
  });

  it("does not treat an equals sign inside the body as a delimiter", () => {
    expect(splitSuggestion("a = b 입니다.")).toEqual({ body: "a = b 입니다.", evidence: [] });
  });
});
