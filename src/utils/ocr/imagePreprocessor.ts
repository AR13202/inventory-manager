// src/utils/ocr/imagePreprocessor.ts

export interface PreprocessOptions {
    maxDimension?: number;
    mode?: "standard" | "illumination-normalized" | "local-adaptive" | "high-contrast" | "binarized";
    sharpen?: boolean;
    cleanBorders?: boolean;
}

/**
 * Loads an image from a Data URL or URL string into an HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error("Failed to load image for preprocessing: " + err));
        img.src = src;
    });
}

/**
 * Clears outer 1.5% margins to pure white (255) to suppress desk, clothing, and shadow artifacts
 */
function applyMarginCleanup(data: Uint8ClampedArray, width: number, height: number, marginPercent: number = 0.015) {
    const marginX = Math.round(width * marginPercent);
    const marginY = Math.round(height * marginPercent);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (x < marginX || x >= width - marginX || y < marginY || y >= height - marginY) {
                const idx = (y * width + x) * 4;
                data[idx] = 255;
                data[idx + 1] = 255;
                data[idx + 2] = 255;
                data[idx + 3] = 255;
            }
        }
    }
}

/**
 * Computes fast 2D integral image for O(1) area-sum queries
 */
function computeIntegralImage(lums: Uint8Array, width: number, height: number): Float64Array {
    const integral = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        let sum = 0;
        const rowOffset = y * width;
        const prevRowOffset = (y - 1) * width;
        for (let x = 0; x < width; x++) {
            sum += lums[rowOffset + x];
            if (y === 0) {
                integral[rowOffset + x] = sum;
            } else {
                integral[rowOffset + x] = integral[prevRowOffset + x] + sum;
            }
        }
    }
    return integral;
}

/**
 * Fast box blur using integral image for background illumination estimation
 */
function estimateIlluminationMap(
    integral: Float64Array,
    width: number,
    height: number,
    radius: number
): Uint8Array {
    const bg = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const y1 = Math.max(0, y - radius);
        const y2 = Math.min(height - 1, y + radius);
        const rowOffset = y * width;

        for (let x = 0; x < width; x++) {
            const x1 = Math.max(0, x - radius);
            const x2 = Math.min(width - 1, x + radius);

            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            let sum = integral[y2 * width + x2];
            if (y1 > 0) sum -= integral[(y1 - 1) * width + x2];
            if (x1 > 0) sum -= integral[y2 * width + (x1 - 1)];
            if (y1 > 0 && x1 > 0) sum += integral[(y1 - 1) * width + (x1 - 1)];

            bg[rowOffset + x] = Math.round(sum / count);
        }
    }
    return bg;
}

/**
 * Bradley-Roth Local Adaptive Thresholding using Integral Image (O(N) total)
 */
function applyBradleyAdaptiveThreshold(
    lums: Uint8Array,
    integral: Float64Array,
    data: Uint8ClampedArray,
    width: number,
    height: number,
    windowSizeRatio: number = 0.06,
    thresholdPercentage: number = 14
) {
    const radius = Math.max(8, Math.round((width * windowSizeRatio) / 2));
    const factor = (100 - thresholdPercentage) / 100;

    for (let y = 0; y < height; y++) {
        const y1 = Math.max(0, y - radius);
        const y2 = Math.min(height - 1, y + radius);
        const rowOffset = y * width;

        for (let x = 0; x < width; x++) {
            const x1 = Math.max(0, x - radius);
            const x2 = Math.min(width - 1, x + radius);

            const count = (x2 - x1 + 1) * (y2 - y1 + 1);
            let sum = integral[y2 * width + x2];
            if (y1 > 0) sum -= integral[(y1 - 1) * width + x2];
            if (x1 > 0) sum -= integral[y2 * width + (x1 - 1)];
            if (y1 > 0 && x1 > 0) sum += integral[(y1 - 1) * width + (x1 - 1)];

            const mean = sum / count;
            const lum = lums[rowOffset + x];
            const val = lum < mean * factor ? 0 : 255;

            const idx = (rowOffset + x) * 4;
            data[idx] = val;
            data[idx + 1] = val;
            data[idx + 2] = val;
            data[idx + 3] = 255;
        }
    }
}

/**
 * Applies illumination division and histogram stretch to completely cancel shadows & creases
 */
