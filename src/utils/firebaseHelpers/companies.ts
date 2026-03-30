import { db } from "../firebase";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc
} from "firebase/firestore";

export interface Company {
    id?: string;
    name: string;
    gst: string;
    address: string;
    phoneNumbers: string;
    createdAt?: any;
    updatedAt?: any;
    createdBy: string;
}

export type LedgerType = "purchaseLedger" | "salesLedger";
export type LedgerEntryKind = "bill" | "credit";

export interface CompanyLedgerEntry {
    id?: string;
    billId?: string;
    billNumber?: string;
    billType?: "Purchase" | "Sale";
    entryKind: LedgerEntryKind;
    date: string;
    credit: number;
    debit: number;
    amount: number;
    billImageUrl?: string;
    billImagePublicId?: string;
    billImageResourceType?: "image" | "raw" | "video";
    companyName: string;
    gateway?: "upi" | "bank transfer" | "cheque";
    bank?: string;
    chequeNumber?: string;
    note?: string;
    createdAt?: any;
    updatedAt?: any;
}

const normalizeText = (value?: string) => String(value || "").trim().toLowerCase();

export const subscribeToCompanies = (orgId: string, callback: (items: Company[]) => void) => {
    if (!orgId) return () => { };

    const q = query(
        collection(db, "organizations", orgId, "companies"),
        orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const itemsList = snapshot.docs.map((companyDoc) => ({
            id: companyDoc.id,
            ...companyDoc.data()
        })) as Company[];
        callback(itemsList);
    }, (error) => {
        console.error("Error fetching companies:", error);
    });

    return unsubscribe;
};

export const subscribeToCompanyLedger = (
    orgId: string,
    companyId: string,
    ledgerType: LedgerType,
    callback: (items: CompanyLedgerEntry[]) => void
) => {
    if (!orgId || !companyId) return () => { };

    const q = query(
        collection(db, "organizations", orgId, "companies", companyId, ledgerType),
        orderBy("date", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map((ledgerDoc) => ({
            id: ledgerDoc.id,
            ...ledgerDoc.data()
        })) as CompanyLedgerEntry[];
        callback(items);
    }, (error) => {
        console.error(`Error fetching ${ledgerType}:`, error);
    });

    return unsubscribe;
};

export const addCompanyItem = async (orgId: string, itemData: Omit<Company, "id" | "createdAt" | "updatedAt">) => {
    try {
        const parsedData = {
            ...itemData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, "organizations", orgId, "companies"), parsedData);
        return { success: true, id: docRef.id, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const ensureCompanyProfile = async (
    orgId: string,
    itemData: Omit<Company, "id" | "createdAt" | "updatedAt">
) => {
    try {
        const companiesRef = collection(db, "organizations", orgId, "companies");
        const snapshot = await getDocs(companiesRef);
        const matchedCompany = snapshot.docs.find((companyDoc) => {
            const data = companyDoc.data() as Company;
            const sameGst = normalizeText(data.gst) && normalizeText(data.gst) === normalizeText(itemData.gst);
            const sameName = normalizeText(data.name) === normalizeText(itemData.name);
            return sameGst || sameName;
        });

        if (matchedCompany) {
            const data = matchedCompany.data() as Company;
            await updateDoc(doc(db, "organizations", orgId, "companies", matchedCompany.id), {
                name: itemData.name || data.name,
                gst: itemData.gst || data.gst || "",
                address: itemData.address || data.address || "",
                phoneNumbers: itemData.phoneNumbers || data.phoneNumbers || "",
                updatedAt: serverTimestamp()
            });
            return { success: true, id: matchedCompany.id, error: null };
        }

        return addCompanyItem(orgId, itemData);
    } catch (error: any) {
        return { success: false, id: null, error: error.message };
    }
};

export const addCompanyLedgerEntry = async (
    orgId: string,
    companyId: string,
    ledgerType: LedgerType,
    entry: Omit<CompanyLedgerEntry, "id" | "createdAt" | "updatedAt">
) => {
    try {
        const ledgerRef = collection(db, "organizations", orgId, "companies", companyId, ledgerType);
        const docRef = await addDoc(ledgerRef, {
            ...entry,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return { success: true, id: docRef.id, error: null };
    } catch (error: any) {
        return { success: false, id: null, error: error.message };
    }
};

export const updateCompanyLedgerEntry = async (
    orgId: string,
    companyId: string,
    ledgerType: LedgerType,
    entryId: string,
    updates: Partial<CompanyLedgerEntry>
) => {
    try {
        const ledgerDocRef = doc(db, "organizations", orgId, "companies", companyId, ledgerType, entryId);
        await updateDoc(ledgerDocRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const deleteCompanyLedgerEntry = async (
    orgId: string,
    companyId: string,
    ledgerType: LedgerType,
    entryId: string
) => {
    try {
        const ledgerDocRef = doc(db, "organizations", orgId, "companies", companyId, ledgerType, entryId);
        await deleteDoc(ledgerDocRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const updateCompanyItem = async (orgId: string, itemId: string, updatedData: Partial<Company>) => {
    try {
        const docRef = doc(db, "organizations", orgId, "companies", itemId);
        await updateDoc(docRef, {
            ...updatedData,
            updatedAt: serverTimestamp()
        });
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const deleteCompanyItem = async (orgId: string, itemId: string) => {
    try {
        const docRef = doc(db, "organizations", orgId, "companies", itemId);
        await deleteDoc(docRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};
