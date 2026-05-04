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
    balance?: number;
    createdAt?: any;
    updatedAt?: any;
    createdBy: string;
}

export type LedgerType = "purchaseLedger" | "salesLedger";
export type LedgerEntryKind = "bill" | "credit" | "openingBalance" | "payment" | "receipt";
export type LedgerGateway = "upi" | "bank transfer" | "cheque" | "cash";

export interface LedgerBillAdjustment {
    billId: string;
    billNumber: string;
    amount: number;
}

export interface CompanyLedgerEntry {
    id?: string;
    billId?: string;
    billNumber?: string;
    billAdjustments?: LedgerBillAdjustment[];
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
    gateway?: LedgerGateway;
    bank?: string;
    chequeNumber?: string;
    note?: string;
    createdAt?: any;
    updatedAt?: any;
}

const normalizeText = (value?: string) => String(value || "").trim().toLowerCase();
const unique = <T,>(values: T[]) => Array.from(new Set(values));
const normalizeBillAdjustments = (value: unknown): LedgerBillAdjustment[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            const entry = typeof item === "object" && item !== null ? item as Partial<LedgerBillAdjustment> : {};
            const amount = Number(entry.amount || 0);
            const billId = String(entry.billId || "").trim();
            const billNumber = String(entry.billNumber || "").trim();
            if (!billId || !billNumber || !Number.isFinite(amount) || amount <= 0) return null;
            return { billId, billNumber, amount };
        })
        .filter((item): item is LedgerBillAdjustment => Boolean(item));
};
const getJoinedBillNumbers = (adjustments: LedgerBillAdjustment[]) => adjustments.map((adjustment) => adjustment.billNumber).join(", ");
const getAdjustmentTotal = (adjustments: LedgerBillAdjustment[]) => adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);
const isReceiptFullySettled = (entry: Partial<CompanyLedgerEntry>) => {
    const adjustments = normalizeBillAdjustments(entry.billAdjustments);
    if (!adjustments.length) return false;
    return Number(entry.amount || 0) >= getAdjustmentTotal(adjustments);
};
const getBillPaymentMetadata = (entry: Partial<CompanyLedgerEntry>) => {
    const paidType = entry.gateway === "bank transfer"
        ? "NEFT/IMPS"
        : entry.gateway === "upi"
            ? "UPI"
            : entry.gateway === "cash"
                ? "Cash"
                : entry.gateway === "cheque"
                    ? "Cheque"
                    : "";

    return {
        paidDate: entry.date || "",
        paidType,
        chequeNumber: entry.gateway === "cheque" ? String(entry.chequeNumber || "") : ""
    };
};

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
        await recalculateCompanyBalance(orgId, companyId);
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
        await recalculateCompanyBalance(orgId, companyId);
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
        await recalculateCompanyBalance(orgId, companyId);
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

