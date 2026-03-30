// src/utils/firebaseHelpers/inventory.ts
import {
    collection,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    orderBy,
    writeBatch,
    getDocs,
    serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

export interface InventoryItem {
    id?: string;
    name: string;
    hsn: string;
    quantity: number;
    price: string;
    sku: string;
    category: string;
    status: string;
    statusColor: string;
    createdAt?: string;
    createdBy?: string;
}

// Add Item
export const addInventoryItem = async (orgId: string, itemData: InventoryItem, creatorUid: string) => {
    try {
        const inventoryRef = collection(db, "organizations", orgId, "inventory");
        const docRef = doc(inventoryRef);

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

// Add Bulk Items
export const addBulkInventoryItems = async (orgId: string, bulkItems: InventoryItem[], userId: string) => {
    try {
        const batch = writeBatch(db);
        const orgInventoryRef = collection(db, "organizations", orgId, "inventory");

        // Before bulk inserting, we grab existing items to check for names
        const snapshot = await getDocs(orgInventoryRef);
        const existingItemsMap = new Map<string, InventoryItem>();
        snapshot.forEach(doc => {
            const data = doc.data() as InventoryItem;
            existingItemsMap.set(data.name.toLowerCase(), { ...data, id: doc.id });
        });

        bulkItems.forEach((item) => {
            const existingItem = existingItemsMap.get(item.name.toLowerCase());

            if (existingItem && existingItem.id) {
                // If it exists, we update the existing doc, adding to its previous quantity
                const docRef = doc(db, "organizations", orgId, "inventory", existingItem.id);
                const newQuantity = existingItem.quantity + item.quantity;
                batch.update(docRef, {
                    quantity: newQuantity,
                    updatedAt: serverTimestamp()
                });
            } else {
                // Otherwise we create a new doc
                const newDocRef = doc(orgInventoryRef);
                batch.set(newDocRef, {
                    ...item,
                    id: newDocRef.id,
                    createdBy: userId,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
};

// Update Item
export const updateInventoryItem = async (orgId: string, itemId: string, updates: Partial<InventoryItem>) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "inventory", itemId);
        await updateDoc(itemRef, updates);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

// Delete Item
export const deleteInventoryItem = async (orgId: string, itemId: string) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "inventory", itemId);
        await deleteDoc(itemRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

// Subscribe to Inventory (Real-time listener)
export const subscribeToInventory = (orgId: string, callback: (items: InventoryItem[]) => void) => {
    const inventoryRef = collection(db, "organizations", orgId, "inventory");
    const q = query(inventoryRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const items: InventoryItem[] = [];
        snapshot.forEach((doc) => {
            const data = doc.data() as InventoryItem;
            items.push({ ...data, id: doc.id });
        });
        callback(items);
    }, (error) => {
        console.error("Error subscribing to inventory:", error);
    });

    return unsubscribe;
};
