import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;

const prompt = `
You are an expert OCR and invoice data extraction system. Analyze this invoice/bill image with extreme care and return ONLY raw JSON — no markdown, no explanation, no code fences.

CRITICAL EXTRACTION RULES — READ CAREFULLY:

## Company Identification
- "parentCompanyDetails" = the SELLER / ISSUER of the invoice (whose letterhead/logo is at the top, who signed it as "Authorised Signatory")
- "customerCompanyDetails" = the BUYER / "Billed To" party
- Always extract GST numbers for BOTH parties if visible anywhere on the document

## Bill Number
- Look for: Invoice No., Bill No., Voucher No., Sr. No. at the top of the document
- This is almost always present — look carefully before leaving it empty

## Date
- Look for: Date, Dated, Invoice Date fields
- Format as YYYY-MM-DD

## billType Logic
- If the parentCompanyDetails company is the one ISSUING/SELLING → "Sale"
- If the document was received FROM a supplier (i.e., you are the buyer in customerCompanyDetails) → "Purchase"
- Determine this from context: if "Alliance Engineering" is in "Billed To / Shipped To", it's a Purchase invoice FOR Alliance Engineering

## Items Extraction — MOST CRITICAL SECTION
- Read EVERY row in the items table meticulously
- Match each item's: description, HSN/SAC code, quantity, unit, and unit price (Rate column)
- "price" = unit rate per item, NOT the line total
- Do NOT confuse line total (Amount) with unit price (Rate/Price)
- If an item has a sub-description or note on the next line (e.g., "ID 10mm"), append it to the item name
- Do NOT skip any line items — count all rows carefully before finalizing

## Tax Details
- Extract EACH tax component separately: CGST, SGST, IGST, UTGST, VAT etc.
- Some invoices use UTGST instead of SGST for union territories (e.g., Chandigarh)
- taxPercentage for each component = that component's individual rate (e.g., 9% each for CGST+SGST, not 18% total)
- taxAmount = the actual rupee amount for each component
- Top-level taxAmount = SUM of all tax components
- Top-level taxPercentage = TOTAL effective tax rate

## Amounts
- freightAndForwardingCharges: Look for "Freight", "F&F", "Forwarding", "Packing" line items
- roundOff: Look for "Round Off" or "Rounded Off" lines (can be negative)
- totalAmount = Grand Total / Total Amount After Tax (the final payable amount)

## Validation Check (do this before returning):
- Sum of (quantity × price) for all items + tax + freight + roundOff should approximately equal totalAmount
- If your numbers don't add up, re-read the invoice more carefully

Return this exact schema:
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
  "date": "",
  "billNumber": "",
  "billType": "Purchase or Sale or Unknown",
  "taxAmount": 0,
  "taxPercentage": 0,
  "taxDetails": [
    {
      "taxType": "",
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

type ScanProvider = "gemini" | "groq" | "openrouter";

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
    const objectValue = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
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
        const objectValue = typeof tax === "object" && tax !== null ? tax as Record<string, unknown> : {};
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
        const objectValue = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
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
    const objectValue = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
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
    return value.replace(/```json/g, "").replace(/```/g, "").trim();
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

async function scanWithGemini(image: string) {
    if (!geminiApiKey) {
        throw new Error("Gemini API key is not configured.");
    }
    console.log("Scanning with Gemini...");

    const { base64Data, mimeType } = parseBase64Image(image);
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
        model: "gemma3-12b",
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType
            }
        }
    ]);

    return JSON.parse(extractJsonText(result.response.text()));
}

async function scanWithGroq(image: string) {
    if (!groqApiKey) {
        throw new Error("Groq API key is not configured.");
    }
    console.log("Scanning with Groq...");
    const { dataUrl, mimeType } = parseBase64Image(image);
    if (!mimeType.startsWith("image/")) {
        throw new Error(`Groq vision fallback does not support ${mimeType} files.`);
    }

    const groq = new Groq({ apiKey: groqApiKey });
    const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        temperature: 0,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: dataUrl
                        }
                    }
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

    try {
        return JSON.parse(extractJsonText(text));
    } catch (error) {
        throw new Error(`Groq returned invalid JSON: ${error instanceof Error ? error.message : "Unknown parse error."}`);
    }
}

// Best to OK order: accuracy + speed + stability on free tier
const OPENROUTER_VISION_MODELS = [
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-3-27b-it:free",                     // Good - stable, confirmed working
    "qwen/qwen2.5-vl-72b-instruct:free",              // Best - largest, great at tables/line items
    "qwen/qwen2.5-vl-32b-instruct:free",              // Great - slightly smaller but very fast
    "meta-llama/llama-3.2-11b-vision-instruct:free",  // OK - lightweight fallback
    "google/gemma-3-12b-it:free",                     // Last resort - smaller, less accurate
];

async function scanWithOpenRouter(image: string) {
    if (!openRouterApiKey) {
        throw new Error("OpenRouter API key is not configured.");
    }

    const { dataUrl, mimeType } = parseBase64Image(image);
    if (!mimeType.startsWith("image/")) {
        throw new Error(`OpenRouter vision fallback does not support ${mimeType} files.`);
    }

    let lastError: Error = new Error("No models available.");

    for (const model of OPENROUTER_VISION_MODELS) {
        try {
            console.log(`Scanning with OpenRouter model: ${model}`);

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${openRouterApiKey}`,
                    "Content-Type": "application/json",
                    "X-Title": "Invoice Scanner"
                },
                body: JSON.stringify({
                    model,
                    temperature: 0,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: prompt },
                                { type: "image_url", image_url: { url: dataUrl } }
                            ]
                        }
                    ]
                })
            });

            const payload = await response.json();

            // These status codes mean model/provider is down — try next
            if (response.status === 500 || response.status === 529 || response.status === 503) {
                const reason = payload?.error?.message || `HTTP ${response.status}`;
                console.warn(`Model ${model} unavailable: ${reason}, trying next...`);
                lastError = new Error(reason);
                continue;
            }

            // Rate limited — try next model
            if (response.status === 429) {
                console.warn(`Model ${model} rate limited, trying next...`);
                lastError = new Error(`${model} rate limited`);
                continue;
            }

            // Other non-OK responses — throw immediately (auth error, bad request etc)
            if (!response.ok) {
                const apiMessage =
                    payload?.error?.message ||
                    payload?.message ||
                    `OpenRouter request failed with status ${response.status}`;
                throw new Error(apiMessage);
            }

            const content = payload?.choices?.[0]?.message?.content;
            const text = Array.isArray(content)
                ? content.map((entry: { text?: string }) => entry?.text || "").join("")
                : String(content || "");

            // Empty response — try next model
            if (!text.trim()) {
                console.warn(`Model ${model} returned empty response, trying next...`);
                lastError = new Error(`${model} returned empty response`);
                continue;
            }

            // Invalid JSON — try next model
            try {
                const result = JSON.parse(extractJsonText(text));
                console.log(`Successfully scanned with model: ${model}`);
                return result;
            } catch {
                console.warn(`Model ${model} returned invalid JSON, trying next...`);
                lastError = new Error(`${model} returned invalid JSON`);
                continue;
            }

        } catch (err) {
            // Only rethrow if it's not a retriable error
            if (err instanceof Error && !err.message.includes("rate limit") && !err.message.includes("unavailable")) {
                throw err;
            }
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`Model ${model} failed: ${lastError.message}, trying next...`);
        }
    }

    throw new Error(`All OpenRouter models failed. Last error: ${lastError.message}`);
}

