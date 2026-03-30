"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useEffect, useState } from "react";
import {
    InventoryItem,
    subscribeToInventory,
    addInventoryItem,
    addBulkInventoryItems,
    updateInventoryItem,
    deleteInventoryItem
} from "@/utils/firebaseHelpers/inventory";
import { PlusCircle, Edit2, Trash2, UploadCloud } from "lucide-react";

export default function InventoryView() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();

    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    // List Control States
    const [searchQuery, setSearchQuery] = useState("");
    const [sortParam, setSortParam] = useState("Name (A-Z)");

    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form states
    const [formData, setFormData] = useState<InventoryItem>({
        name: '', hsn: '', quantity: 0, price: '', sku: '', category: 'Trade', status: 'In Stock', statusColor: '#10b981'
    });

    // Bulk Modal state
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkItems, setBulkItems] = useState<Partial<InventoryItem>[]>([{ name: '', quantity: 0, price: '', sku: '', category: 'Trade' }]);

    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const uniqueProductNames = Array.from(new Set(items.map(i => i.name)));

    useEffect(() => {
        if (!activeOrg) return;

        setLoading(true);
        const unsubscribe = subscribeToInventory(activeOrg.orgId, (fetchedItems) => {
            setItems(fetchedItems);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [activeOrg]);

    if (!activeOrg || !user) return <p>Loading inventory...</p>;

    const handleOpenModal = (item?: InventoryItem) => {
        setError(null);
        if (item) {
            setEditingId(item.id || null);
            setFormData(item);
        } else {
            setEditingId(null);
            setFormData({
                name: '', hsn: '', quantity: 0, price: '', sku: '', category: 'Trade', status: 'In Stock', statusColor: '#10b981'
            });
        }
        setShowModal(true);
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        const existingItem = items.find(i => i.name.toLowerCase() === newName.toLowerCase());

        if (existingItem && !editingId) {
            setFormData({
                ...formData,
                name: newName,
                hsn: existingItem.hsn || '',
                price: existingItem.price || '',
                category: existingItem.category || 'Trade',
                sku: existingItem.sku || ''
            });
        } else {
            setFormData({ ...formData, name: newName });
        }
    };

    const determineStatus = (quantity: number) => {
        if (quantity === 0) return { status: 'Out of Stock', statusColor: '#ef4444' };
        if (quantity < 10) return { status: 'Low Stock', statusColor: '#f59e0b' };
        return { status: 'In Stock', statusColor: '#10b981' };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setActionLoading(true);

        let finalSku = formData.sku.trim();
        if (finalSku && !/^SKU-[A-Z0-9-]+$/.test(finalSku)) {
            setError("wrong sku format");
            setActionLoading(false);
            return;
        }

        if (!finalSku) {
            finalSku = `SKU-${Date.now().toString(36).toUpperCase()}`;
        }

        const autoStatus = determineStatus(Number(formData.quantity));
        const finalData = { ...formData, ...autoStatus, sku: finalSku };

        if (editingId) {
            const { error } = await updateInventoryItem(activeOrg.orgId, editingId, finalData);
            if (error) setError(error);
            else setShowModal(false);
        } else {
            const existingItem = items.find(i => i.name.toLowerCase() === finalData.name.toLowerCase());

            if (existingItem) {
                const confirmUpdate = window.confirm(`A product named "${existingItem.name}" already exists. Do you want to add this quantity to the existing product instead of creating a duplicate?`);
                if (confirmUpdate) {
                    const newQuantity = Number(existingItem.quantity) + Number(finalData.quantity);
                    const updateData = { ...finalData, quantity: newQuantity };

                    const { error } = await updateInventoryItem(activeOrg.orgId, existingItem.id as string, updateData);
                    if (error) setError(error);
                    else setShowModal(false);
                    setActionLoading(false);
                    return;
                }
            }

            const { error } = await addInventoryItem(activeOrg.orgId, finalData, user.uid);
            if (error) setError(error);
            else setShowModal(false);
        }

        setActionLoading(false);
    };

    const handleBulkSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setActionLoading(true);

        try {
            if (bulkItems.length === 0) throw new Error("No items to add.");

            const finalItems = bulkItems.map((item, index) => {
                const name = String(item.name || "").trim();
                if (!name) throw new Error(`Item at row ${index + 1} is missing a name.`);

                let sku = String(item.sku || "").trim();
                if (sku && !/^SKU-[A-Z0-9-]+$/.test(sku)) {
                    throw new Error(`wrong sku format`);
                }
                if (!sku) sku = `SKU-${Date.now().toString(36).toUpperCase()}-${index}`;

                const qty = Number(item.quantity) || 0;
                const autoStatus = determineStatus(qty);

                return {
                    name,
                    hsn: String(item.hsn || ""),
                    quantity: qty,
                    price: String(item.price || ""),
                    sku,
                    category: String(item.category || "Trade"),
                    ...autoStatus
                };
            });

            const { error } = await addBulkInventoryItems(activeOrg.orgId, finalItems as any, user.uid);
            if (error) setError(error);
            else {
                setShowBulkModal(false);
                setBulkItems([{ name: '', quantity: 0, price: '', sku: '', category: 'Trade' }]);
            }
        } catch (err: any) {
            setError(err.message);
        }

        setActionLoading(false);
    };

    const handleDelete = async (itemId: string) => {
        if (!confirm("Are you sure you want to delete this item?")) return;

        const { error } = await deleteInventoryItem(activeOrg.orgId, itemId);
        if (error) alert(error);
    };

    // Dashboard Stats calculation
    const totalValue = items.reduce((acc, item) => {
        const numPrice = parseFloat(item.price.replace(/[^0-9.-]+/g, ""));
        return acc + (isNaN(numPrice) ? 0 : numPrice * item.quantity);
    }, 0);
    const lowStockCount = items.filter(i => i.quantity > 0 && i.quantity < 10).length;

    // Filter and Sort Logic
    const filteredAndSortedItems = [...items]
        .filter(item => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (
                item.name.toLowerCase().includes(q) ||
                (item.sku && String(item.sku).toLowerCase().includes(q)) ||
                (item.hsn && String(item.hsn).toLowerCase().includes(q))
            );
        })
        .sort((a, b) => {
            switch (sortParam) {
                case "Name (A-Z)":
                    return a.name.localeCompare(b.name);
                case "Name (Z-A)":
                    return b.name.localeCompare(a.name);
                case "Quantity (Low-High)":
                    return a.quantity - b.quantity;
                case "Quantity (High-Low)":
                    return b.quantity - a.quantity;
                case "Price (Low-High)": {
                    const priceA = parseFloat(a.price.replace(/[^0-9.-]+/g, "")) || 0;
                    const priceB = parseFloat(b.price.replace(/[^0-9.-]+/g, "")) || 0;
                    return priceA - priceB;
                }
                case "Price (High-Low)": {
                    const priceA = parseFloat(a.price.replace(/[^0-9.-]+/g, "")) || 0;
                    const priceB = parseFloat(b.price.replace(/[^0-9.-]+/g, "")) || 0;
                    return priceB - priceA;
                }
                case "Default":
                default:
                    return 0;
            }
        });

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Inventory</h1>
                    <p style={{ opacity: 0.7 }}>Manage {activeOrg.name}'s products and stock levels.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn-primary" onClick={() => setShowBulkModal(true)} style={{ background: 'var(--surface-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)' }}>
                        <UploadCloud size={18} style={{ marginRight: '8px' }} /> Bulk Add
                    </button>
                    <button className="btn-primary" onClick={() => handleOpenModal()}>
                        <PlusCircle size={18} style={{ marginRight: '8px' }} /> Add New Item
                    </button>
                </div>
            </header>

            <div className="grid-dashboard" style={{ marginTop: '24px', marginBottom: '32px' }}>
                <div className="glass-panel stat-card" style={{ padding: '20px' }}>
                    <span className="stat-title">Total Products</span>
                    <span className="stat-value">{items.length}</span>
                </div>
                <div className="glass-panel stat-card" style={{ padding: '20px' }}>
                    <span className="stat-title">Low Stock Alerts</span>
                    <span className="stat-value" style={{ color: '#ef4444' }}>{lowStockCount}</span>
                </div>
                <div className="glass-panel stat-card" style={{ padding: '20px' }}>
                    <span className="stat-title">Estimated Value</span>
                    <span className="stat-value">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
            </div>

            <div className="flex-between" style={{ marginBottom: '16px', gap: '16px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search by Name, SKU, or HSN..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            maxWidth: '400px',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-color)'
                        }}
                    />
                </div>
                <div>
                    <select
                        value={sortParam}
                        onChange={(e) => setSortParam(e.target.value)}
                        style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-color)',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="Default">Sort By...</option>
                        <option value="Name (A-Z)">Name (A-Z)</option>
                        <option value="Name (Z-A)">Name (Z-A)</option>
                        <option value="Quantity (Low-High)">Quantity (Low-High)</option>
                        <option value="Quantity (High-Low)">Quantity (High-Low)</option>
                        <option value="Price (Low-High)">Price (Low-High)</option>
                        <option value="Price (High-Low)">Price (High-Low)</option>
                    </select>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: '800px', width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--border-color)' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Name</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>HSN</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Quantity</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Price</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>SKU</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Category</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Status</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
                            ) : filteredAndSortedItems.length === 0 ? (
                                <tr><td colSpan={8} style={{ padding: '48px', textAlign: 'center', opacity: 0.6 }}>No inventory items match your search.</td></tr>
                            ) : (
                                filteredAndSortedItems.map((item, i) => (
                                    <tr key={item.id || i} style={{ borderBottom: i < filteredAndSortedItems.length - 1 ? '1px solid var(--border-color)' : 'none', transition: 'var(--transition)' }} className="table-row-hover">
                                        <td style={{ padding: '16px 24px', fontWeight: 500 }}>{item.name}</td>
                                        <td style={{ padding: '16px 24px', fontFamily: 'var(--font-geist-mono)', fontSize: '0.875rem', opacity: 0.8 }}>{item.hsn}</td>
                                        <td style={{ padding: '16px 24px' }}>{item.quantity}</td>
                                        <td style={{ padding: '16px 24px', fontWeight: 500 }}>{item.price}</td>
                                        <td style={{ padding: '16px 24px', fontFamily: 'var(--font-geist-mono)', fontSize: '0.875rem', opacity: 0.8 }}>{item.sku}</td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', background: 'var(--border-color)' }}>
                                                {item.category}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, background: `${item.statusColor}20`, color: item.statusColor }}>
                                                {item.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => handleOpenModal(item)} style={{ color: 'var(--text-color)', opacity: 0.7 }} title="Edit">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(item.id as string)} style={{ color: '#ef4444', opacity: 0.7 }} title="Delete">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', background: 'var(--surface-color)', position: 'relative' }}>
                        <button
                            onClick={() => setShowModal(false)}
                            style={{ position: 'absolute', top: '16px', right: '16px', opacity: 0.5, fontSize: '1.5rem', lineHeight: 1 }}
                        >
                            &times;
                        </button>
                        <h2 style={{ marginBottom: '24px' }}>{editingId ? 'Edit Item' : 'Add New Item'}</h2>

                        {error && <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '20px', fontSize: '0.875rem' }}>{error}</div>}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 2 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Name</label>
                                    <input type="text" list="product-names" required value={formData.name} onChange={handleNameChange} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                    <datalist id="product-names">
                                        {uniqueProductNames.map(name => <option key={name} value={name} />)}
                                    </datalist>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>SKU <span style={{ opacity: 0.5, fontWeight: 'normal' }}>(Optional)</span></label>
                                    <input type="text" placeholder="Auto-generated if empty" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>HSN</label>
                                    <input type="text" required value={formData.hsn} onChange={e => setFormData({ ...formData, hsn: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Quantity</label>
                                    <input type="number" min="0" required value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: Number(e.target.value) })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Price <span style={{ opacity: 0.5, fontWeight: 'normal' }}>(Optional)</span></label>
                                    <input type="text" placeholder="$0.00" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Category</label>
                                    <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}>
                                        <option value="Trade">Trade</option>
                                        <option value="Manufacture">Manufacture</option>
                                    </select>
                                </div>
                            </div>

                            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '8px', padding: '12px' }} disabled={actionLoading}>
                                {actionLoading ? "Saving..." : "Save Item"}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showBulkModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', background: 'var(--surface-color)', position: 'relative', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
                        <button
                            onClick={() => setShowBulkModal(false)}
                            style={{ position: 'absolute', top: '16px', right: '16px', opacity: 0.5, fontSize: '1.5rem', lineHeight: 1 }}
                        >
                            &times;
                        </button>
                        <h2 style={{ marginBottom: '16px' }}>Bulk Add Inventory</h2>
                        <p style={{ opacity: 0.7, marginBottom: '24px', fontSize: '0.875rem' }}>Add multiple items at once to your inventory.</p>

                        {error && <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '20px', fontSize: '0.875rem', flexShrink: 0 }}>{error}</div>}

                        <form onSubmit={handleBulkSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
                            <div style={{ overflowY: 'auto', paddingRight: '12px', flex: 1 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead style={{ background: 'var(--border-color)', position: 'sticky', top: 0, zIndex: 1 }}>
                                        <tr>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Name*</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Quantity*</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Price</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>HSN</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>SKU</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Category</th>
                                            <th style={{ padding: '12px 16px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '50px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bulkItems.map((item, index) => (
                                            <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input required type="text" list="bulk-product-names" placeholder="Product name" value={item.name || ''} onChange={e => {
                                                        const newName = e.target.value;
                                                        const existing = items.find(i => i.name.toLowerCase() === newName.toLowerCase());
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = existing ? { ...newArr[index], name: newName, hsn: existing.hsn, price: existing.price, category: existing.category } : { ...newArr[index], name: newName };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)', minWidth: '150px' }} />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input required type="number" min="0" placeholder="0" value={item.quantity ?? 0} onChange={e => {
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = { ...newArr[index], quantity: Number(e.target.value) };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '80px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input type="text" placeholder="$0.00" value={item.price || ''} onChange={e => {
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = { ...newArr[index], price: e.target.value };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '100px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input type="text" placeholder="HSN" value={item.hsn || ''} onChange={e => {
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = { ...newArr[index], hsn: e.target.value };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '100%', minWidth: '80px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <input type="text" placeholder="Auto" value={item.sku || ''} onChange={e => {
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = { ...newArr[index], sku: e.target.value };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '100%', minWidth: '100px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                </td>
                                                <td style={{ padding: '8px 4px' }}>
                                                    <select value={item.category || "Trade"} onChange={e => {
                                                        const newArr = [...bulkItems];
                                                        newArr[index] = { ...newArr[index], category: e.target.value };
                                                        setBulkItems(newArr);
                                                    }} style={{ width: '100%', minWidth: '110px', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}>
                                                        <option value="Trade">Trade</option>
                                                        <option value="Manufacture">Manufacture</option>
                                                    </select>
                                                </td>
                                                <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                                    {bulkItems.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setBulkItems(bulkItems.filter((_, i) => i !== index))}
                                                            style={{ color: '#ef4444', opacity: 0.6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                                                            title="Remove Row"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <datalist id="bulk-product-names">
                                {uniqueProductNames.map(name => <option key={name} value={name} />)}
                            </datalist>

                            <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', flexShrink: 0 }}>
                                <button type="button" onClick={() => setBulkItems([...bulkItems, { name: '', quantity: 0, price: '', hsn: '', sku: '', category: 'Trade' }])} className="btn-primary" style={{ flex: 1, background: 'var(--bg-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)' }}>
                                    <PlusCircle size={16} style={{ marginRight: '8px', display: 'inline' }} /> Add Row
                                </button>
                                <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={actionLoading}>
                                    {actionLoading ? "Processing..." : `Import ${bulkItems.length} Items`}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
