import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

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

export async function POST(request: Request) {
    try {
        if (!geminiApiKey) {
            return NextResponse.json({ success: false, error: "Gemini API key is not configured." }, { status: 500 });
        }

        const { image } = await request.json();
        if (!image) {
            return NextResponse.json({ success: false, error: "No image provided." }, { status: 400 });
        }

        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        const [metadataPart, base64Data = image] = String(image).split(",");
        const mimeTypeMatch = metadataPart.match(/data:(.*?);base64/);
        const mimeType = mimeTypeMatch?.[1] || "image/jpeg";

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType
                }
            }
        ]);

        const responseText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(responseText);

        return NextResponse.json({ success: true, data: parsed });
    } catch (error: any) {
        console.error("Gemini scanning error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Failed to scan receipt." },
            { status: 500 }
        );
    }
}
