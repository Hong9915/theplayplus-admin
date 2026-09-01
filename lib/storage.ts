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
