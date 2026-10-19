const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * 유튜브 주소에서 영상 ID를 뽑는다. youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, /shorts/ID, /live/ID 를
 * 받고, 예전에 ID만 저장해 둔 값도 그대로 받는다. 유튜브 영상 주소가 아니면 null.
 */
export function parseYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (VIDEO_ID.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(?:www|m|music)\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
