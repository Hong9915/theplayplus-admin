import { z } from "zod";

export const gameFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(["active", "ended"]).default("active"),
  ownerName: z.string().trim().optional().default(""),
  loungeUrl: z.string().trim().max(500).optional().default(""),
});

export type GameFormInput = z.infer<typeof gameFormSchema>;

const optionalHttpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), "url");

/** 게임 추가 폼의 "웹사이트 게임 페이지" 칸. 모두 선택이고, 나머지는 게임을 만든 뒤 편집 화면에서 채운다. */
export const gameSiteFormSchema = z
  .object({
    onestoreUrl: optionalHttpUrl,
    googlePlayUrl: optionalHttpUrl,
    appStoreUrl: optionalHttpUrl,
    slug: z
      .string()
      .trim()
      .max(60)
      .refine((value) => value === "" || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value), "slug"),
    releaseStatus: z.enum(["live", "prereg", "upcoming"]).default("live"),
    published: z.boolean().default(false),
    onestoreSync: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.published && value.slug === "") ctx.addIssue({ code: "custom", path: ["slug"], message: "required_to_publish" });
    if (value.onestoreSync && value.onestoreUrl === "") ctx.addIssue({ code: "custom", path: ["onestoreUrl"], message: "required_to_sync" });
  });

export type GameSiteFormInput = z.infer<typeof gameSiteFormSchema>;
