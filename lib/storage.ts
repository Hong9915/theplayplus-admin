export function getGameLogoPublicUrl(logoPath: string | null): string | null {
  if (!logoPath) {
    return null;
  }
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) {
    return null;
  }
  return `${baseUrl}/storage/v1/object/public/game-logos/${logoPath}`;
}

const MAX_BASE_LENGTH = 40;
const MAX_EXTENSION_LENGTH = 8;

/**
 * Supabase Storage rejects object keys that contain non-ASCII characters
 * ("Invalid key"), so a Korean logo filename such as `여신로고.png` can never be
 * used as-is. Keep only characters that are always safe in a key and fall back
 * to a generic base name when nothing readable survives.
 */
export function buildGameLogoPath(gameId: string, fileName: string, unique: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0;

  const rawExtension = hasExtension ? fileName.slice(dotIndex + 1) : "";
  const extension =
    /^[A-Za-z0-9]+$/.test(rawExtension) && rawExtension.length <= MAX_EXTENSION_LENGTH
      ? rawExtension.toLowerCase()
      : "";

  const rawBase = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const base =
    rawBase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_BASE_LENGTH)
      .replace(/-+$/, "") || "logo";

  return extension ? `${gameId}/${unique}-${base}.${extension}` : `${gameId}/${unique}-${base}`;
}
