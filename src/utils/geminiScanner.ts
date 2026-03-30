// src/utils/geminiScanner.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

export async function scanReceipt(base64Image: string) {
    if (!apiKey) {
        throw new Error("Gemini API key is not configured.");
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        // Strip data:image/...;base64,
        const base64Data = base64Image.split(",")[1] || base64Image;

        const prompt = `
        Analyze this receipt or bill image and extract the following information strictly in JSON format.
        Do not add any markdown formatting like \`\`\`json. Just output the raw JSON string.
        {
            "parentCompanyDetails": {
                "name": "found parent company name or generator company name",
                "gst": "found gst number or empty string",
                "address": "found address or empty string",
                "phoneNumbers": "found phone numbers or empty string"
            },
            "customerCompanyDetails": {
                 "name": "found customer company name or receiving user name",
                 "gst": "found gst number or empty string",
                 "address": "found address or empty string",
                 "phoneNumbers": "found phone numbers or empty string"
            },
            "date": "YYYY-MM-DD format of bill date, or empty string",
            "taxPercentage": numeric_tax_percentage,
            "taxDetails": [
                {
                    "taxAmount": numeric_tax_amount,
                    "taxType": "CGST/SGST/IGST"
                }
            ],
            "freightAndForwardingCharges": numeric_freight_and_forwarding_charges,
            "roundOff": numeric_round_off,
            "totalAmount": numeric_total_amount_found_or_0,
            "items": [
                {
                    "name": "item name",
                    "quantity": numeric_quantity_or_1,
                    "hsn": "numeric hsn value",
                    "price": numeric_price_of_item
                }
            ]
        }
        `;

        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg" // Generic fallback for scans
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const responseText = result.response.text();

        // Cleaning to parse JSON
        let jsonStr = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(jsonStr);

        return parsed;

    } catch (error) {
        console.error("Gemini Scanning Error: ", error);
        return null;
    }
}
