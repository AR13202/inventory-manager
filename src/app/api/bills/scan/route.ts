import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY || process.env.NEXT_PUBLIC_GROQ_API_KEY || process.env.GROK_API_KEY || process.env.NEXT_PUBLIC_GROK_API_KEY;

const prompt = `
Analyze this receipt, invoice, or bill image and return only raw JSON.
Do not wrap the response in markdown.

Use this exact schema:
{
  "parentCompanyDetails": {
    "name": "seller or invoice issuer company name",
    "gst": "GST number if visible, else empty string",
    "address": "seller or issuer address if visible, else empty string",
    "phoneNumbers": "seller or issuer phone if visible, else empty string"
  },
  "customerCompanyDetails": {
    "name": "billed to / buyer / customer company name",
    "gst": "GST number if visible, else empty string",
    "address": "customer address if visible, else empty string",
    "phoneNumbers": "customer phone if visible, else empty string"
  },
  "date": "YYYY-MM-DD if visible, else empty string",
  "billNumber": "invoice or bill number if visible, else empty string",
  "billType": "Purchase or Sale or Unknown",
  "taxAmount": 0,
  "taxPercentage": 0,
  "taxDetails": [
    {
      "taxType": "CGST/SGST/IGST/VAT/etc",
      "taxPercentage": 0,
      "taxAmount": 0
    }
  ],
  "freightAndForwardingCharges": 0,
  "roundOff": 0,
  "totalAmount": 0,
  "items": [
    {
      "name": "item name",
      "hsn": "hsn or empty string",
      "quantity": 1,
      "unit": "pcs/kg/box/etc or empty string",
      "price": 0,
      "category": "Trade"
    }
  ]
}

Rules:
- Prefer details from the billed to section for customerCompanyDetails.
- Extract invoice number / bill number / voucher number into billNumber.
- Extract the quantity unit whenever visible.
- Use numeric values for quantity, price, taxAmount, taxPercentage, freightAndForwardingCharges, roundOff, and totalAmount.
- billType should be "Sale" when the document clearly looks like a sales invoice issued to a customer, "Purchase" when it clearly looks like a supplier bill or purchase invoice received by the uploader, otherwise "Unknown".
- If a field is not visible, keep it empty or 0.
`;

type ScanProvider = "gemini" | "groq";

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
        model: "gemini-2.5-flash",
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

async function scanWithFallback(image: string) {
    const providers: Array<{ name: ScanProvider; scan: (value: string) => Promise<unknown> }> = [
        { name: "groq", scan: scanWithGroq },
        { name: "gemini", scan: scanWithGemini }
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
