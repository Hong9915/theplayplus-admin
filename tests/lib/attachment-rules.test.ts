import { describe, it, expect } from "vitest";
import { isMessageAttachmentPathOf, messageAttachmentPath, safeFileName } from "@/lib/attachment-rules";

describe("safeFileName", () => {
  it("keeps only characters Supabase Storage accepts in a key", () => {
    expect(safeFileName("보상 화면 (1).png", "image/png")).toBe("_______1_.png");
    expect(safeFileName("screen shot.JPG", "image/jpeg")).toBe("screen_shot.JPG");
  });

  it("falls back to a generic name when nothing meaningful is left", () => {
    expect(safeFileName("보상.png", "image/png")).toBe("image.png");
    expect(safeFileName("", "image/jpeg")).toBe("image.jpg");
    expect(safeFileName(null, "image/webp")).toBe("image.webp");
  });

  it("drops any directory part", () => {
    expect(safeFileName("../../etc/a.png", "image/png")).toBe("a.png");
  });
});

describe("message attachment paths", () => {
  it("only accepts paths under the inquiry's own messages folder", () => {
    const path = messageAttachmentPath("inq-1", "a.png", "u");
    expect(isMessageAttachmentPathOf("inq-1", path)).toBe(true);
    expect(isMessageAttachmentPathOf("inq-2", path)).toBe(false);
    expect(isMessageAttachmentPathOf("inq-1", "inq-1/screenshot.png")).toBe(false);
    expect(isMessageAttachmentPathOf("inq-1", "inq-1/messages/../../inq-2/x.png")).toBe(false);
  });
});
