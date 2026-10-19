import { describe, it, expect } from "vitest";
import { parseYouTubeId } from "@/lib/youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["https://youtu.be/Ky1PVk-TXu8", "Ky1PVk-TXu8"],
    ["https://youtu.be/Ky1PVk-TXu8?si=abc", "Ky1PVk-TXu8"],
    ["https://www.youtube.com/watch?v=Ky1PVk-TXu8&t=10s", "Ky1PVk-TXu8"],
    ["https://m.youtube.com/watch?v=Ky1PVk-TXu8", "Ky1PVk-TXu8"],
    ["https://www.youtube.com/embed/Ky1PVk-TXu8", "Ky1PVk-TXu8"],
    ["https://youtube.com/shorts/Ky1PVk-TXu8", "Ky1PVk-TXu8"],
    ["Ky1PVk-TXu8", "Ky1PVk-TXu8"],
  ])("reads %s", (input, expected) => {
    expect(parseYouTubeId(input)).toBe(expected);
  });

  it.each(["https://www.youtube.com/channel/UCdAzWy7LurRqUJ6BQTMZhPQ", "https://vimeo.com/123", "youtube", ""])("rejects %s", (input) => {
    expect(parseYouTubeId(input)).toBeNull();
  });
});
