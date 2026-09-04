import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;

const extractionSchemaPrompt = `
Return this exact JSON schema:
{
  "parentCompanyDetails": {
    "name": "",
    "gst": "",
    "address": "",
    "phoneNumbers": ""
  },
  "customerCompanyDetails": {
    "name": "",
    "gst": "",
    "address": "",
    "phoneNumbers": ""
  },
  "date": "YYYY-MM-DD",
  "billNumber": "",
  "billType": "Purchase or Sale or Unknown",
  "taxAmount": 0,
  "taxPercentage": 0,
  "taxDetails": [
    {
      "taxType": "CGST / SGST / IGST / UTGST / Tax",
      "taxPercentage": 0,
      "taxAmount": 0
    }
  ],
  "freightAndForwardingCharges": 0,
  "roundOff": 0,
  "totalAmount": 0,
  "items": [
    {
      "name": "",
      "hsn": "",
      "quantity": 0,
      "unit": "",
      "price": 0,
      "category": "Trade"
    }
  ]
}
`;

const visionPrompt = `
You are an expert OCR and invoice data extraction system. Analyze the provided invoice/bill image(s) with extreme care and return ONLY raw JSON — no markdown, no explanation, no code fences.

CRITICAL MULTI-PAGE & EXTRACTION RULES:

## Multi-Page Invoice Handling
- The input may contain 1, 2, 3, or more pages belonging to THE SAME SINGLE INVOICE.
- Combine and extract ALL line items across ALL pages sequentially into the single "items" array.
- Do NOT stop after the first page. Extract every single product row across all pages without omission.
- The Seller/Buyer details, Bill Number, and Date are typically on Page 1 or repeated in page headers.
- The final Tax Summary, Round Off, Freight, and Grand Total are typically on the last page.

## Company Identification
- "parentCompanyDetails" = the SELLER / ISSUER of the invoice (whose letterhead/logo is at the top, who signed it as "Authorised Signatory")
- "customerCompanyDetails" = the BUYER / "Billed To" party
- Always extract GST numbers for BOTH parties if visible anywhere on the document

## Bill Number & Date
- Look for: Invoice No., Bill No., Voucher No., Sr. No. at the top of the document
- Date: Look for Date, Dated, Invoice Date fields. Format as YYYY-MM-DD.

## billType Logic
- If the parentCompanyDetails company is the one ISSUING/SELLING → "Sale"
- If the document was received FROM a supplier (i.e., you are the buyer in customerCompanyDetails) → "Purchase"
- If "Alliance Engineering" is in "Billed To / Shipped To", it's a Purchase invoice FOR Alliance Engineering

## Items Extraction — MOST CRITICAL SECTION
- Read EVERY row in the items table across all pages meticulously
- Match each item's: description, HSN/SAC code, quantity, unit, and unit price (Rate column)
- "price" = unit rate per item, NOT the line total
- Do NOT confuse line total (Amount) with unit price (Rate/Price)
- Do NOT skip any line items — count all rows across all pages carefully before finalizing

## Tax Details & Grand Total
- Extract EACH tax component separately: CGST, SGST, IGST, UTGST etc.
- top-level taxAmount = SUM of all tax components
- totalAmount = Grand Total / Total Amount After Tax (the final payable amount)

${extractionSchemaPrompt}
`;

const textPrompt = `
You are an expert invoice data extraction system. You are given raw OCR text extracted from an invoice or bill (which may span multiple pages).
Your job is to interpret this unstructured OCR text, accurately extract all required invoice fields across all pages, and return ONLY raw JSON matching the required schema — no markdown, no explanation, no code fences.

CRITICAL MULTI-PAGE & EXTRACTION INSTRUCTIONS:
1. Multi-Page Fusion: The text may contain multiple pages (marked by "=== INVOICE PAGE X OF Y ==="). Combine all line items across all pages sequentially into the single "items" list.
2. "parentCompanyDetails": The SELLER / ISSUER (usually at the top of the bill, or under 'Consignor'/'Supplier'/'From'). Extract their Name, GSTIN (15-character GST number), Address, and Phone.
3. "customerCompanyDetails": The BUYER / CUSTOMER (under 'Billed To' / 'Consignee' / 'Buyer' / 'To'). Extract their Name, GSTIN, Address, and Phone.
4. "billNumber": Look for "Invoice No", "Bill No", "Inv No", "Voucher No", "Sr No".
5. "date": Look for "Date", "Dated", "Invoice Date". Format as YYYY-MM-DD.
6. "billType": Set to "Purchase" if billed to us / received from supplier, or "Sale" if we are issuing the bill.
7. "items": Extract EVERY item row across all pages.
   - Match item description/name, HSN/SAC code, quantity, unit (e.g. PCS, NOS, KGS, MTR, SET), and unit rate (Price).
   - "price" is unit rate, NOT total amount.
   - Do not skip line items.
8. "taxDetails": Extract CGST, SGST, IGST, UTGST as separate tax rows with percentage and rupee amount.
9. "freightAndForwardingCharges", "roundOff", and "totalAmount": Extract from final summary/total rows.
10. Do not invent missing data. If not found in text, leave as empty string or 0.

${extractionSchemaPrompt}
`;

