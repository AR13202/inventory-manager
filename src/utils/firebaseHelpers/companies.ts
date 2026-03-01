import { db } from "../firebase";
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp
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

// Fetch Companies (Real-time listener)
export const subscribeToCompanies = (orgId: string, callback: (items: Company[]) => void) => {
    if (!orgId) return () => { };

    const q = query(
        collection(db, "organizations", orgId, "companies"),
        orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const itemsList = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as Company[];
        callback(itemsList);
    }, (error) => {
        console.error("Error fetching companies:", error);
    });

    return unsubscribe;
};

// Add Company
export const addCompanyItem = async (orgId: string, itemData: Omit<Company, 'id' | 'createdAt' | 'updatedAt'>) => {
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

// Update Company
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

// Delete Company
export const deleteCompanyItem = async (orgId: string, itemId: string) => {
    try {
        const docRef = doc(db, "organizations", orgId, "companies", itemId);
        await deleteDoc(docRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};
