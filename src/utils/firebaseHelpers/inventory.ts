// src/utils/firebaseHelpers/inventory.ts
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import type { BillItem, BillProductInfo } from "./bills";

export interface InventoryItem {
    id?: string;
    productId?: string;
    name: string;
    hsn: string;
    unit?: string;
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
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePrice = (value: number | string | undefined) => {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
};

const getSignedProductMap = (bill?: Partial<BillItem> | null) => {
    const productMap = new Map<string, BillProductInfo>();
    const sign = bill?.billType === "Sale" ? -1 : 1;

    (bill?.products || []).forEach((product) => {
        const name = String(product.name || "").trim();
        if (!name) {
            return;
        }

        const key = name.toLowerCase();
        const existing = productMap.get(key);
        const quantity = Math.max(0, normalizeQuantity(product.quantity));

        if (existing) {
            existing.quantity = normalizeQuantity(existing.quantity) + quantity * sign;
            if (product.price !== undefined) existing.price = product.price;
            if (product.hsn) existing.hsn = product.hsn;
            if (product.category) existing.category = product.category;
            if (product.unit) existing.unit = product.unit;
            return;
        }

        productMap.set(key, {
            ...product,
            name,
            quantity: quantity * sign,
            category: product.category || "Trade"
        });
    });

    return productMap;
};

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
                    unit: item.unit || existingItem.unit || "",
                    price: item.price || existingItem.price || "",
                    category: item.category || existingItem.category || "Trade",
                    ...autoStatus,
                    updatedAt: serverTimestamp()
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
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        return { error: error.message };
    }
};

export const syncInventoryFromBill = async (
    orgId: string,
    bill: Pick<BillItem, "billType" | "products">,
    userId: string
) => {
    return applyInventoryDelta(orgId, null, bill, userId);
};

export const reconcileInventoryForBillUpdate = async (
    orgId: string,
    previousBill: Pick<BillItem, "billType" | "products">,
    nextBill: Pick<BillItem, "billType" | "products">,
    userId: string
) => {
    return applyInventoryDelta(orgId, previousBill, nextBill, userId);
};

const applyInventoryDelta = async (
    orgId: string,
    previousBill: Pick<BillItem, "billType" | "products"> | null,
    nextBill: Pick<BillItem, "billType" | "products"> | null,
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

        const previousMap = getSignedProductMap(previousBill);
        const nextMap = getSignedProductMap(nextBill);
        const allKeys = new Set<string>([...previousMap.keys(), ...nextMap.keys()]);

        allKeys.forEach((key) => {
            const previous = previousMap.get(key);
            const next = nextMap.get(key);
            const previousSignedQuantity = normalizeQuantity(previous?.quantity);
            const nextSignedQuantity = normalizeQuantity(next?.quantity);
            const delta = nextSignedQuantity - previousSignedQuantity;
            const reference = next || previous;

            if (!reference || delta === 0) {
                return;
            }

            const existingItem = existingItemsMap.get(key);
            if (existingItem && existingItem.id) {
                const currentQuantity = Number(existingItem.quantity) || 0;
                const nextQuantity = Math.max(0, currentQuantity + delta);
                const autoStatus = determineInventoryStatus(nextQuantity);
                const docRef = doc(db, "organizations", orgId, "inventory", existingItem.id);

                batch.update(docRef, {
                    name: reference.name,
                    hsn: reference.hsn || existingItem.hsn || "",
                    unit: reference.unit || existingItem.unit || "",
                    category: reference.category || existingItem.category || "Trade",
                    price: normalizePrice(reference.price ?? existingItem.price),
                    quantity: nextQuantity,
                    ...autoStatus,
                    updatedAt: serverTimestamp()
                });
                return;
            }

            const newDocRef = doc(orgInventoryRef);
            const initialQuantity = Math.max(0, delta);
            const autoStatus = determineInventoryStatus(initialQuantity);

            batch.set(newDocRef, {
                id: newDocRef.id,
                productId: newDocRef.id,
                name: reference.name,
                hsn: reference.hsn || "",
                unit: reference.unit || "",
                quantity: initialQuantity,
                price: normalizePrice(reference.price),
                sku: createInventorySku(reference.name),
                category: reference.category || "Trade",
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

export const deleteInventoryItem = async (orgId: string, itemId: string) => {
    try {
        const itemRef = doc(db, "organizations", orgId, "inventory", itemId);
        await deleteDoc(itemRef);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

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