type ScanProvider = "openrouter" | "gemini" | "groq";

type CompanyDetails = {
    name: string;
    gst: string;
    address: string;
    phoneNumbers: string;
};

type TaxDetail = {
    taxType: string;
    taxPercentage: number;
    taxAmount: number;
};

type ScannedItem = {
    name: string;
    hsn: string;
    quantity: number;
    unit: string;
    price: number;
    category: string;
};

type NormalizedScanReceiptData = {
    parentCompanyDetails: CompanyDetails;
    customerCompanyDetails: CompanyDetails;
    date: string;
    billNumber: string;
    billType: "Purchase" | "Sale" | "Unknown";
    taxAmount: number;
    taxPercentage: number;
    taxDetails: TaxDetail[];
    freightAndForwardingCharges: number;
    roundOff: number;
    totalAmount: number;
    items: ScannedItem[];
};

type ProviderError = {
    provider: ScanProvider;
    message: string;
};

function normalizeString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const cleaned = value.replace(/,/g, "").trim();
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function normalizeBillType(value: unknown): NormalizedScanReceiptData["billType"] {
    const normalized = normalizeString(value).toLowerCase();
    if (normalized === "purchase") return "Purchase";
    if (normalized === "sale") return "Sale";
    return "Unknown";
}

function normalizeCompanyDetails(value: unknown): CompanyDetails {
    const objectValue = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    return {
        name: normalizeString(objectValue.name),
        gst: normalizeString(objectValue.gst),
        address: normalizeString(objectValue.address),
        phoneNumbers: normalizeString(objectValue.phoneNumbers)
    };
}

function normalizeTaxDetails(value: unknown): TaxDetail[] {
    if (!Array.isArray(value)) return [];
    return value.map((tax) => {
        const objectValue = typeof tax === "object" && tax !== null ? (tax as Record<string, unknown>) : {};
        return {
            taxType: normalizeString(objectValue.taxType) || "Tax",
            taxPercentage: normalizeNumber(objectValue.taxPercentage),
            taxAmount: normalizeNumber(objectValue.taxAmount)
        };
    });
}

function normalizeItems(value: unknown): ScannedItem[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const objectValue = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
        return {
            name: normalizeString(objectValue.name),
            hsn: normalizeString(objectValue.hsn),
            quantity: normalizeNumber(objectValue.quantity) || 1,
            unit: normalizeString(objectValue.unit),
            price: normalizeNumber(objectValue.price),
            category: normalizeString(objectValue.category) || "Trade"
        };
    });
}

function normalizeScanResponse(value: unknown): NormalizedScanReceiptData {
    const objectValue = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const taxDetails = normalizeTaxDetails(objectValue.taxDetails);

    return {
        parentCompanyDetails: normalizeCompanyDetails(objectValue.parentCompanyDetails),
        customerCompanyDetails: normalizeCompanyDetails(objectValue.customerCompanyDetails),
        date: normalizeString(objectValue.date),
        billNumber: normalizeString(objectValue.billNumber),
        billType: normalizeBillType(objectValue.billType),
        taxAmount: normalizeNumber(objectValue.taxAmount),
        taxPercentage: normalizeNumber(objectValue.taxPercentage),
        taxDetails,
        freightAndForwardingCharges: normalizeNumber(objectValue.freightAndForwardingCharges),
        roundOff: normalizeNumber(objectValue.roundOff),
        totalAmount: normalizeNumber(objectValue.totalAmount),
        items: normalizeItems(objectValue.items)
    };
}

