import type { BillItem } from "./firebaseHelpers/bills";

export const normalizeBillType = (billType?: string): "Purchase" | "Sale" => {
    return billType === "Sale" || billType === "Sell" ? "Sale" : "Purchase";
};

export const getBillAssetUrl = (bill?: Partial<BillItem> | null) => {
    if (bill?.photoPublicId) {
        const resourceType = bill.photoResourceType || "image";
        return `/api/bills/file?publicId=${encodeURIComponent(bill.photoPublicId)}&resourceType=${encodeURIComponent(resourceType)}`;
    }
    return bill?.photoUrl || "";
};

export const createBillNumber = (existingBills: Array<Partial<BillItem>>) => {
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const usedNumbers = existingBills
        .map((bill) => bill.billNumber || "")
        .filter((value) => value.startsWith(`BILL-${datePrefix}-`));
    const nextSequence = usedNumbers.length + 1;
    return `BILL-${datePrefix}-${String(nextSequence).padStart(4, "0")}`;
};

export const sanitizeBillNumber = (value?: string) => {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9/-]+/g, "")
        .slice(0, 40);
};
