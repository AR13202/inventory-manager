// src/utils/firebaseHelpers/bills.ts
import {
    collection,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

export interface BillProductInfo {
    name: string;
    quantity: number;
    price: number | string;
    hsn?: string;
    category?: string;
}

export interface BillItem {
    id?: string;
    vendorName: string; // Company Name
    vendorGst?: string;
    vendorAddress?: string;
    vendorPhone?: string;
    companyId?: string;
    ledgerEntryId?: string;
    products: BillProductInfo[];
    taxAmount: string | number;
    taxDetails?: { taxType: string; taxPercentage: number | string; taxAmount: number | string }[];
    freightAndForwardingCharges?: number | string;
    roundOff?: number | string;
    grossAmount: string | number;
    amount: string | number; // Total price with tax
    billType: "Purchase" | "Sale" | "Sell";
    isScanned?: boolean;
    photoUrl?: string; // Stored URL if scanned
    photoPublicId?: string;
    date: string;
    createdAt?: string;
    createdBy?: string;
}

// Add Bill
export const addBillItem = async (orgId: string, itemData: BillItem, creatorUid: string) => {
    try {
        const billsRef = collection(db, "organizations", orgId, "bills");
        const docRef = doc(billsRef);

        const newItem = {
            ...itemData,
            id: docRef.id,
            createdAt: new Date().toISOString(),
            createdBy: creatorUid
        };

        await setDoc(docRef, newItem);
        return { id: docRef.id, error: null };
    } catch (error: any) {
        return { id: null, error: error.message };
    }
};

// Update Bill
export const updateBillItem = async (orgId: string, itemId: string, updates: Partial<BillItem>) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "bills", itemId);
        await updateDoc(itemRef, updates);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

// Delete Bill
export const deleteBillItem = async (orgId: string, itemId: string) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "bills", itemId);
        await deleteDoc(itemRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

// Subscribe to Bills (Real-time listener)
export const subscribeToBills = (orgId: string, callback: (items: BillItem[]) => void) => {
    const billsRef = collection(db, "organizations", orgId, "bills");
    const q = query(billsRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const items: BillItem[] = [];
        snapshot.forEach((doc) => {
            items.push(doc.data() as BillItem);
        });
        callback(items);
    }, (error) => {
        console.error("Error subscribing to bills:", error);
    });

    return unsubscribe;
};