function extractJsonText(value: string) {
    return value.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function parseBase64Image(image: string) {
    const [metadataPart, base64Data = image] = String(image).split(",");
    const mimeTypeMatch = metadataPart.match(/data:(.*?);base64/);
    return {
        base64Data,
        mimeType: mimeTypeMatch?.[1] || "image/jpeg",
        dataUrl: metadataPart.includes("base64") ? image : `data:image/jpeg;base64,${image}`
    };
}

// ==========================================
// TEXT LLM PARSERS (FREE & ULTRA FAST)
// ==========================================

const OPENROUTER_TEXT_MODELS = [
    "minimax/minimax-m3:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-exp:free",
    "google/gemini-2.0-flash-thinking-exp:free",
    "mistralai/mistral-7b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free"
];

async function scanTextWithOpenRouter(ocrText: string) {
    if (!openRouterApiKey) {
        throw new Error("OpenRouter API key is not configured.");
    }

    let lastError: Error = new Error("No text models available.");

    for (const model of OPENROUTER_TEXT_MODELS) {
        try {
            console.log(`[bill-scan-text] trying OpenRouter model: ${model}`);
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${openRouterApiKey}`,
                    "Content-Type": "application/json",
                    "X-Title": "Invoice Scanner OCR"
                },
                body: JSON.stringify({
                    model,
                    temperature: 0,
                    messages: [
                        { role: "system", content: textPrompt },
                        { role: "user", content: `Here is the OCR text from the invoice:\n\n${ocrText}` }
                    ]
                })
            });

            if (response.status === 429 || response.status >= 500) {
                lastError = new Error(`Model ${model} HTTP ${response.status}`);
                continue;
            }

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error?.message || `OpenRouter request failed: ${response.status}`);
            }

            const payload = await response.json();
            const content = payload?.choices?.[0]?.message?.content;
            const text = Array.isArray(content)
                ? content.map((entry: { text?: string }) => entry?.text || "").join("")
                : String(content || "");

            if (!text.trim()) continue;

            const json = JSON.parse(extractJsonText(text));
            console.log(`[bill-scan-text] succeeded with model: ${model}`);
            return json;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[bill-scan-text] Model ${model} failed: ${lastError.message}`);
        }
    }

    throw new Error(`All OpenRouter text models failed. Last error: ${lastError.message}`);
}

async function scanTextWithGroq(ocrText: string) {
    if (!groqApiKey) {
        throw new Error("Groq API key is not configured.");
    }

    const groq = new Groq({ apiKey: groqApiKey });
    const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        messages: [
            { role: "system", content: textPrompt },
            { role: "user", content: `Here is the OCR text from the invoice:\n\n${ocrText}` }
        ],
        response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    const text = Array.isArray(content)
        ? content.map((entry) => ("text" in entry ? entry.text || "" : "")).join("")
        : String(content || "");

    if (!text.trim()) {
        throw new Error("Groq text extraction returned empty response.");
    }

    return JSON.parse(extractJsonText(text));
}

async function scanTextWithGemini(ocrText: string) {
    if (!geminiApiKey) {
        throw new Error("Gemini API key is not configured.");
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const result = await model.generateContent([
        textPrompt,
        `Here is the OCR text from the invoice:\n\n${ocrText}`
    ]);

    return JSON.parse(extractJsonText(result.response.text()));
}

async function scanOCRWithFallback(ocrText: string) {
    const providers: Array<{ name: ScanProvider; scan: (text: string) => Promise<unknown> }> = [
        { name: "openrouter", scan: scanTextWithOpenRouter },
        { name: "groq", scan: scanTextWithGroq },
        { name: "gemini", scan: scanTextWithGemini }
    ];
    const errors: ProviderError[] = [];

    for (const provider of providers) {
        try {
            console.log(`[bill-scan-ocr] trying provider: ${provider.name}`);
            const parsed = await provider.scan(ocrText);
            console.log(`[bill-scan-ocr] provider succeeded: ${provider.name}`);
            return {
                provider: provider.name,
                data: normalizeScanResponse(parsed),
                errors
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown scanning error.";
            console.error(`[bill-scan-ocr] provider failed: ${provider.name}`, error);
            errors.push({ provider: provider.name, message });
        }
    }

    throw Object.assign(new Error("Failed to interpret OCR text with LLM."), { providerErrors: errors });
}

// ==========================================
// MULTIMODAL VISION LLM PARSERS (FALLBACK)
// ==========================================

const OPENROUTER_VISION_MODELS = [
    "minimax/minimax-m3:free",
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-3-27b-it:free",
    "qwen/qwen2.5-vl-72b-instruct:free",
    "qwen/qwen2.5-vl-32b-instruct:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "google/gemma-3-12b-it:free"
];

async function scanWithGemini(images: string[]) {
    if (!geminiApiKey) {
        throw new Error("Gemini API key is not configured.");
    }

    const imageParts = images.map((img) => {
        const { base64Data, mimeType } = parseBase64Image(img);
        return {
            inlineData: {
                data: base64Data,
                mimeType
            }
        };
    });

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const result = await model.generateContent([
        visionPrompt,
        ...imageParts
    ]);

    return JSON.parse(extractJsonText(result.response.text()));
}

async function scanWithGroq(images: string[]) {
    if (!groqApiKey) {
        throw new Error("Groq API key is not configured.");
    }

    const imageContents = images.map((img) => {
        const { dataUrl } = parseBase64Image(img);
        return { type: "image_url" as const, image_url: { url: dataUrl } };
    });

    const groq = new Groq({ apiKey: groqApiKey });
    const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: visionPrompt },
                    ...imageContents
                ]
            }
        ],
        response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    const text = Array.isArray(content)
        ? content.map((entry) => ("text" in entry ? entry.text || "" : "")).join("")
        : String(content || "");

    if (!text.trim()) {
        throw new Error("Groq returned an empty response.");
    }

    return JSON.parse(extractJsonText(text));
}

