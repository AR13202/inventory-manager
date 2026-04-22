// src/utils/firebaseHelpers/bills.ts
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    updateDoc
} from "firebase/firestore";
import { db } from "../firebase";

export interface BillProductInfo {
    name: string;
    quantity: number | string;
    unit?: string;
    price: number | string;
    hsn?: string;
    category?: string;
}

export interface BillTaxDetail {
    taxType: string;
    taxPercentage: number | string;
    taxAmount: number | string;
}

export interface BillItem {
    id?: string;
    billNumber: string;
    vendorName: string;
    vendorGst?: string;
    vendorAddress?: string;
    vendorPhone?: string;
    companyId?: string;
    ledgerEntryId?: string;
    paymentLedgerEntryId?: string;
    products: BillProductInfo[];
    taxAmount: string | number;
    taxDetails?: BillTaxDetail[];
    freightAndForwardingCharges?: number | string;
    roundOff?: number | string;
    grossAmount: string | number;
    amount: string | number;
    billType: "Purchase" | "Sale";
    paymentStatus?: "Paid" | "Unpaid";
    paidDate?: string;
    paidType?: "NEFT/IMPS/UPI" | "Cash" | "Cheque";
    chequeNumber?: string;
    isScanned?: boolean;
    photoUrl?: string;
    photoPublicId?: string;
    photoResourceType?: "image" | "raw" | "video";
    fileName?: string;
    fileMimeType?: string;
    fileHash?: string;
    date: string;
    createdAt?: string;
    createdBy?: string;
    updatedAt?: string;
}

export const addBillItem = async (orgId: string, itemData: BillItem, creatorUid: string) => {
    try {
        const billsRef = collection(db, "organizations", orgId, "bills");
        const docRef = doc(billsRef);
        const timestamp = new Date().toISOString();

        await setDoc(docRef, {
            ...itemData,
            id: docRef.id,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: creatorUid
        });

        return { id: docRef.id, error: null };
    } catch (error: any) {
        return { id: null, error: error.message };
    }
};

export const updateBillItem = async (orgId: string, itemId: string, updates: Partial<BillItem>) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "bills", itemId);
        await updateDoc(itemRef, {
            ...updates,
            updatedAt: new Date().toISOString()
        });
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const deleteBillItem = async (orgId: string, itemId: string) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "bills", itemId);
        await deleteDoc(itemRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const subscribeToBills = (orgId: string, callback: (items: BillItem[]) => void) => {
    const billsRef = collection(db, "organizations", orgId, "bills");
    const q = query(billsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const items: BillItem[] = [];
        snapshot.forEach((billDoc) => {
            items.push(billDoc.data() as BillItem);
        });
        callback(items);
    }, (error) => {
        console.error("Error subscribing to bills:", error);
    });

    return unsubscribe;
};
