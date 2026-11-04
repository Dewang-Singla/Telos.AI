export async function preparePhoto(
  file: File,
  maxDimension = 1920,
): Promise<Blob> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a JPEG, PNG or WebP under 5 MB.");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(
        1,
        maxDimension / Math.max(image.width, image.height),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing unavailable.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Invalid image."))),
        "image/webp",
        0.88,
      ),
    );
    if (blob.size > 5 * 1024 * 1024) throw new Error("Image is too large.");
    return blob;
  } finally {
    image.close();
  }
}