async function scanWithOpenRouter(images: string[]) {
    if (!openRouterApiKey) {
        throw new Error("OpenRouter API key is not configured.");
    }

    const imageContents = images.map((img) => {
        const { dataUrl } = parseBase64Image(img);
        return { type: "image_url", image_url: { url: dataUrl } };
    });

    let lastError: Error = new Error("No models available.");

    for (const model of OPENROUTER_VISION_MODELS) {
        try {
            console.log(`[bill-scan-vision] Scanning with OpenRouter model: ${model}`);

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${openRouterApiKey}`,
                    "Content-Type": "application/json",
                    "X-Title": "Invoice Scanner Vision"
                },
                body: JSON.stringify({
                    model,
                    temperature: 0,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: visionPrompt },
                                ...imageContents
                            ]
                        }
                    ]
                })
            });

            if (response.status === 500 || response.status === 529 || response.status === 503 || response.status === 429) {
                lastError = new Error(`Model ${model} HTTP ${response.status}`);
                continue;
            }

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error?.message || `OpenRouter request failed with status ${response.status}`);
            }

            const payload = await response.json();
            const content = payload?.choices?.[0]?.message?.content;
            const text = Array.isArray(content)
                ? content.map((entry: { text?: string }) => entry?.text || "").join("")
                : String(content || "");

            if (!text.trim()) continue;

            return JSON.parse(extractJsonText(text));
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`[bill-scan-vision] Model ${model} failed: ${lastError.message}`);
        }
    }

    throw new Error(`All OpenRouter vision models failed. Last error: ${lastError.message}`);
}

async function scanWithFallback(images: string[]) {
    const providers: Array<{ name: ScanProvider; scan: (imgs: string[]) => Promise<unknown> }> = [
        { name: "openrouter", scan: scanWithOpenRouter },
        { name: "gemini", scan: scanWithGemini },
        { name: "groq", scan: scanWithGroq }
    ];
    const errors: ProviderError[] = [];

    for (const provider of providers) {
        try {
            console.log(`[bill-scan-vision] trying provider: ${provider.name}`);
            const parsed = await provider.scan(images);
            console.log(`[bill-scan-vision] provider succeeded: ${provider.name}`);
            return {
                provider: provider.name,
                data: normalizeScanResponse(parsed),
                errors
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown scanning error.";
            console.error(`[bill-scan-vision] provider failed: ${provider.name}`, error);
            errors.push({ provider: provider.name, message });
        }
    }

    throw Object.assign(new Error("Failed to scan receipt via vision models."), { providerErrors: errors });
}

// ==========================================
// HTTP HANDLER
// ==========================================

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { ocrText, image, images } = body;

        // Path A: Fast Client OCR Text provided
        if (typeof ocrText === "string" && ocrText.trim().length > 0) {
            const result = await scanOCRWithFallback(ocrText.trim());
            return NextResponse.json({
                success: true,
                mode: "ocr_text",
                provider: result.provider,
                data: result.data
            });
        }

        // Path B: Vision Image(s) Fallback
        const imagesList: string[] = Array.isArray(images) && images.length > 0
            ? images
            : (typeof image === "string" && image.length > 0 ? [image] : []);

        if (imagesList.length > 0) {
            const result = await scanWithFallback(imagesList);
            return NextResponse.json({
                success: true,
                mode: "vision_image",
                provider: result.provider,
                data: result.data
            });
        }

        return NextResponse.json({ success: false, error: "Neither ocrText nor images were provided." }, { status: 400 });
    } catch (error: unknown) {
        const providerErrors = Array.isArray((error as { providerErrors?: ProviderError[] })?.providerErrors)
            ? (error as { providerErrors: ProviderError[] }).providerErrors
            : [];

        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to scan receipt.",
                errors: providerErrors
            },
            { status: 500 }
        );
    }
}