function applyIlluminationNormalization(
    lums: Uint8Array,
    bg: Uint8Array,
    data: Uint8ClampedArray,
    width: number,
    height: number
) {
    const total = width * height;
    const normalized = new Uint8Array(total);

    let minVal = 255;
    let maxVal = 0;

    for (let i = 0; i < total; i++) {
        const background = Math.max(1, bg[i]);
        // Normalize: (original / background) * 255
        const norm = Math.min(255, Math.round((lums[i] / background) * 230));
        normalized[i] = norm;
        if (norm < minVal) minVal = norm;
        if (norm > maxVal) maxVal = norm;
    }

    const range = maxVal - minVal || 1;

    for (let i = 0; i < total; i++) {
        // Stretch histogram with S-curve text boosting
        let val = ((normalized[i] - minVal) / range) * 255;
        // Mild gamma correction to make ink crisp and paper pure white
        val = 255 * Math.pow(val / 255, 1.25);
        const finalVal = Math.min(255, Math.max(0, Math.round(val)));

        const idx = i * 4;
        data[idx] = finalVal;
        data[idx + 1] = finalVal;
        data[idx + 2] = finalVal;
        data[idx + 3] = 255;
    }
}

/**
 * Computes optimal binarization threshold using Otsu's method
 */
function computeOtsuThreshold(lums: Uint8Array): number {
    const histogram = new Array(256).fill(0);
    const total = lums.length;

    for (let i = 0; i < total; i++) {
        histogram[lums[i]]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
        sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;

        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;

        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }

    return threshold;
}

/**
 * Applies a 3x3 unsharp masking kernel to sharpen text edges
 */
function applySharpen(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const imgData = ctx.getImageData(0, 0, width, height);
    const src = imgData.data;
    const output = ctx.createImageData(width, height);
    const dst = output.data;

    // 3x3 Laplacian sharpening kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const top = ((y - 1) * width + x) * 4;
            const btm = ((y + 1) * width + x) * 4;
            const lft = (y * width + (x - 1)) * 4;
            const rgt = (y * width + (x + 1)) * 4;

            for (let c = 0; c < 3; c++) {
                const val = 5 * src[idx + c] - src[top + c] - src[btm + c] - src[lft + c] - src[rgt + c];
                dst[idx + c] = Math.min(255, Math.max(0, val));
            }
            dst[idx + 3] = 255;
        }
    }

    ctx.putImageData(output, 0, 0);
}

/**
 * Preprocesses an image on the browser canvas for optimal Tesseract OCR
 */
export async function preprocessImage(
    input: string | HTMLImageElement,
    options: PreprocessOptions = {}
): Promise<string> {
    if (typeof window === "undefined") {
        throw new Error("preprocessImage can only be executed in a browser environment.");
    }

    const {
        maxDimension = 2600, // 2600px gives ~300 DPI for standard receipt & A4 documents
        mode = "illumination-normalized",
        sharpen = true,
        cleanBorders = true
    } = options;

    const img = typeof input === "string" ? await loadImage(input) : input;

    // Calculate dimensions maintaining aspect ratio
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

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
        throw new Error("Unable to obtain 2D rendering context for Canvas.");
    }

    // Draw base image onto canvas
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const totalPixels = width * height;

    // 1. Extract Luminance array
    const lums = new Uint8Array(totalPixels);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        lums[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // 2. Compute 2D Integral Image
    const integral = computeIntegralImage(lums, width, height);

    // 3. Apply selected enhancement mode
    if (mode === "local-adaptive" || mode === "binarized") {
        applyBradleyAdaptiveThreshold(lums, integral, data, width, height, 0.05, 12);
    } else if (mode === "high-contrast") {
        const threshold = computeOtsuThreshold(lums);
        for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const val = lums[j] > threshold ? 255 : 0;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
            data[i + 3] = 255;
        }
    } else {
        // "illumination-normalized" (Default: optimal shadow removal + contrast)
        const bgRadius = Math.max(16, Math.round(width * 0.035));
        const bg = estimateIlluminationMap(integral, width, height, bgRadius);
        applyIlluminationNormalization(lums, bg, data, width, height);
    }

    // 4. Suppress edge/margin background clutter (table surfaces, hands, dark shadows)
    if (cleanBorders) {
        applyMarginCleanup(data, width, height, 0.015);
    }

    ctx.putImageData(imageData, 0, 0);

    // 5. Sharpen text contours if requested
    if (sharpen) {
        applySharpen(ctx, width, height);
    }

    return canvas.toDataURL("image/png");
}
