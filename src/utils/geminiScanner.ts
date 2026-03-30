// src/utils/geminiScanner.ts
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

export async function scanReceipt(base64Image: string) {
    const response = await fetch("/api/bills/scan", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ image: base64Image })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to scan receipt.");
    }

    return data.data as ScannedReceiptData;
}
