// src/utils/imageCompressor.ts

/**
 * Compresses an image Data URL to its minimum byte size before network upload
 * Scales resolution to maxDimension (default 1600px) and applies lossy WebP/JPEG compression.
 */
export async function compressImageForUpload(
    dataUrl: string,
    maxDimension: number = 1600,
    quality: number = 0.72
): Promise<string> {
    if (typeof window === "undefined" || !dataUrl || typeof dataUrl !== "string") {
        return dataUrl;
    }

    // Skip non-image formats like PDFs
    if (!dataUrl.startsWith("data:image/")) {
        return dataUrl;
    }

    try {
        const img = new Image();
        img.crossOrigin = "anonymous";

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load image for compression"));
            img.src = dataUrl;
        });

        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
            if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
            } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
            }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return dataUrl;

        // Draw and compress onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Try modern WebP format first
        const webpData = canvas.toDataURL("image/webp", quality);
        if (webpData.startsWith("data:image/webp") && webpData.length < dataUrl.length) {
            return webpData;
        }

        // Fallback to optimized JPEG
        const jpegData = canvas.toDataURL("image/jpeg", quality);
        return jpegData.length < dataUrl.length ? jpegData : dataUrl;
    } catch (err) {
        console.warn("[Image Compression] Client compression failed, uploading original:", err);
        return dataUrl;
    }
}