export const syncBillPaymentStatusFromLedger = async (
    orgId: string,
    companyId: string,
    billIds: string[]
) => {
    try {
        const normalizedBillIds = unique(billIds.map((billId) => String(billId || "").trim()).filter(Boolean));
        if (!normalizedBillIds.length) {
            return { success: true, error: null };
        }

        const salesLedgerRef = collection(db, "organizations", orgId, "companies", companyId, "salesLedger");
        const salesLedgerSnap = await getDocs(salesLedgerRef);
        const paidMetadataByBillId = new Map<string, ReturnType<typeof getBillPaymentMetadata>>();

        salesLedgerSnap.forEach((ledgerDoc) => {
            const data = ledgerDoc.data() as Partial<CompanyLedgerEntry>;

            if (data.entryKind === "payment" && data.billId && normalizedBillIds.includes(data.billId)) {
                paidMetadataByBillId.set(data.billId, getBillPaymentMetadata(data));
            }

            if (data.entryKind === "receipt") {
                if (isReceiptFullySettled(data)) {
                    normalizeBillAdjustments(data.billAdjustments).forEach((adjustment) => {
                        if (normalizedBillIds.includes(adjustment.billId)) {
                            paidMetadataByBillId.set(adjustment.billId, getBillPaymentMetadata(data));
                        }
                    });
                }
            }
        });

        await Promise.all(normalizedBillIds.map(async (billId) => {
            const billRef = doc(db, "organizations", orgId, "bills", billId);
            const metadata = paidMetadataByBillId.get(billId);
            await updateDoc(billRef, metadata ? {
                paymentStatus: "Paid",
                paidDate: metadata.paidDate,
                paidType: metadata.paidType,
                chequeNumber: metadata.chequeNumber,
                updatedAt: new Date().toISOString()
            } : {
                paymentStatus: "Unpaid",
                paidDate: "",
                paidType: "",
                chequeNumber: "",
                updatedAt: new Date().toISOString()
            });
        }));

        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const removeBillFromCompanyReceipts = async (
    orgId: string,
    companyId: string,
    billId: string
) => {
    try {
        const salesLedgerRef = collection(db, "organizations", orgId, "companies", companyId, "salesLedger");
        const salesLedgerSnap = await getDocs(salesLedgerRef);
        const impactedBillIds: string[] = [];

        for (const ledgerDoc of salesLedgerSnap.docs) {
            const data = ledgerDoc.data() as Partial<CompanyLedgerEntry>;
            if (data.entryKind !== "receipt") continue;

            const currentAdjustments = normalizeBillAdjustments(data.billAdjustments);
            if (!currentAdjustments.some((adjustment) => adjustment.billId === billId)) continue;

            const nextAdjustments = currentAdjustments.filter((adjustment) => adjustment.billId !== billId);
            const nextAmount = getAdjustmentTotal(nextAdjustments);

            if (nextAmount <= 0) {
                await deleteDoc(doc(db, "organizations", orgId, "companies", companyId, "salesLedger", ledgerDoc.id));
                continue;
            }

            impactedBillIds.push(...nextAdjustments.map((adjustment) => adjustment.billId));
            await updateDoc(doc(db, "organizations", orgId, "companies", companyId, "salesLedger", ledgerDoc.id), {
                billAdjustments: nextAdjustments,
                billNumber: getJoinedBillNumbers(nextAdjustments),
                amount: nextAmount,
                credit: nextAmount,
                updatedAt: serverTimestamp()
            });
        }

        await recalculateCompanyBalance(orgId, companyId);
        if (impactedBillIds.length) {
            const syncResult = await syncBillPaymentStatusFromLedger(orgId, companyId, impactedBillIds);
            if (syncResult.error) throw new Error(syncResult.error);
        }

        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const recalculateCompanyBalance = async (orgId: string, companyId: string) => {
    try {
        const purchaseRef = collection(db, "organizations", orgId, "companies", companyId, "purchaseLedger");
        const salesRef = collection(db, "organizations", orgId, "companies", companyId, "salesLedger");

        const [purchaseSnap, salesSnap] = await Promise.all([
            getDocs(purchaseRef),
            getDocs(salesRef)
        ]);

        let totalDebit = 0;
        let totalCredit = 0;

        purchaseSnap.forEach(snapDoc => {
            const data = snapDoc.data();
            totalDebit += Number(data.debit || 0);
            totalCredit += Number(data.credit || 0);
        });

        salesSnap.forEach(snapDoc => {
            const data = snapDoc.data();
            totalDebit += Number(data.debit || 0);
            totalCredit += Number(data.credit || 0);
        });

        const balance = totalDebit - totalCredit;
        const companyRef = doc(db, "organizations", orgId, "companies", companyId);
        await updateDoc(companyRef, { balance, updatedAt: serverTimestamp() });

        return { success: true, balance };
    } catch (error: any) {
        console.error("Balance recalculation error:", error);
        return { success: false, error: error.message };
    }
};
