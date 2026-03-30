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
    productId?: string;
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
    updatedAt?: string;
}

export interface InventoryBillProductInput {
    name: string;
    hsn?: string;
    quantity: number | string;
    price?: number | string;
    category?: string;
}

export const determineInventoryStatus = (quantity: number) => {
    if (quantity <= 0) {
        return { status: "Out of Stock", statusColor: "#ef4444" };
    }
    if (quantity < 10) {
        return { status: "Low Stock", statusColor: "#f59e0b" };
    }
    return { status: "In Stock", statusColor: "#10b981" };
};

export const createInventorySku = (seed?: string) => {
    const cleanSeed = (seed || "ITEM")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 10);

    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `SKU-${cleanSeed || "ITEM"}-${randomPart}`;
};

const normalizeQuantity = (value: number | string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const normalizePrice = (value: number | string | undefined) => {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
};

// Add Item
export const addInventoryItem = async (orgId: string, itemData: InventoryItem, creatorUid: string) => {
    try {
        const inventoryRef = collection(db, "organizations", orgId, "inventory");
        const docRef = doc(inventoryRef);
        const autoStatus = determineInventoryStatus(Number(itemData.quantity || 0));

        const newItem = {
            ...itemData,
            ...autoStatus,
            id: docRef.id,
            productId: itemData.productId || docRef.id,
            sku: itemData.sku || createInventorySku(itemData.name),
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
        const snapshot = await getDocs(orgInventoryRef);
        const existingItemsMap = new Map<string, InventoryItem>();

        snapshot.forEach((itemDoc) => {
            const data = itemDoc.data() as InventoryItem;
            existingItemsMap.set(data.name.toLowerCase(), { ...data, id: itemDoc.id });
        });

        bulkItems.forEach((item) => {
            const existingItem = existingItemsMap.get(item.name.toLowerCase());

            if (existingItem && existingItem.id) {
                const newQuantity = Math.max(0, Number(existingItem.quantity) + Number(item.quantity));
                const autoStatus = determineInventoryStatus(newQuantity);
                const docRef = doc(db, "organizations", orgId, "inventory", existingItem.id);

                batch.update(docRef, {
                    quantity: newQuantity,
                    hsn: item.hsn || existingItem.hsn || "",
                    price: item.price || existingItem.price || "",
                    category: item.category || existingItem.category || "Trade",
                    ...autoStatus,
                    updatedAt: serverTimestamp()
                });
                existingItemsMap.set(item.name.toLowerCase(), {
                    ...existingItem,
                    ...item,
                    quantity: newQuantity,
                    ...autoStatus
                });
                return;
            }

            const newDocRef = doc(orgInventoryRef);
            const quantity = Math.max(0, Number(item.quantity) || 0);
            const autoStatus = determineInventoryStatus(quantity);

            batch.set(newDocRef, {
                ...item,
                ...autoStatus,
                id: newDocRef.id,
                productId: item.productId || newDocRef.id,
                sku: item.sku || createInventorySku(item.name),
                quantity,
                createdBy: userId,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
            existingItemsMap.set(item.name.toLowerCase(), {
                ...item,
                ...autoStatus,
                id: newDocRef.id,
                productId: item.productId || newDocRef.id,
                sku: item.sku || createInventorySku(item.name),
                quantity
            });
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
};

export const syncInventoryFromBill = async (
    orgId: string,
    products: InventoryBillProductInput[],
    billType: "Purchase" | "Sale" | "Sell",
    userId: string
) => {
    try {
        const batch = writeBatch(db);
        const orgInventoryRef = collection(db, "organizations", orgId, "inventory");
        const snapshot = await getDocs(orgInventoryRef);
        const existingItemsMap = new Map<string, InventoryItem>();

        snapshot.forEach((itemDoc) => {
            const data = itemDoc.data() as InventoryItem;
            existingItemsMap.set(data.name.toLowerCase(), { ...data, id: itemDoc.id });
        });

        const aggregatedItems = new Map<string, InventoryBillProductInput>();
        products.forEach((product) => {
            const normalizedName = String(product.name || "").trim();
            if (!normalizedName) {
                return;
            }

            const key = normalizedName.toLowerCase();
            const existingProduct = aggregatedItems.get(key);
            if (existingProduct) {
                existingProduct.quantity = normalizeQuantity(existingProduct.quantity) + normalizeQuantity(product.quantity);
                existingProduct.price = product.price ?? existingProduct.price;
                existingProduct.hsn = product.hsn || existingProduct.hsn || "";
                existingProduct.category = product.category || existingProduct.category || "Trade";
                return;
            }

            aggregatedItems.set(key, {
                name: normalizedName,
                quantity: normalizeQuantity(product.quantity),
                price: product.price,
                hsn: product.hsn || "",
                category: product.category || "Trade"
            });
        });

        aggregatedItems.forEach((item, key) => {
            const existingItem = existingItemsMap.get(key);
            const requestedQuantity = normalizeQuantity(item.quantity);
            const isPurchase = billType === "Purchase";

            if (existingItem && existingItem.id) {
                const currentQuantity = Number(existingItem.quantity) || 0;
                const nextQuantity = isPurchase
                    ? currentQuantity + requestedQuantity
                    : Math.max(0, currentQuantity - requestedQuantity);
                const autoStatus = determineInventoryStatus(nextQuantity);
                const docRef = doc(db, "organizations", orgId, "inventory", existingItem.id);

                batch.update(docRef, {
                    name: item.name,
                    hsn: item.hsn || existingItem.hsn || "",
                    category: item.category || existingItem.category || "Trade",
                    price: normalizePrice(item.price ?? existingItem.price),
                    quantity: nextQuantity,
                    ...autoStatus,
                    updatedAt: serverTimestamp()
                });
                return;
            }

            const newDocRef = doc(orgInventoryRef);
            const initialQuantity = isPurchase ? requestedQuantity : 0;
            const autoStatus = determineInventoryStatus(initialQuantity);

            batch.set(newDocRef, {
                id: newDocRef.id,
                productId: newDocRef.id,
                name: item.name,
                hsn: item.hsn || "",
                quantity: initialQuantity,
                price: normalizePrice(item.price),
                sku: createInventorySku(item.name),
                category: item.category || "Trade",
                ...autoStatus,
                createdBy: userId,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        });

        await batch.commit();
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

// Update Item
export const updateInventoryItem = async (orgId: string, itemId: string, updates: Partial<InventoryItem>) => {
    try {
        const quantity = typeof updates.quantity === "number" ? updates.quantity : undefined;
        const autoStatus = quantity === undefined ? {} : determineInventoryStatus(quantity);
        const itemRef = doc(db, "organizations", orgId, "inventory", itemId);

        await updateDoc(itemRef, {
            ...updates,
            ...autoStatus,
            updatedAt: serverTimestamp()
        });
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
        snapshot.forEach((itemDoc) => {
            const data = itemDoc.data() as InventoryItem;
            items.push({ ...data, id: itemDoc.id });
        });
        callback(items);
    }, (error) => {
        console.error("Error subscribing to inventory:", error);
    });

    return unsubscribe;
};
