/**
 * 브라우저에서 이미지를 JPG로 다시 저장해 maxBytes 아래로 줄인다(Vercel 요청 본문 상한 때문).
 * 먼저 원래 크기에서 품질만 낮춰 보고, 그래도 크면 가로세로를 줄여 가며 다시 시도한다.
 * JPG는 투명을 못 담아 검게 채워지므로 흰 바탕을 먼저 칠한다. 못 줄이면 null.
 */
const QUALITIES = [0.9, 0.82, 0.74];
const SCALES = [1, 0.8, 0.64, 0.5];

export async function shrinkImage(file: File, maxBytes: number): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  try {
    for (const scale of SCALES) {
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= maxBytes) {
          return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        }
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}
