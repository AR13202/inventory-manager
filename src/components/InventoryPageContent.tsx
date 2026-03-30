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
import { formatCurrencyINR } from "@/utils/formatters";

export default function InventoryPageContent() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();

    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortParam, setSortParam] = useState("Name (A-Z)");
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<InventoryItem>({
        name: "", hsn: "", unit: "", quantity: 0, price: "", sku: "", category: "Trade", status: "In Stock", statusColor: "#10b981"
    });
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkItems, setBulkItems] = useState<Partial<InventoryItem>[]>([{ name: "", quantity: 0, price: "", sku: "", category: "Trade", unit: "" }]);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const uniqueProductNames = Array.from(new Set(items.map((item) => item.name)));

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
                name: "", hsn: "", unit: "", quantity: 0, price: "", sku: "", category: "Trade", status: "In Stock", statusColor: "#10b981"
            });
        }
        setShowModal(true);
    };

    const handleNameChange = (name: string) => {
        const existingItem = items.find((item) => item.name.toLowerCase() === name.toLowerCase());
        if (existingItem && !editingId) {
            setFormData({
                ...formData,
                name,
                hsn: existingItem.hsn || "",
                unit: existingItem.unit || "",
                price: existingItem.price || "",
                category: existingItem.category || "Trade",
                sku: existingItem.sku || ""
            });
            return;
        }
        setFormData({ ...formData, name });
    };

    const determineStatus = (quantity: number) => {
        if (quantity === 0) return { status: "Out of Stock", statusColor: "#ef4444" };
        if (quantity < 10) return { status: "Low Stock", statusColor: "#f59e0b" };
        return { status: "In Stock", statusColor: "#10b981" };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setActionLoading(true);

        let finalSku = formData.sku.trim();
        if (finalSku && !/^SKU-[A-Z0-9-]+$/.test(finalSku)) {
            setError("Wrong SKU format.");
            setActionLoading(false);
            return;
        }
        if (!finalSku) {
            finalSku = `SKU-${Date.now().toString(36).toUpperCase()}`;
        }

        const autoStatus = determineStatus(Number(formData.quantity));
        const finalData = { ...formData, ...autoStatus, sku: finalSku };

        if (editingId) {
            const { error: updateError } = await updateInventoryItem(activeOrg.orgId, editingId, finalData);
            if (updateError) setError(updateError);
            else setShowModal(false);
        } else {
            const existingItem = items.find((item) => item.name.toLowerCase() === finalData.name.toLowerCase());
            if (existingItem) {
                const confirmUpdate = window.confirm(`"${existingItem.name}" already exists. Add this quantity to the existing item?`);
                if (confirmUpdate) {
                    const newQuantity = Number(existingItem.quantity) + Number(finalData.quantity);
                    const { error: updateError } = await updateInventoryItem(activeOrg.orgId, existingItem.id as string, {
                        ...finalData,
                        quantity: newQuantity
                    });
                    if (updateError) setError(updateError);
                    else setShowModal(false);
                    setActionLoading(false);
                    return;
                }
            }

            const { error: addError } = await addInventoryItem(activeOrg.orgId, finalData, user.uid);
            if (addError) setError(addError);
            else setShowModal(false);
        }

        setActionLoading(false);
    };

    const handleBulkSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setActionLoading(true);

        try {
            const finalItems = bulkItems.map((item, index) => {
                const name = String(item.name || "").trim();
                if (!name) throw new Error(`Item at row ${index + 1} is missing a name.`);

                let sku = String(item.sku || "").trim();
                if (sku && !/^SKU-[A-Z0-9-]+$/.test(sku)) {
                    throw new Error("Wrong SKU format.");
                }
                if (!sku) sku = `SKU-${Date.now().toString(36).toUpperCase()}-${index}`;

                const quantity = Number(item.quantity) || 0;
                return {
                    name,
                    hsn: String(item.hsn || ""),
                    unit: String(item.unit || ""),
                    quantity,
                    price: String(item.price || ""),
                    sku,
                    category: String(item.category || "Trade"),
                    ...determineStatus(quantity)
                };
            });

            const { error: bulkError } = await addBulkInventoryItems(activeOrg.orgId, finalItems as InventoryItem[], user.uid);
            if (bulkError) setError(bulkError);
            else {
                setShowBulkModal(false);
                setBulkItems([{ name: "", quantity: 0, price: "", sku: "", category: "Trade", unit: "" }]);
            }
        } catch (submitError: any) {
            setError(submitError.message);
        }

        setActionLoading(false);
    };

    const totalValue = items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const lowStockCount = items.filter((item) => Number(item.quantity) <= 10).length;

    const filteredItems = [...items]
        .filter((item) => {
            const q = searchQuery.toLowerCase();
            if (!q) return true;
            return (
                item.name.toLowerCase().includes(q) ||
                (item.sku || "").toLowerCase().includes(q) ||
                (item.hsn || "").toLowerCase().includes(q)
            );
        })
        .sort((a, b) => {
            if (sortParam === "Name (A-Z)") return a.name.localeCompare(b.name);
            if (sortParam === "Name (Z-A)") return b.name.localeCompare(a.name);
            if (sortParam === "Quantity (Low-High)") return a.quantity - b.quantity;
            if (sortParam === "Quantity (High-Low)") return b.quantity - a.quantity;
            return 0;
        });

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <h1 className="dashboard-title">Inventory</h1>
                    <p className="dashboard-subtitle">Manage {activeOrg.name}&apos;s products and stock levels.</p>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                    <button className="btn-secondary" onClick={() => setShowBulkModal(true)}>
                        <UploadCloud size={18} style={{ marginRight: "8px" }} /> Bulk Add
                    </button>
                    <button className="btn-primary" onClick={() => handleOpenModal()}>
                        <PlusCircle size={18} style={{ marginRight: "8px" }} /> Add Item
                    </button>
                </div>
            </header>

            <div className="grid-dashboard" style={{ marginTop: "8px", marginBottom: "24px" }}>
                <div className="glass-panel stat-card"><span className="stat-title">Total Products</span><span className="stat-value">{items.length}</span></div>
                <div className="glass-panel stat-card"><span className="stat-title">Low / Out of Stock</span><span className="stat-value">{lowStockCount}</span></div>
                <div className="glass-panel stat-card"><span className="stat-title">Inventory Value</span><span className="stat-value" style={{ fontSize: "2rem" }}>{formatCurrencyINR(totalValue)}</span></div>
            </div>

            <div className="flex-between" style={{ gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
                <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, SKU, or HSN..."
                    className="input-field"
                    style={{ maxWidth: "420px" }}
                />
                <select value={sortParam} onChange={(e) => setSortParam(e.target.value)} className="input-field" style={{ maxWidth: "220px" }}>
                    <option value="Name (A-Z)">Name (A-Z)</option>
                    <option value="Name (Z-A)">Name (Z-A)</option>
                    <option value="Quantity (Low-High)">Quantity (Low-High)</option>
                    <option value="Quantity (High-Low)">Quantity (High-Low)</option>
                </select>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: "860px", width: "100%", borderCollapse: "collapse" }}>
                        <thead style={{ background: "var(--border-color)" }}>
                            <tr>
                                {["Name", "HSN", "Unit", "Quantity", "Price", "SKU", "Status", "Actions"].map((label) => (
                                    <th key={label} style={{ padding: "16px 20px", textAlign: label === "Actions" ? "right" : "left" }}>{label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} style={{ padding: "24px", textAlign: "center" }}>Loading...</td></tr>
                            ) : filteredItems.length === 0 ? (
                                <tr><td colSpan={8} style={{ padding: "36px", textAlign: "center", opacity: 0.7 }}>No inventory items match your search.</td></tr>
                            ) : filteredItems.map((item) => (
                                <tr key={item.id} style={{ borderBottom: "1px solid var(--border-color)" }} className="table-row-hover">
                                    <td style={{ padding: "14px 20px", fontWeight: 600 }}>{item.name}</td>
                                    <td style={{ padding: "14px 20px" }}>{item.hsn || "-"}</td>
                                    <td style={{ padding: "14px 20px" }}>{item.unit || "-"}</td>
                                    <td style={{ padding: "14px 20px" }}>{item.quantity}</td>
                                    <td style={{ padding: "14px 20px" }}>{formatCurrencyINR(item.price)}</td>
                                    <td style={{ padding: "14px 20px" }}>{item.sku}</td>
                                    <td style={{ padding: "14px 20px" }}><span className="status-pill" style={{ background: `${item.statusColor}20`, color: item.statusColor }}>{item.status}</span></td>
                                    <td style={{ padding: "14px 20px", textAlign: "right" }}>
                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                                            <button onClick={() => handleOpenModal(item)} title="Edit"><Edit2 size={16} /></button>
                                            <button onClick={() => deleteInventoryItem(activeOrg.orgId, item.id as string)} title="Delete" style={{ color: "#ef4444" }}><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "560px", position: "relative" }}>
                        <button onClick={() => setShowModal(false)} className="panel-close">&times;</button>
                        <h2 style={{ marginBottom: "20px" }}>{editingId ? "Edit Item" : "Add Item"}</h2>
                        {error && <div className="error-banner">{error}</div>}
                        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
                            <div className="form-grid-2">
                                <div>
                                    <label className="section-label">Name</label>
                                    <input className="input-field" list="inventory-products" value={formData.name} onChange={(e) => handleNameChange(e.target.value)} required />
                                </div>
                                <div>
                                    <label className="section-label">SKU</label>
                                    <input className="input-field" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} />
                                </div>
                            </div>
                            <datalist id="inventory-products">
                                {uniqueProductNames.map((name) => <option key={name} value={name} />)}
                            </datalist>
                            <div className="form-grid-3">
                                <div><label className="section-label">HSN</label><input className="input-field" value={formData.hsn} onChange={(e) => setFormData({ ...formData, hsn: e.target.value })} required /></div>
                                <div><label className="section-label">Unit</label><input className="input-field" value={formData.unit || ""} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} placeholder="pcs, kg, box" /></div>
                                <div><label className="section-label">Quantity</label><input className="input-field" type="number" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })} required /></div>
                            </div>
                            <div className="form-grid-2">
                                <div><label className="section-label">Price</label><input className="input-field" type="number" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} /></div>
                                <div><label className="section-label">Category</label><select className="input-field" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}><option value="Trade">Trade</option><option value="Manufacture">Manufacture</option></select></div>
                            </div>
                            <button className="btn-primary" disabled={actionLoading}>{actionLoading ? "Saving..." : "Save Item"}</button>
                        </form>
                    </div>
                </div>
            )}

            {showBulkModal && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "840px", maxHeight: "90vh", overflow: "auto", position: "relative" }}>
                        <button onClick={() => setShowBulkModal(false)} className="panel-close">&times;</button>
                        <h2 style={{ marginBottom: "20px" }}>Bulk Add Inventory</h2>
                        {error && <div className="error-banner">{error}</div>}
                        <form onSubmit={handleBulkSubmit} style={{ display: "grid", gap: "14px" }}>
                            {bulkItems.map((item, index) => (
                                <div key={index} className="bill-section" style={{ padding: "14px" }}>
                                    <div className="form-grid-3">
                                        <input className="input-field" placeholder="Name" value={item.name || ""} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], name: e.target.value };
                                            setBulkItems(next);
                                        }} />
                                        <input className="input-field" placeholder="Unit" value={item.unit || ""} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], unit: e.target.value };
                                            setBulkItems(next);
                                        }} />
                                        <input className="input-field" type="number" placeholder="Quantity" value={item.quantity ?? 0} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], quantity: Number(e.target.value) };
                                            setBulkItems(next);
                                        }} />
                                    </div>
                                    <div className="form-grid-3" style={{ marginTop: "10px" }}>
                                        <input className="input-field" placeholder="Price" value={item.price || ""} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], price: e.target.value };
                                            setBulkItems(next);
                                        }} />
                                        <input className="input-field" placeholder="HSN" value={item.hsn || ""} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], hsn: e.target.value };
                                            setBulkItems(next);
                                        }} />
                                        <select className="input-field" value={item.category || "Trade"} onChange={(e) => {
                                            const next = [...bulkItems];
                                            next[index] = { ...next[index], category: e.target.value };
                                            setBulkItems(next);
                                        }}>
                                            <option value="Trade">Trade</option>
                                            <option value="Manufacture">Manufacture</option>
                                        </select>
                                    </div>
                                </div>
                            ))}
                            <div style={{ display: "flex", gap: "12px" }}>
                                <button type="button" className="btn-secondary" onClick={() => setBulkItems([...bulkItems, { name: "", quantity: 0, price: "", sku: "", category: "Trade", unit: "" }])}>Add Row</button>
                                <button className="btn-primary" disabled={actionLoading}>{actionLoading ? "Saving..." : `Import ${bulkItems.length} Items`}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
