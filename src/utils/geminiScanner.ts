// src/utils/geminiScanner.ts
import { preprocessImage } from "./ocr/imagePreprocessor";
import { runOCR } from "./ocr/ocrWorker";
import { assessOCRQuality } from "./ocr/ocrQuality";
import { cleanOCRText } from "./ocr/ocrCleanup";

export interface ScannedReceiptData {
    parentCompanyDetails?: {
        name?: string;
        gst?: string;
        address?: string;
        phoneNumbers?: string;
    };
    customerCompanyDetails?: {
        name?: string;
        gst?: string;
        address?: string;
        phoneNumbers?: string;
    };
    date?: string;
    billNumber?: string;
    billType?: "Purchase" | "Sale" | "Unknown";
    taxAmount?: number;
    taxPercentage?: number;
    taxDetails?: {
        taxAmount?: number;
        taxType?: string;
        taxPercentage?: number;
    }[];
    freightAndForwardingCharges?: number;
    roundOff?: number;
    totalAmount?: number;
    items?: {
        name?: string;
        quantity?: number;
        unit?: string;
        hsn?: string;
        price?: number;
        category?: string;
    }[];
}

export interface ScanProviderError {
    provider: string;
    message: string;
}

export type ScanProgressCallback = (phase: string) => void;

/**
 * Sends either OCR text or an image/images payload to the server-side extraction API
 */
async function callScanApi(payload: { ocrText?: string; image?: string; images?: string[] }) {
    const response = await fetch("/api/bills/scan", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
        const providerErrors = Array.isArray(data.errors)
            ? (data.errors as ScanProviderError[])
                .map((entry) => `${String(entry.provider || "provider")}: ${String(entry.message || "Unknown error")}`)
                .join(" | ")
            : "";
        const errorMessage = providerErrors
            ? `${data.error || "Failed to scan receipt."} ${providerErrors}`
            : (data.error || "Failed to scan receipt.");
        throw new Error(errorMessage);
    }

    return data.data as ScannedReceiptData;
}

/**
 * High-accuracy multi-page invoice scanner pipeline:
 * 1. Sequentially processes all invoice pages through Canvas Preprocessing (300 DPI + Illumination Normalization)
 * 2. Runs Tesseract OCR on each page with real-time multi-page progress reporting
 * 3. Assesses quality and applies adaptive passes per page
 * 4. Merges multi-page OCR text with structured page headers
 * 5. Calls server LLM to extract unified single invoice JSON (all items concatenated)
 * 6. Gracefully falls back to Multi-Image Vision AI if needed
 */
export async function scanReceipt(
    files: string | string[],
    onProgress?: ScanProgressCallback
): Promise<ScannedReceiptData> {
    const fileList = Array.isArray(files) ? files.filter(Boolean) : [files].filter(Boolean);

    if (fileList.length === 0) {
        throw new Error("No files provided for scanning.");
    }

    const isBrowser = typeof window !== "undefined";
    const totalPages = fileList.length;

    // Check if any non-image files (e.g. PDFs) exist
    const hasPdf = fileList.some((url) => !url.startsWith("data:image/") && !/\.(jpg|jpeg|png|webp|bmp)$/i.test(url));

    // If PDF or non-browser environment, route directly to Vision / Server API
    if (!isBrowser || hasPdf) {
        onProgress?.(totalPages > 1 ? `Analyzing ${totalPages} invoice pages with Vision AI...` : "Analyzing document with Vision AI...");
        return callScanApi({ images: fileList });
    }

    try {
        const pageTexts: string[] = [];
        let needsVisionFallback = false;

        for (let i = 0; i < totalPages; i++) {
            const fileDataUrl = fileList[i];
            const pagePrefix = totalPages > 1 ? `Page ${i + 1}/${totalPages}: ` : "";

            // --- Step 1: Preprocess Image (Pass 1: Illumination Normalization @ 2600px 300 DPI) ---
            onProgress?.(`${pagePrefix}Removing shadows & preparing scan...`);
            const preprocessedDataUrl = await preprocessImage(fileDataUrl, {
                maxDimension: 2600,
                mode: "illumination-normalized",
                sharpen: true,
                cleanBorders: true
            });

            // --- Step 2: Client-side Web Worker OCR (Pass 1) ---
            onProgress?.(`${pagePrefix}Scanning page text...`);
            const pass1 = await runOCR(preprocessedDataUrl, {
                psm: "4",
                onProgress: (progress) => {
                    const pct = Math.min(99, Math.round(progress * 100));
                    onProgress?.(`${pagePrefix}Reading text (${pct}%)`);
                }
            });

            // --- Step 3: Multi-signal Quality Assessment ---
            const quality1 = assessOCRQuality(pass1.text, pass1.confidence, false);
            console.log(`[OCR Quality Page ${i + 1} Pass 1]`, quality1);

            let pageOcrText = pass1.text;

            // --- Step 4: Intelligent Second Pass if needed ---
            if (quality1.recommendation === "retry_with_binarization") {
                onProgress?.(`${pagePrefix}Enhancing fine text & contrast...`);
                const adaptiveDataUrl = await preprocessImage(fileDataUrl, {
                    maxDimension: 2600,
                    mode: "local-adaptive",
                    cleanBorders: true
                });

                const pass2 = await runOCR(adaptiveDataUrl, {
                    psm: "6",
                    onProgress: (progress) => {
                        const pct = Math.min(99, Math.round(progress * 100));
                        onProgress?.(`${pagePrefix}Re-reading text (${pct}%)`);
                    }
                });

                const quality2 = assessOCRQuality(pass2.text, pass2.confidence, true);
                console.log(`[OCR Quality Page ${i + 1} Pass 2]`, quality2);

                if (quality2.score >= quality1.score) {
                    pageOcrText = pass2.text;
                }

                if (quality2.recommendation === "fallback_to_vision" && quality1.score < 30) {
                    needsVisionFallback = true;
                }
            } else if (quality1.recommendation === "fallback_to_vision") {
                needsVisionFallback = true;
            }

            const cleanedPageText = cleanOCRText(pageOcrText);
            if (totalPages > 1) {
                pageTexts.push(`=== INVOICE PAGE ${i + 1} OF ${totalPages} ===\n${cleanedPageText}`);
            } else {
                pageTexts.push(cleanedPageText);
            }
        }

        const combinedText = pageTexts.join("\n\n").trim();

        if (needsVisionFallback || !combinedText || combinedText.length < 20) {
            onProgress?.(`Interpreting ${totalPages} pages with Vision AI...`);
            return callScanApi({ images: fileList });
        }

        onProgress?.(totalPages > 1 ? `Extracting data from ${totalPages} pages...` : "Understanding bill...");
        return await callScanApi({ ocrText: combinedText });

    } catch (clientOcrError) {
        console.warn("[OCR Multi-page Pipeline Warning] Falling back to Vision AI:", clientOcrError);
        onProgress?.(`Interpreting with Vision AI...`);
        return callScanApi({ images: fileList });
    }
}