async function scanWithFallback(image: string) {
    const providers: Array<{ name: ScanProvider; scan: (value: string) => Promise<unknown> }> = [
        { name: "openrouter", scan: scanWithOpenRouter },
        { name: "gemini", scan: scanWithGemini },
        { name: "groq", scan: scanWithGroq },
    ];
    const errors: ProviderError[] = [];

    for (const provider of providers) {
        try {
            console.log(`[bill-scan] trying provider: ${provider.name}`);
            const parsed = await provider.scan(image);
            console.log(`[bill-scan] provider succeeded: ${provider.name}`);
            return {
                provider: provider.name,
                data: normalizeScanResponse(parsed),
                errors
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown scanning error.";
            console.error(`[bill-scan] provider failed: ${provider.name}`, error);
            console.error(`${provider.name} scanning error:`, error);
            errors.push({ provider: provider.name, message });
        }
    }

    throw Object.assign(new Error("Failed to scan receipt."), { providerErrors: errors });
}

export async function POST(request: Request) {
    try {
        const { image } = await request.json();
        if (!image) {
            return NextResponse.json({ success: false, error: "No image provided." }, { status: 400 });
        }

        const result = await scanWithFallback(String(image));

        return NextResponse.json({
            success: true,
            provider: result.provider,
            data: result.data
        });
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
