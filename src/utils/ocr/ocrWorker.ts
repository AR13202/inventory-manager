// src/utils/ocr/ocrWorker.ts
import type { Worker } from "tesseract.js";

let workerInstance: Worker | null = null;
let isInitializing = false;
let initPromise: Promise<Worker> | null = null;

export interface OCRProgressCallback {
    (progress: number, status: string): void;
}

export interface OCRRunOptions {
    psm?: string;
    onProgress?: OCRProgressCallback;
}

/**
 * Lazily creates or returns the singleton Tesseract Web Worker
 */
export async function getOCRWorker(onProgress?: OCRProgressCallback): Promise<Worker> {
    if (typeof window === "undefined") {
        throw new Error("Tesseract Web Worker can only run in a browser environment.");
    }

    if (workerInstance) {
        return workerInstance;
    }

    if (isInitializing && initPromise) {
        return initPromise;
    }

    isInitializing = true;
    initPromise = (async () => {
        try {
            const { createWorker } = await import("tesseract.js");
            const worker = await createWorker("eng", 1, {
                logger: (m: { status?: string; progress?: number }) => {
                    if (onProgress && typeof m.progress === "number") {
                        onProgress(m.progress, m.status || "Processing OCR...");
                    }
                }
            });

            // Set parameters tailored for structured tabular bills & receipts at 300 DPI
            await worker.setParameters({
                user_defined_dpi: "300",
                tessedit_pageseg_mode: "4" as any, // Single column of variable text sizes / tabular layout
                preserve_interword_spaces: "1",
                tessjs_create_hocr: "0",
                tessjs_create_tsv: "0"
            });

            workerInstance = worker;
            return worker;
        } finally {
            isInitializing = false;
        }
    })();

    return initPromise;
}

/**
 * Executes OCR on a preprocessed image using the singleton Tesseract worker
 */
export async function runOCR(
    imageDataUrl: string,
    options?: OCRProgressCallback | OCRRunOptions
): Promise<{ text: string; confidence: number }> {
    const onProgress = typeof options === "function" ? options : options?.onProgress;
    const psm = typeof options === "object" ? options?.psm : undefined;

    const worker = await getOCRWorker(onProgress);

    if (psm) {
        await worker.setParameters({
            tessedit_pageseg_mode: psm as any
        });
    }

    const result = await worker.recognize(imageDataUrl);

    const text = result.data.text || "";
    const confidence = typeof result.data.confidence === "number" ? result.data.confidence : 0;

    return {
        text,
        confidence
    };
}

/**
 * Terminates the OCR worker to free memory when desired
 */
export async function terminateOCRWorker(): Promise<void> {
    if (workerInstance) {
        await workerInstance.terminate();
        workerInstance = null;
        initPromise = null;
        isInitializing = false;
    }
}
