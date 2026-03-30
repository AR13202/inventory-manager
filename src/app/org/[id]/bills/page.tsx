"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { Plus, Search, FileText, X, Edit, Trash2, Camera, Upload } from "lucide-react";
import {
    BillItem,
    subscribeToBills,
    addBillItem,
    updateBillItem,
    deleteBillItem
} from "@/utils/firebaseHelpers/bills";
import { addBulkInventoryItems, subscribeToInventory, InventoryItem } from "@/utils/firebaseHelpers/inventory";
import { addCompanyItem, Company } from "@/utils/firebaseHelpers/companies";
import { scanReceipt } from "@/utils/geminiScanner";

export default function BillsView({ params }: { params: Promise<{ id: string }> }) {
    const { user } = useAuth();
    const { activeOrg } = useOrg();

    const [bills, setBills] = useState<BillItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [sortParam, setSortParam] = useState("Date (Newest)");

    const [showModal, setShowModal] = useState(false);
    const [scanMode, setScanMode] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");

    const [scanning, setScanning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [scannedImage, setScannedImage] = useState<string | null>(null);

    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [pendingScannedProducts, setPendingScannedProducts] = useState<any[]>([]);
    const [showPendingProductsModal, setShowPendingProductsModal] = useState(false);

    // Store both parsed companies to allow swapping when changing Bill Type manually
    const [parsedCompanies, setParsedCompanies] = useState<{ parent: any, customer: any } | null>(null);

    // Form data
    const [formData, setFormData] = useState<Partial<BillItem> & { vendorGst?: string; vendorAddress?: string; vendorPhone?: string }>({
        vendorName: "",
        vendorGst: "",
        vendorAddress: "",
        vendorPhone: "",
        billType: "Purchase",
        products: [{ name: "", quantity: 1, price: 0, hsn: "", category: "Trade" }],
        taxAmount: 0,
        taxDetails: [],
        freightAndForwardingCharges: 0,
        roundOff: 0,
        grossAmount: 0,
        amount: 0,
        date: new Date().toISOString().split("T")[0]
    });

    const [editingId, setEditingId] = useState<string | null>(null);

    const resolvedParams = React.use(params);

    useEffect(() => {
        if (!user || !activeOrg || activeOrg.orgId !== resolvedParams.id) return;

        const unsubscribeBills = subscribeToBills(activeOrg.orgId, (items) => {
            setBills(items);
            setLoading(false);
        });

        const unsubscribeInventory = subscribeToInventory(activeOrg.orgId, (items) => {
            setInventoryItems(items);
        });

        return () => {
            unsubscribeBills();
            unsubscribeInventory();
        };
    }, [user, activeOrg, resolvedParams.id]);

    const handleOpenModal = (bill?: BillItem) => {
        if (bill) {
            setEditingId(bill.id as string);
            setFormData({
                ...bill,
                taxDetails: Array.isArray(bill.taxDetails) ? bill.taxDetails : []
            });
            setParsedCompanies(null);
            setScannedImage(bill.photoUrl || null);
        } else {
            setEditingId(null);
            setFormData({
                vendorName: "",
                vendorGst: "",
                vendorAddress: "",
                vendorPhone: "",
                billType: "Purchase",
                products: [{ name: "", quantity: 1, price: 0, hsn: "", category: "Trade" }],
                taxAmount: 0,
                taxDetails: [],
                freightAndForwardingCharges: 0,
                roundOff: 0,
                grossAmount: 0,
                amount: 0,
                date: new Date().toISOString().split("T")[0]
            });
            setScannedImage(null);
            setParsedCompanies(null);
        }
        setError("");
        setShowModal(true);
    };

    const handleProductChange = (index: number, field: string, value: any) => {
        const updatedProducts = [...(formData.products || [])];
        updatedProducts[index] = { ...updatedProducts[index], [field]: value };

        if (field === "name") {
            const found = inventoryItems.find(inv => inv.name.toLowerCase() === String(value).toLowerCase());
            if (found) {
                updatedProducts[index].hsn = found.hsn;
                updatedProducts[index].category = found.category || "Trade";
            }
        }

        // Recalculate totals
        const gross = updatedProducts.reduce((sum, p) => sum + (Number(p.price) * Number(p.quantity)), 0);
        const taxSum = (formData.taxDetails || []).reduce((sum: number, t: any) => sum + Number(t.taxAmount || 0), 0);
        const total = gross + taxSum + Number(formData.freightAndForwardingCharges || 0) + Number(formData.roundOff || 0);

        setFormData({ ...formData, products: updatedProducts, grossAmount: gross, taxAmount: taxSum, amount: total });
    };

    const handleTaxChange = (index: number, field: string, value: any) => {
        const updatedTaxes = [...(formData.taxDetails || [])];
        updatedTaxes[index] = { ...updatedTaxes[index], [field]: value };

        const gross = Number(formData.grossAmount || 0);
        const taxSum = updatedTaxes.reduce((sum: number, t: any) => sum + Number(t.taxAmount || 0), 0);
        const total = gross + taxSum + Number(formData.freightAndForwardingCharges || 0) + Number(formData.roundOff || 0);

        setFormData({ ...formData, taxDetails: updatedTaxes, taxAmount: taxSum, amount: total });
    };

    const handleAddTaxRow = () => {
        setFormData({
            ...formData,
            taxDetails: [...(formData.taxDetails || []), { taxType: "CGST", taxPercentage: 0, taxAmount: 0 }]
        });
    };

    const handleRemoveTaxRow = (index: number) => {
        const updatedTaxes = formData.taxDetails?.filter((_, i) => i !== index) || [];
        const gross = Number(formData.grossAmount || 0);
        const taxSum = updatedTaxes.reduce((sum: number, t: any) => sum + Number(t.taxAmount || 0), 0);
        const total = gross + taxSum + Number(formData.freightAndForwardingCharges || 0) + Number(formData.roundOff || 0);

        setFormData({ ...formData, taxDetails: updatedTaxes, taxAmount: taxSum, amount: total });
    };

    const handleAddProductRow = () => {
        setFormData({
            ...formData,
            products: [...(formData.products || []), { name: "", quantity: 1, price: 0, hsn: "", category: "Trade" }]
        });
    };

    const handleRemoveProductRow = (index: number) => {
        const updatedProducts = formData.products?.filter((_, i) => i !== index);
        setFormData({ ...formData, products: updatedProducts });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setScanning(true);
        setError("");

        try {
            // Convert file to base64 for display and API
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64Data = reader.result as string;
                setScannedImage(base64Data);

                // Call Gemini to parse
                const parsedData = await scanReceipt(base64Data);
                if (parsedData) {

                    // Logic to use Parent or Customer depending on category. Default assumption: if vendor is generating bill, and we are paying it, it's a purchase. 
                    const billCategory = formData.billType || "Purchase";
                    let matchedCompany = null;

                    if (billCategory === "Purchase") {
                        matchedCompany = parsedData.parentCompanyDetails;
                    } else {
                        matchedCompany = parsedData.customerCompanyDetails;
                    }

                    // Save to state so user can flip them dynamically
                    setParsedCompanies({
                        parent: parsedData.parentCompanyDetails,
                        customer: parsedData.customerCompanyDetails
                    });

                    let rawProducts = parsedData.items && parsedData.items.length > 0 ? parsedData.items : formData.products;
                    const enrichedProducts = rawProducts.map((p: any) => {
                        const found = inventoryItems.find(inv => inv.name.toLowerCase() === p.name?.toLowerCase());
                        return {
                            ...p,
                            name: p.name || "",
                            quantity: p.quantity || 1,
                            price: p.price || 0,
                            hsn: p.hsn || found?.hsn || "",
                            category: found ? found.category : (p.category || "Trade")
                        };
                    });

                    const hasMissingDetails = enrichedProducts.some((p: any) => !p.name || !p.hsn || !p.quantity);

                    if (hasMissingDetails) {
                        setPendingScannedProducts(enrichedProducts);
                        setShowPendingProductsModal(true);
                    }

                    // Pre-fill form
                    setFormData({
                        ...formData,
                        vendorName: (matchedCompany?.name && matchedCompany.name.trim() !== "") ? matchedCompany.name : formData.vendorName,
                        vendorGst: matchedCompany?.gst || "",
                        vendorAddress: matchedCompany?.address || "",
                        vendorPhone: matchedCompany?.phoneNumbers || "",
                        taxAmount: parsedData.taxAmount || formData.taxAmount || 0,
                        taxDetails: Array.isArray(parsedData.taxDetails) ? parsedData.taxDetails.map((t: any) => ({
                            taxType: t.taxType || 'Tax',
                            taxPercentage: t.taxPercentage || parsedData.taxPercentage || 0,
                            taxAmount: t.taxAmount || 0
                        })) : (Array.isArray(formData.taxDetails) ? formData.taxDetails : []),
                        freightAndForwardingCharges: parsedData.freightAndForwardingCharges || formData.freightAndForwardingCharges || 0,
                        roundOff: parsedData.roundOff || formData.roundOff || 0,
                        amount: parsedData.totalAmount || formData.amount || 0,
                        products: hasMissingDetails ? (formData.products || []) : enrichedProducts,
                        isScanned: true,
                        photoUrl: base64Data,
                        date: parsedData.date || new Date().toISOString().split("T")[0]
                    });

                    // Check for missing items that might block DB generation if empty
                    if (!matchedCompany?.name || !matchedCompany?.gst || !matchedCompany?.address) {
                        setError(`Notice: Found missing company details (Name, GST, or Address). Please fill them in the form. Automatically generated entries might be incomplete.`);
                    }

                } else {
                    setError("Failed to parse the receipt. Please enter manually.");
                }
                setScanning(false);
            };
        } catch (err: any) {
            setError(err.message || "Error reading file");
            setScanning(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setActionLoading(true);

        if (!activeOrg || !user) return;

        try {
            let finalPhotoUrl = formData.photoUrl;

            // Upload to Cloudinary if it's a new local base64 scan
            if (formData.isScanned && finalPhotoUrl && finalPhotoUrl.startsWith('data:image')) {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: finalPhotoUrl }),
                });
                const data = await res.json();
                if (data.success) {
                    finalPhotoUrl = data.url;
                } else {
                    console.error("Cloudinary Error:", data.error);
                }
            }

            if (editingId) {
                const { error: updateError } = await updateBillItem(activeOrg.orgId, editingId, {
                    ...formData, photoUrl: finalPhotoUrl
                } as BillItem);
                if (updateError) throw new Error(updateError);
            } else {
                const billItemToSave = { ...formData };
                delete (billItemToSave as any).vendorGst;
                delete (billItemToSave as any).vendorAddress;
                delete (billItemToSave as any).vendorPhone;

                const { error: addError } = await addBillItem(activeOrg.orgId, {
                    ...billItemToSave,
                    photoUrl: finalPhotoUrl,
                    createdBy: user.uid
                } as BillItem, user.uid);
                if (addError) throw new Error(addError);

                // Also create the Company automatically so they don't switch tabs
                if (formData.vendorName) {
                    await addCompanyItem(activeOrg.orgId, {
                        name: formData.vendorName,
                        createdBy: user.uid,
                        address: formData.vendorAddress || "",
                        gst: formData.vendorGst || "",
                        phoneNumbers: formData.vendorPhone || ""
                    });
                }

                // Add/Update products in inventory based on BillType
                if (formData.products && formData.products.length > 0) {
                    const existingItemsMap = new Map();
                    inventoryItems.forEach(item => existingItemsMap.set(item.name.toLowerCase(), item));

                    const inventoryItemsPayload = formData.products.map(p => {
                        const existing = existingItemsMap.get(p.name.toLowerCase());

                        let qtyDelta = formData.billType === "Purchase" ? Number(p.quantity) : -Number(p.quantity);
                        if (!existing && formData.billType === "Sell") {
                            // If product didn't exist, technically we sold 0 of an invisible stock.
                            // To prevent new random items starting at -X, start them at 0.
                            qtyDelta = 0;
                        }

                        return {
                            name: p.name,
                            hsn: p.hsn || existing?.hsn || "",
                            quantity: qtyDelta,
                            price: String(p.price),
                            sku: existing?.sku || ("SKU-" + Math.random().toString(36).substring(2, 10).toUpperCase()),
                            category: p.category || existing?.category || "Trade",
                            status: "In Stock",
                            statusColor: "#10b981"
                        };
                    });
                    await addBulkInventoryItems(activeOrg.orgId, inventoryItemsPayload, user.uid);
                }
            }

            setShowModal(false);
        } catch (err: any) {
            setError(err.message);
        }
        setActionLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (!activeOrg) return;
        if (window.confirm("Are you sure you want to delete this bill?")) {
            await deleteBillItem(activeOrg.orgId, id);
        }
    };

    const filteredBills = bills.filter(b =>
        (b.vendorName?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
        (b.id?.toLowerCase() || "").includes(searchQuery.toLowerCase())
    ).sort((a, b) => {
        if (sortParam === "Date (Newest)") return new Date(b.date).getTime() - new Date(a.date).getTime();
        return 0;
    });

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <h1 className="dashboard-title">Bills & Receipts</h1>
                    <p className="dashboard-subtitle">Manage purchase and sales bills, scan receipts automatically.</p>
                </div>
                <div>
                    <button onClick={() => handleOpenModal()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Plus size={18} /> Add Bill
                    </button>
                </div>
            </header>

            <div className="flex-between" style={{ marginBottom: '16px', gap: '16px', marginTop: '24px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search by Vendor or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%', maxWidth: '400px', padding: '10px 16px',
                            borderRadius: '8px', border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)', color: 'var(--text-color)'
                        }}
                    />
                </div>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: '800px', width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--border-color)' }}>
                            <tr>
                                <th style={{ padding: '16px 24px' }}>Bill ID</th>
                                <th style={{ padding: '16px 24px' }}>Date</th>
                                <th style={{ padding: '16px 24px' }}>Vendor</th>
                                <th style={{ padding: '16px 24px' }}>Category</th>
                                <th style={{ padding: '16px 24px' }}>Total Amount</th>
                                <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
                            ) : filteredBills.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '48px', textAlign: 'center', opacity: 0.6 }}>No bills found. Click "Add Bill" to get started.</td></tr>
                            ) : (
                                filteredBills.map((b, i) => (
                                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border-color)' }} className="table-row-hover">
                                        <td style={{ padding: '16px 24px', fontFamily: 'var(--font-geist-mono)', opacity: 0.8 }}>{b.id}</td>
                                        <td style={{ padding: '16px 24px' }}>{b.date}</td>
                                        <td style={{ padding: '16px 24px', fontWeight: 500 }}>{b.vendorName}</td>
                                        <td style={{ padding: '16px 24px' }}>
                                            <span style={{
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '12px',
                                                background: b.billType === 'Sell' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                                color: b.billType === 'Sell' ? '#10b981' : '#ef4444'
                                            }}>{b.billType}</span>
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: 'bold' }}>₹{b.amount}</td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => handleOpenModal(b)} className="btn-secondary" style={{ padding: '6px' }} title="Edit"><Edit size={16} /></button>
                                                <button onClick={() => handleDelete(b.id as string)} className="btn-secondary" style={{ padding: '6px', color: '#ef4444' }} title="Delete"><Trash2 size={16} /></button>
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
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
                        <button onClick={() => setShowModal(false)} style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', color: 'var(--text-color)', cursor: 'pointer' }}>
                            <X size={20} />
                        </button>

                        <h2 style={{ fontSize: '1.25rem', marginBottom: '24px' }}>{editingId ? 'Edit Bill' : 'Add New Bill'}</h2>

                        {!editingId && !scanMode && !formData.isScanned && (
                            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                                <button type="button" onClick={() => setScanMode(true)} className="btn-primary" style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px' }}>
                                    <Camera size={18} /> Scan a Bill
                                </button>
                                <button type="button" className="btn-secondary" style={{ flex: 1 }} disabled>
                                    Manual Fill
                                </button>
                            </div>
                        )}

                        {scanMode && !formData.isScanned && (
                            <div style={{ marginBottom: '24px', padding: '24px', border: '2px dashed var(--border-color)', borderRadius: '8px', textAlign: 'center' }}>
                                <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                                <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary" disabled={scanning}>
                                    {scanning ? 'Scanning & Parsing...' : 'Select Image File'}
                                </button>
                                {error && <p style={{ color: '#ef4444', marginTop: '12px' }}>{error}</p>}
                                <button type="button" onClick={() => setScanMode(false)} className="btn-secondary" style={{ marginTop: '12px', marginLeft: '12px' }}>Cancel</button>
                            </div>
                        )}

                        {error && !scanMode && <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>{error}</div>}

                        <form onSubmit={handleSubmit} style={{ display: (!scanMode || formData.isScanned) ? 'flex' : 'none', flexDirection: 'column', gap: '16px' }}>

                            {scannedImage && (
                                <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                                    <div style={{ maxWidth: '100%', overflowX: 'auto', display: 'flex', justifyContent: 'center' }}>
                                        <img src={scannedImage} alt="Scanned Bill" style={{ maxHeight: '300px', borderRadius: '8px', border: '1px solid var(--border-color)', objectFit: 'contain' }} />
                                    </div>
                                    {formData.isScanned && <p style={{ fontSize: '12px', color: '#10b981', marginTop: '8px' }}>✓ Data Extracted Successfully</p>}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Vendor / Company Name*</label>
                                    <input required type="text" value={formData.vendorName} onChange={e => setFormData({ ...formData, vendorName: e.target.value })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Bill Category*</label>
                                    <select value={formData.billType} onChange={e => {
                                        const newType = e.target.value as "Purchase" | "Sell";
                                        let updates = { billType: newType } as any;

                                        if (parsedCompanies && formData.isScanned) {
                                            const swapCompany = newType === "Purchase" ? parsedCompanies.parent : parsedCompanies.customer;
                                            updates.vendorName = swapCompany?.name || "";
                                            updates.vendorGst = swapCompany?.gst || "";
                                            updates.vendorAddress = swapCompany?.address || "";
                                            updates.vendorPhone = swapCompany?.phoneNumbers || "";
                                        }

                                        setFormData({ ...formData, ...updates });
                                    }} style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}>
                                        <option value="Purchase">Purchase (Increments Inventory)</option>
                                        <option value="Sell">Sell (Decrements Inventory)</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '16px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Vendor GST</label>
                                    <input type="text" value={formData.vendorGst} onChange={e => setFormData({ ...formData, vendorGst: e.target.value })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Vendor Address</label>
                                    <input type="text" value={formData.vendorAddress} onChange={e => setFormData({ ...formData, vendorAddress: e.target.value })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Vendor Phone</label>
                                    <input type="text" value={formData.vendorPhone} onChange={e => setFormData({ ...formData, vendorPhone: e.target.value })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                            </div>

                            <div>
                                <h3 style={{ fontSize: '1rem', marginTop: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Products</h3>

                                <datalist id="inventory-products-list">
                                    {inventoryItems.map(item => (
                                        <option key={item.id} value={item.name} />
                                    ))}
                                </datalist>

                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '700px' }}>
                                        <thead style={{ background: 'var(--border-color)' }}>
                                            <tr>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Product Name*</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '120px' }}>HSN*</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '140px' }}>Category*</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '100px' }}>Qty*</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '120px' }}>Price*</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {formData.products?.map((p, index) => (
                                                <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="text" list="inventory-products-list" placeholder="Product Name" value={p.name} onChange={e => handleProductChange(index, "name", e.target.value)} required
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="text" placeholder="HSN" value={p.hsn || ""} onChange={e => handleProductChange(index, "hsn", e.target.value)} required
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <select value={p.category || "Trade"} onChange={e => handleProductChange(index, "category", e.target.value)} required
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}>
                                                            <option value="Trade">Trade</option>
                                                            <option value="Manufactured">Manufactured</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="number" placeholder="Qty" value={p.quantity} onChange={e => handleProductChange(index, "quantity", e.target.value)} required
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="number" placeholder="Price" value={p.price} onChange={e => handleProductChange(index, "price", e.target.value)} required
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                                        <button type="button" onClick={() => handleRemoveProductRow(index)} style={{ padding: '4px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <button type="button" onClick={handleAddProductRow} className="btn-secondary" style={{ marginTop: '12px', fontSize: '12px' }}>+ Add Product Line</button>
                            </div>

                            <div>
                                <h3 style={{ fontSize: '1rem', marginTop: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Taxes & Additional Charges</h3>

                                <div style={{ overflowX: 'auto', marginTop: '12px' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '500px' }}>
                                        <thead style={{ background: 'var(--border-color)' }}>
                                            <tr>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Tax Type</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '150px' }}>Percentage (%)</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '150px' }}>Tax Amount</th>
                                                <th style={{ padding: '8px 12px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {formData.taxDetails?.map((t, index) => (
                                                <tr key={index} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="text" placeholder="e.g. CGST" value={t.taxType} onChange={e => handleTaxChange(index, "taxType", e.target.value)}
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="number" step="any" placeholder="%" value={t.taxPercentage} onChange={e => handleTaxChange(index, "taxPercentage", e.target.value)}
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px' }}>
                                                        <input type="number" step="any" placeholder="Amount" value={t.taxAmount} onChange={e => handleTaxChange(index, "taxAmount", e.target.value)}
                                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                                    </td>
                                                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                                                        <button type="button" onClick={() => handleRemoveTaxRow(index)} style={{ padding: '4px', color: '#ef4444', background: 'transparent', border: 'none', cursor: 'pointer' }}><Trash2 size={16} /></button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <button type="button" onClick={handleAddTaxRow} className="btn-secondary" style={{ marginTop: '12px', fontSize: '12px' }}>+ Add Tax Line</button>
                            </div>

                            <div style={{ display: 'flex', gap: '16px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'flex-end', background: 'var(--surface-color)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <div style={{ flex: '1 1 150px', maxWidth: '200px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem' }}>Freight & Forwarding</label>
                                    <input type="number" step="any" value={formData.freightAndForwardingCharges || 0} onChange={e => setFormData({ ...formData, freightAndForwardingCharges: Number(e.target.value), amount: Number(formData.grossAmount) + Number(formData.taxAmount || 0) + Number(e.target.value) + Number(formData.roundOff || 0) })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: '1 1 150px', maxWidth: '200px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem' }}>Round Off</label>
                                    <input type="number" step="any" value={formData.roundOff || 0} onChange={e => setFormData({ ...formData, roundOff: Number(e.target.value), amount: Number(formData.grossAmount) + Number(formData.taxAmount || 0) + Number(formData.freightAndForwardingCharges || 0) + Number(e.target.value) })}
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: '1 1 150px', maxWidth: '200px' }}>
                                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 600 }}>Total Amount</label>
                                    <input type="number" value={formData.amount} disabled
                                        style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', opacity: 0.7, fontWeight: 600 }} />
                                </div>
                            </div>

                            <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                                <button type="button" onClick={() => { setShowModal(false); setScanMode(false); }} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                                <button type="submit" disabled={actionLoading} className="btn-primary" style={{ flex: 1 }}>{actionLoading ? 'Saving...' : 'Save Bill'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {showPendingProductsModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)', zIndex: 200,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
                }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h2 style={{ marginBottom: '16px' }}>Complete Missing Product Details</h2>
                        <p style={{ marginBottom: '16px', fontSize: '14px', opacity: 0.8 }}>Some scanned products are missing mandatory details (Name, HSN, Quantity). Please fill them to proceed.</p>

                        <datalist id="inventory-products-modal-list">
                            {inventoryItems.map(item => (
                                <option key={item.id} value={item.name} />
                            ))}
                        </datalist>

                        {pendingScannedProducts.map((p, index) => (
                            <div key={index} style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                                <div style={{ flex: 2, minWidth: '150px' }}>
                                    <label style={{ fontSize: '12px', opacity: 0.8 }}>Product Name*</label>
                                    <input type="text" list="inventory-products-modal-list" required value={p.name || ""} onChange={(e) => {
                                        const upd = [...pendingScannedProducts];
                                        upd[index].name = e.target.value;
                                        setPendingScannedProducts(upd);
                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: '100px' }}>
                                    <label style={{ fontSize: '12px', opacity: 0.8 }}>HSN*</label>
                                    <input type="text" required value={p.hsn || ""} onChange={(e) => {
                                        const upd = [...pendingScannedProducts];
                                        upd[index].hsn = e.target.value;
                                        setPendingScannedProducts(upd);
                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: '100px' }}>
                                    <label style={{ fontSize: '12px', opacity: 0.8 }}>Category*</label>
                                    <select value={p.category || "Trade"} onChange={(e) => {
                                        const upd = [...pendingScannedProducts];
                                        upd[index].category = e.target.value;
                                        setPendingScannedProducts(upd);
                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}>
                                        <option value="Trade">Trade</option>
                                        <option value="Manufactured">Manufactured</option>
                                    </select>
                                </div>
                                <div style={{ flex: 1, minWidth: '80px' }}>
                                    <label style={{ fontSize: '12px', opacity: 0.8 }}>Qty*</label>
                                    <input type="number" required value={p.quantity || ""} onChange={(e) => {
                                        const upd = [...pendingScannedProducts];
                                        upd[index].quantity = Number(e.target.value);
                                        setPendingScannedProducts(upd);
                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                                <div style={{ flex: 1, minWidth: '80px' }}>
                                    <label style={{ fontSize: '12px', opacity: 0.8 }}>Price</label>
                                    <input type="number" value={p.price || ""} onChange={(e) => {
                                        const upd = [...pendingScannedProducts];
                                        upd[index].price = Number(e.target.value);
                                        setPendingScannedProducts(upd);
                                    }} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }} />
                                </div>
                            </div>
                        ))}

                        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                            <button className="btn-secondary" onClick={() => setShowPendingProductsModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={() => {
                                const allValid = pendingScannedProducts.every(p => p.name && p.hsn && p.quantity);
                                if (!allValid) {
                                    alert("Please fill all required fields (Name, HSN, Qty) for all products.");
                                    return;
                                }
                                setFormData(prev => ({ ...prev, products: pendingScannedProducts }));
                                setShowPendingProductsModal(false);
                            }}>Confirm & Add to Bill</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
