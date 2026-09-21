import { z } from "zod";

export const gameFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  status: z.enum(["active", "ended"]).default("active"),
  ownerName: z.string().trim().optional().default(""),
  loungeUrl: z.string().trim().max(500).optional().default(""),
});

export type GameFormInput = z.infer<typeof gameFormSchema>;
