// src/utils/ocr/ocrCleanup.ts

/**
 * Repairs commonly misread characters in Indian GSTIN numbers:
 * GSTIN structure: 2 digits + 5 alpha (PAN) + 4 digits + 1 alpha + 1 alpha/digit (entity) + 'Z' + 1 check digit
 * Example: 04CBVPV5263L1ZR or 04AAOFV9565F1ZN
 */
function repairGSTIN(text: string): string {
    return text.replace(/\b([0-9OIl]{2})([A-Z0-9]{5})([0-9OIl]{4})([A-Z0-9]{1})([0-9A-Z]{1})([Z2])([0-9A-Z]{1})\b/gi, (match, p1, p2, p3, p4, p5, p6, p7) => {
        // Fix state code (first 2 digits)
        const state = p1.replace(/O/gi, "0").replace(/[Il]/g, "1");
        // Fix PAN chars (5 uppercase alpha)
        const panAlpha = p2.toUpperCase().replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
        // Fix PAN digits (4 digits)
        const panDigits = p3.replace(/O/gi, "0").replace(/[Il]/g, "1").replace(/S/gi, "5").replace(/B/g, "8");
        // Fix PAN entity letter (1 alpha)
        const panEntity = p4.toUpperCase().replace(/0/g, "O").replace(/1/g, "I");
        // Entity number
        const entityNum = p5.toUpperCase();
        // Standard 'Z'
        const zChar = "Z";
        // Check digit
        const checkChar = p7.toUpperCase();

        const repaired = `${state}${panAlpha}${panDigits}${panEntity}${entityNum}${zChar}${checkChar}`;
        return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/.test(repaired) ? repaired : match;
    });
}

/**
 * Cleans and normalizes OCR text without corrupting alphanumeric tokens,
 * product names, or vendor identifiers. Preserves line breaks for table reconstruction.
 */
export function cleanOCRText(rawText: string): string {
    if (!rawText) return "";

    const lines = rawText.split(/\r?\n/);
    const cleanedLines: string[] = [];

    for (const rawLine of lines) {
        let line = rawLine;

        // 1. Remove non-printable/control characters (except tab)
        line = line.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

        // 2. Normalize currency symbols and common invoice labels
        line = line.replace(/₹/g, "Rs. ");
        line = line.replace(/(\bRs\.?)\s*(\d)/gi, "Rs. $2");

        // 3. Remove vertical pipe table lines that OCR often misinterprets as I/l or noise
        line = line.replace(/\s*\|\s*/g, " ");

        // 4. Replace multiple consecutive spaces/tabs with single space (preserve indentation structure)
        line = line.replace(/[ \t]+/g, " ").trim();

        // 5. Skip lines that are only standalone OCR noise (e.g. single symbols like "~", "`", "^", "—", ";")
        if (/^[^a-zA-Z0-9]{1,3}$/.test(line)) {
            continue;
        }

        // 6. Repair GSTINs in line
        line = repairGSTIN(line);

        if (line.length > 0) {
            cleanedLines.push(line);
        }
    }

    return cleanedLines.join("\n");
}
