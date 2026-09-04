// src/utils/ocr/ocrQuality.ts

export interface OCRQualityResult {
    score: number; // 0 to 100
    confidence: number; // 0 to 100
    wordCount: number;
    keywordMatches: string[];
    hasNumbers: boolean;
    hasDates: boolean;
    recommendation: "accept" | "retry_with_binarization" | "fallback_to_vision";
    reason: string;
}

const INVOICE_KEYWORDS = [
    "invoice", "tax", "bill", "gst", "gstin", "total", "amount", "qty",
    "quantity", "rate", "price", "date", "dated", "hsn", "sac", "cgst",
    "sgst", "igst", "utgst", "item", "description", "particulars",
    "subtotal", "grand", "round", "freight", "rupees", "rs", "inr"
];

const DATE_REGEX = /(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i;
const NUMBER_REGEX = /\d+[.,]?\d*/;
const GARBAGE_CHAR_REGEX = /[^a-zA-Z0-9\s.,/&%()#@:;!?-]/g;

/**
 * Assesses the quality and readability of OCR text extracted from a bill/invoice
 */
export function assessOCRQuality(
    rawText: string,
    tesseractConfidence: number = 0,
    isSecondPass: boolean = false
): OCRQualityResult {
    const text = String(rawText || "").trim();
    const lowerText = text.toLowerCase();

    if (!text || text.length < 20) {
        return {
            score: 0,
            confidence: tesseractConfidence,
            wordCount: 0,
            keywordMatches: [],
            hasNumbers: false,
            hasDates: false,
            recommendation: isSecondPass ? "fallback_to_vision" : "retry_with_binarization",
            reason: "Extracted text is empty or too short."
        };
    }

    // Split words
    const words = text.split(/\s+/).filter(w => w.length > 1);
    const wordCount = words.length;

    // Check invoice keywords
    const matchedKeywords = INVOICE_KEYWORDS.filter(kw => lowerText.includes(kw));

    // Check for numbers and dates
    const hasNumbers = NUMBER_REGEX.test(text);
    const hasDates = DATE_REGEX.test(text);

    // Garbage character ratio
    const garbageMatches = text.match(GARBAGE_CHAR_REGEX) || [];
    const garbageRatio = garbageMatches.length / (text.length || 1);

    // Scoring heuristics
    let score = 0;

    // 1. Tesseract confidence contributes up to 35 pts
    score += Math.min(35, Math.max(0, (tesseractConfidence / 100) * 35));

    // 2. Word count contributes up to 20 pts
    if (wordCount >= 30) score += 20;
    else if (wordCount >= 15) score += 12;
    else score += 5;

    // 3. Keyword matches contribute up to 25 pts
    const kwCount = matchedKeywords.length;
    if (kwCount >= 5) score += 25;
    else if (kwCount >= 3) score += 18;
    else if (kwCount >= 1) score += 10;

    // 4. Number & Date signals contribute up to 20 pts
    if (hasNumbers) score += 10;
    if (hasDates) score += 10;

    // Penalty for high garbage ratio
    if (garbageRatio > 0.25) {
        score -= 25;
    } else if (garbageRatio > 0.15) {
        score -= 10;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // Recommendation logic
    let recommendation: "accept" | "retry_with_binarization" | "fallback_to_vision";
    let reason: string;

    if (score >= 60 && kwCount >= 2) {
        recommendation = "accept";
        reason = `High OCR quality score (${score}/100) with ${kwCount} invoice keywords.`;
    } else if (score >= 45 && kwCount >= 1 && !isSecondPass) {
        recommendation = "accept";
        reason = `Acceptable OCR score (${score}/100). Ready for LLM semantic interpretation.`;
    } else if (!isSecondPass) {
        recommendation = "retry_with_binarization";
        reason = `Low OCR score (${score}/100, confidence: ${tesseractConfidence}%). Triggering enhanced second pass.`;
    } else {
        recommendation = "fallback_to_vision";
        reason = `Second pass OCR still yielded low score (${score}/100). Falling back to Vision LLM.`;
    }

    return {
        score,
        confidence: tesseractConfidence,
        wordCount,
        keywordMatches: matchedKeywords,
        hasNumbers,
        hasDates,
        recommendation,
        reason
    };
}
