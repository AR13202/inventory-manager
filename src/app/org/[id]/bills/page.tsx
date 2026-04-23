"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Edit, FileText, Filter, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { addBillItem, BillItem, deleteBillItem, subscribeToBills, updateBillItem } from "@/utils/firebaseHelpers/bills";
import {
    addCompanyLedgerEntry,
    Company,
    CompanyLedgerEntry,
    deleteCompanyLedgerEntry,
    ensureCompanyProfile,
    subscribeToCompanies,
    updateCompanyLedgerEntry
} from "@/utils/firebaseHelpers/companies";
import { InventoryItem, reconcileInventoryForBillUpdate, subscribeToInventory, syncInventoryFromBill } from "@/utils/firebaseHelpers/inventory";
import { createBillNumber, getBillAssetUrl, normalizeBillType, sanitizeBillNumber } from "@/utils/billHelpers";
import { formatCurrencyINR } from "@/utils/formatters";
import { scanReceipt } from "@/utils/geminiScanner";

type FormState = Partial<BillItem> & { vendorGst?: string; vendorAddress?: string; vendorPhone?: string };
type BillFilter = "All" | "Purchase" | "Sale";

const DECIMAL_INPUT_PATTERN = /^\d*(\.\d*)?$/;
const SIGNED_DECIMAL_INPUT_PATTERN = /^-?\d*(\.\d*)?$/;

const toFormNumber = (value: string | number | undefined) => {
    if (value === undefined || value === null) return "";
    return String(value);
};

const parseNumericValue = (value: string | number | undefined) => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "-" || trimmed === "." || trimmed === "-.") return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
};

const isValidNumericInput = (value: string, allowNegative = false) => {
    const pattern = allowNegative ? SIGNED_DECIMAL_INPUT_PATTERN : DECIMAL_INPUT_PATTERN;
    return pattern.test(value);
};

const toLedgerGateway = (paidType: BillItem["paidType"]) => {
    if (paidType === "Cheque") return "cheque" as const;
    if (paidType === "Cash") return "cash" as const;
    if (paidType === "UPI") return "upi" as const;
    return "bank transfer" as const;
};

const emptyForm = (): FormState => ({
    billNumber: "",
    vendorName: "",
    vendorGst: "",
    vendorAddress: "",
    vendorPhone: "",
    billType: "Purchase",
    date: new Date().toISOString().split("T")[0],
    products: [{ name: "", quantity: "", unit: "", price: "", hsn: "", category: "Trade" }],
    taxDetails: [],
    taxAmount: 0,
    freightAndForwardingCharges: "",
    roundOff: "",
    grossAmount: 0,
    amount: 0,
    paymentStatus: "Unpaid",
    paidDate: "",
    paidType: "NEFT/IMPS",
    chequeNumber: "",
    isScanned: false,
    photoUrl: "",
    photoPublicId: "",
    photoResourceType: "image",
    fileHash: "",
    fileName: "",
    fileMimeType: ""
});

const recalc = (form: FormState) => {
    const grossAmount = (form.products || []).reduce((s, p) => s + parseNumericValue(p.quantity) * parseNumericValue(p.price), 0);
    const taxAmount = (form.taxDetails || []).reduce((s, t) => s + parseNumericValue(t.taxAmount), 0);
    const amount = grossAmount + taxAmount + parseNumericValue(form.freightAndForwardingCharges) + parseNumericValue(form.roundOff);
    return { grossAmount, taxAmount, amount };
};

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
});

const hashFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const sameBillNumber = (a?: string, b?: string) => sanitizeBillNumber(a).toLowerCase() === sanitizeBillNumber(b).toLowerCase();

export default function BillsPage() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const searchParams = useSearchParams();
    const fileRef = useRef<HTMLInputElement>(null);
    const companyDropdownRef = useRef<HTMLDivElement>(null);

    const [bills, setBills] = useState<BillItem[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState("");
    const [billFilter, setBillFilter] = useState<BillFilter>("All");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(searchParams.get("mode") === "new");
    const [form, setForm] = useState<FormState>(emptyForm());
    const [parsedCompanies, setParsedCompanies] = useState<{ parent: any; customer: any } | null>(null);
    const [previewSrc, setPreviewSrc] = useState("");
    const [previewLabel, setPreviewLabel] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);

    useEffect(() => {
        if (!activeOrg || !user) return;
        const unsubBills = subscribeToBills(activeOrg.orgId, (items) => {
            setBills(items);
            setLoading(false);
        });
        const unsubInventory = subscribeToInventory(activeOrg.orgId, setInventory);
        const unsubCompanies = subscribeToCompanies(activeOrg.orgId, setCompanies);
        return () => {
            unsubBills();
            unsubInventory();
            unsubCompanies();
        };
    }, [activeOrg, user]);

    useEffect(() => {
        if (searchParams.get("mode") === "new") openNew();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent) => {
            if (!companyDropdownRef.current?.contains(event.target as Node)) {
                setShowCompanySuggestions(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, []);

    const filtered = useMemo(() => bills.filter((bill) => {
        const q = query.toLowerCase();
        const matchesFilter = billFilter === "All" ? true : bill.billType === billFilter;
        const matchesQuery = !q
            ? true
            : (bill.vendorName || "").toLowerCase().includes(q) || (bill.billNumber || "").toLowerCase().includes(q);
        return matchesFilter && matchesQuery;
    }), [bills, query, billFilter]);

    const selected = useMemo(() => bills.find((bill) => bill.id === selectedId) || null, [bills, selectedId]);
    const purchaseCount = useMemo(() => bills.filter((bill) => bill.billType === "Purchase").length, [bills]);
    const saleCount = useMemo(() => bills.filter((bill) => bill.billType === "Sale").length, [bills]);
    const companySuggestions = useMemo(() => {
        const vendorName = String(form.vendorName || "").trim().toLowerCase();
        if (!vendorName || editingId) return [];
        return companies
            .filter((company) => company.name.toLowerCase().includes(vendorName))
            .slice(0, 6);
    }, [companies, editingId, form.vendorName]);
    const showListPanel = !showForm && !selected;

    const openNew = () => {
        setEditingId(null);
        setSelectedId(null);
        setForm(emptyForm());
        setParsedCompanies(null);
        setPreviewSrc("");
        setPreviewLabel("");
        setError("");
        setShowForm(true);
        setShowCompanySuggestions(false);
    };

    const closeDetail = () => {
        setShowForm(false);
        setEditingId(null);
        setSelectedId(null);
        setForm(emptyForm());
        setParsedCompanies(null);
        setPreviewSrc("");
        setPreviewLabel("");
        setError("");
        setShowCompanySuggestions(false);
    };

    const openEdit = (bill: BillItem) => {
        setSelectedId(null);
        setEditingId(bill.id || null);
        setForm({
            ...bill,
            products: (bill.products || []).map((product) => ({
                ...product,
                quantity: toFormNumber(product.quantity),
                price: toFormNumber(product.price)
            })),
            taxDetails: (bill.taxDetails || []).map((tax) => ({
                ...tax,
                taxPercentage: toFormNumber(tax.taxPercentage),
                taxAmount: toFormNumber(tax.taxAmount)
            })),
            billType: normalizeBillType(bill.billType),
            freightAndForwardingCharges: toFormNumber(bill.freightAndForwardingCharges),
            roundOff: toFormNumber(bill.roundOff),
            paymentStatus: bill.paymentStatus || "Unpaid",
            paidDate: bill.paidDate || "",
            paidType: bill.paidType || "NEFT/IMPS",
            chequeNumber: bill.chequeNumber || ""
        });
        setPreviewSrc(getBillAssetUrl(bill));
        setPreviewLabel(bill.fileName || bill.billNumber);
        setError("");
        setShowForm(true);
        setShowCompanySuggestions(false);
    };

    const openSelected = (billId: string | null) => {
        setShowForm(false);
        setSelectedId(billId);
        setError("");
    };

    const setProduct = (index: number, key: string, value: string) => {
        const products = [...(form.products || [])];
        products[index] = { ...products[index], [key]: value };
        if (key === "name") {
            const found = inventory.find((item) => item.name.toLowerCase() === String(value).toLowerCase());
            if (found) {
                products[index].hsn = found.hsn;
                products[index].unit = found.unit || "";
                products[index].category = found.category || "Trade";
            }
        }
        setForm((current) => ({ ...current, products, ...recalc({ ...current, products }) }));
    };

    const setTax = (index: number, key: string, value: string) => {
        const taxDetails = [...(form.taxDetails || [])];
        taxDetails[index] = { ...taxDetails[index], [key]: value };
        setForm((current) => ({ ...current, taxDetails, ...recalc({ ...current, taxDetails }) }));
    };

    const applyCompanySelection = (company: Company) => {
        setForm((current) => ({
            ...current,
            vendorName: company.name,
            vendorGst: company.gst || "",
            vendorAddress: company.address || "",
            vendorPhone: company.phoneNumbers || ""
        }));
        setShowCompanySuggestions(false);
    };

    const setFormNumericField = (field: "freightAndForwardingCharges" | "roundOff", value: string, allowNegative = false) => {
        if (!isValidNumericInput(value, allowNegative)) return;
        setForm((current) => {
            const next = { ...current, [field]: value };
            return { ...next, ...recalc(next) };
        });
    };

    const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setScanning(true);
        setError("");

        try {
            const fileHash = await hashFile(file);
            if (bills.some((bill) => bill.fileHash === fileHash && bill.id !== editingId)) {
                throw new Error("This bill file is already uploaded. Duplicate scanned copies are blocked.");
            }

            const fileDataUrl = await readDataUrl(file);
            const parsed = await scanReceipt(fileDataUrl);
            const billType = parsed.billType === "Unknown" ? normalizeBillType(form.billType) : normalizeBillType(parsed.billType);
            const company = billType === "Purchase" ? parsed.parentCompanyDetails : parsed.customerCompanyDetails;
            const parsedItems = parsed.items || [];
            const products = parsedItems.length > 0 ? parsedItems.map((item) => {
                const found = inventory.find((inv) => inv.name.toLowerCase() === String(item.name || "").toLowerCase());
                return {
                    name: item.name || "",
                    quantity: toFormNumber(item.quantity || 1),
                    unit: item.unit || found?.unit || "",
                    price: toFormNumber(item.price || 0),
                    hsn: item.hsn || found?.hsn || "",
                    category: item.category || found?.category || "Trade"
                };
            }) : form.products || [];

            const nextForm: FormState = {
                ...form,
                billNumber: sanitizeBillNumber(parsed.billNumber) || form.billNumber,
                vendorName: company?.name || form.vendorName,
                vendorGst: company?.gst || "",
                vendorAddress: company?.address || "",
                vendorPhone: company?.phoneNumbers || "",
                billType,
                date: parsed.date || form.date,
                products,
                taxDetails: (parsed.taxDetails || []).map((tax) => ({
                    taxType: tax.taxType || "Tax",
                    taxPercentage: toFormNumber(tax.taxPercentage || 0),
                    taxAmount: toFormNumber(tax.taxAmount || 0)
                })),
                freightAndForwardingCharges: toFormNumber(parsed.freightAndForwardingCharges || 0),
                roundOff: toFormNumber(parsed.roundOff || 0),
                isScanned: true,
                photoUrl: fileDataUrl,
                photoPublicId: "",
                photoResourceType: file.type.includes("pdf") ? "raw" : "image",
                fileHash,
                fileName: file.name,
                fileMimeType: file.type
            };

            setParsedCompanies({ parent: parsed.parentCompanyDetails, customer: parsed.customerCompanyDetails });
            setPreviewSrc(file.type.includes("image/") ? fileDataUrl : "");
            setPreviewLabel(file.name);
            setForm({ ...nextForm, ...recalc(nextForm), amount: Number(parsed.totalAmount || recalc(nextForm).amount) });
        } catch (scanError: any) {
            setError(scanError.message || "Failed to scan file.");
        } finally {
            setScanning(false);
            if (event.target) event.target.value = "";
        }
    };

    const uploadIfNeeded = async (currentForm: FormState) => {
        if (!currentForm.isScanned || !currentForm.photoUrl || !currentForm.photoUrl.startsWith("data:")) {
            return {
                photoUrl: currentForm.photoUrl,
                photoPublicId: currentForm.photoPublicId,
                photoResourceType: currentForm.photoResourceType
            };
        }

        const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file: currentForm.photoUrl,
                fileName: currentForm.fileName,
                mimeType: currentForm.fileMimeType
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || "Failed to upload bill file.");
        return {
            photoUrl: data.url,
            photoPublicId: data.publicId,
            photoResourceType: data.resourceType as "image" | "raw" | "video"
        };
    };

    const syncPaymentLedgerEntry = async ({
        companyId,
        billId,
        bill,
        previousBill,
        existingEntryId
    }: {
        companyId: string;
        billId: string;
        bill: BillItem;
        previousBill?: BillItem | null;
        existingEntryId?: string;
    }) => {
        if (!activeOrg) throw new Error("Organization is not available.");

        const previousLedgerType = previousBill?.billType === "Sale" ? "salesLedger" : "purchaseLedger";
        const nextLedgerType = bill.billType === "Sale" ? "salesLedger" : "purchaseLedger";
        const shouldHavePaymentEntry = bill.paymentStatus === "Paid";

        const paymentPayload: Omit<CompanyLedgerEntry, "id" | "createdAt" | "updatedAt"> = {
            entryKind: "payment",
            billId,
            billNumber: bill.billNumber,
            billType: bill.billType,
            date: bill.paidDate || bill.date,
            credit: bill.billType === "Sale" ? Number(bill.amount || 0) : 0,
            debit: bill.billType === "Purchase" ? Number(bill.amount || 0) : 0,
            amount: Number(bill.amount || 0),
            companyName: bill.vendorName,
            gateway: toLedgerGateway(bill.paidType),
            chequeNumber: bill.paidType === "Cheque" ? bill.chequeNumber || "" : "",
            note: bill.billType === "Sale" ? "Bill payment received" : "Bill payment given"
        };

        if (!shouldHavePaymentEntry) {
            if (existingEntryId) {
                const deleteResult = await deleteCompanyLedgerEntry(activeOrg.orgId, companyId, previousLedgerType, existingEntryId);
                if (deleteResult.error) throw new Error(deleteResult.error);
            }
            return "";
        }

        if (existingEntryId) {
            if (previousLedgerType === nextLedgerType) {
                const updateResult = await updateCompanyLedgerEntry(activeOrg.orgId, companyId, nextLedgerType, existingEntryId, paymentPayload);
                if (updateResult.error) throw new Error(updateResult.error);
                return existingEntryId;
            }

            const deleteResult = await deleteCompanyLedgerEntry(activeOrg.orgId, companyId, previousLedgerType, existingEntryId);
            if (deleteResult.error) throw new Error(deleteResult.error);
        }

        const addResult = await addCompanyLedgerEntry(activeOrg.orgId, companyId, nextLedgerType, paymentPayload);
        if (addResult.error) throw new Error(addResult.error);
        return addResult.id || "";
    };

    const saveBill = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg || !user) return;
        setBusy(true);
        setError("");

        try {
            const products = (form.products || []).map((product) => ({
                ...product,
                name: String(product.name || "").trim(),
                quantity: parseNumericValue(product.quantity),
                unit: String(product.unit || "").trim(),
                price: parseNumericValue(product.price),
                hsn: String(product.hsn || "").trim(),
                category: String(product.category || "Trade")
            })).filter((product) => product.name);

            if (!products.length) throw new Error("Add at least one product.");

            const normalizedBillNumber = sanitizeBillNumber(form.billNumber) || createBillNumber(bills);
            const duplicateBill = bills.find((bill) => sameBillNumber(bill.billNumber, normalizedBillNumber) && bill.id !== editingId);
            if (duplicateBill) {
                throw new Error(`Bill number ${normalizedBillNumber} already exists. Duplicate bill numbers are not allowed.`);
            }

            const uploaded = await uploadIfNeeded(form);
            const paymentStatus = form.paymentStatus === "Paid" ? "Paid" : "Unpaid";
            const payload: BillItem = {
                ...(form as BillItem),
                billNumber: normalizedBillNumber,
                billType: normalizeBillType(form.billType),
                products,
                taxDetails: (form.taxDetails || []).map((tax) => ({
                    taxType: String(tax.taxType || "Tax"),
                    taxPercentage: parseNumericValue(tax.taxPercentage),
                    taxAmount: parseNumericValue(tax.taxAmount)
                })),
                ...recalc({ ...form, products }),
                amount: Number(form.amount || recalc({ ...form, products }).amount),
                paymentStatus,
                paidDate: paymentStatus === "Paid" ? String(form.paidDate || "") : "",
                paidType: paymentStatus === "Paid" ? (form.paidType || "NEFT/IMPS") : "",
                chequeNumber: paymentStatus === "Paid" && form.paidType === "Cheque" ? String(form.chequeNumber || "") : "",
                photoUrl: uploaded.photoUrl || "",
                photoPublicId: uploaded.photoPublicId || "",
                photoResourceType: uploaded.photoResourceType || "image"
            };

            if (editingId) {
                const previous = bills.find((bill) => bill.id === editingId);
                if (!previous) throw new Error("Bill not found for update.");

                const inventoryResult = await reconcileInventoryForBillUpdate(activeOrg.orgId, previous, payload, user.uid);
                if (inventoryResult.error) throw new Error(inventoryResult.error);

                const prevLedgerType = previous.billType === "Sale" ? "salesLedger" : "purchaseLedger";
                const nextLedgerType = payload.billType === "Sale" ? "salesLedger" : "purchaseLedger";
                const ledgerPayload: Partial<CompanyLedgerEntry> = {
                    entryKind: "bill",
                    billId: previous.id,
                    billNumber: payload.billNumber,
                    billType: payload.billType,
                    date: payload.date,
                    credit: payload.billType === "Purchase" ? Number(payload.amount || 0) : 0,
                    debit: payload.billType === "Sale" ? Number(payload.amount || 0) : 0,
                    amount: Number(payload.amount || 0),
                    companyName: payload.vendorName,
                    billImageUrl: payload.photoUrl,
                    billImagePublicId: payload.photoPublicId,
                    billImageResourceType: payload.photoResourceType
                };

                if (previous.companyId && previous.ledgerEntryId) {
                    if (prevLedgerType === nextLedgerType) {
                        const ledgerResult = await updateCompanyLedgerEntry(activeOrg.orgId, previous.companyId, nextLedgerType, previous.ledgerEntryId, ledgerPayload);
                        if (ledgerResult.error) throw new Error(ledgerResult.error);
                    } else {
                        const deleteResult = await deleteCompanyLedgerEntry(activeOrg.orgId, previous.companyId, prevLedgerType, previous.ledgerEntryId);
                        if (deleteResult.error) throw new Error(deleteResult.error);
                        const addLedger = await addCompanyLedgerEntry(activeOrg.orgId, previous.companyId, nextLedgerType, ledgerPayload as Omit<CompanyLedgerEntry, "id" | "createdAt" | "updatedAt">);
                        if (addLedger.error) throw new Error(addLedger.error);
                        payload.ledgerEntryId = addLedger.id || "";
                    }
                }

                if (previous.companyId) {
                    payload.paymentLedgerEntryId = await syncPaymentLedgerEntry({
                        companyId: previous.companyId,
                        billId: previous.id || editingId,
                        bill: payload,
                        previousBill: previous,
                        existingEntryId: previous.paymentLedgerEntryId
                    });
                }

                const updateResult = await updateBillItem(activeOrg.orgId, editingId, payload);
                if (updateResult.error) throw new Error(updateResult.error);
            } else {
                const companyResult = await ensureCompanyProfile(activeOrg.orgId, {
                    name: payload.vendorName || "Unknown Company",
                    gst: payload.vendorGst || "",
                    address: payload.vendorAddress || "",
                    phoneNumbers: payload.vendorPhone || "",
                    createdBy: user.uid
                });
                if (companyResult.error) throw new Error(companyResult.error);

                payload.companyId = companyResult.id || "";
                const addResult = await addBillItem(activeOrg.orgId, payload, user.uid);
                if (addResult.error) throw new Error(addResult.error);

                const ledgerType = payload.billType === "Sale" ? "salesLedger" : "purchaseLedger";
                const ledgerResult = await addCompanyLedgerEntry(activeOrg.orgId, companyResult.id || "", ledgerType, {
                    entryKind: "bill",
                    billId: addResult.id || "",
                    billNumber: payload.billNumber,
                    billType: payload.billType,
                    date: payload.date,
                    credit: payload.billType === "Purchase" ? Number(payload.amount || 0) : 0,
                    debit: payload.billType === "Sale" ? Number(payload.amount || 0) : 0,
                    amount: Number(payload.amount || 0),
                    companyName: payload.vendorName,
                    billImageUrl: payload.photoUrl,
                    billImagePublicId: payload.photoPublicId,
                    billImageResourceType: payload.photoResourceType
                });
                if (ledgerResult.error) throw new Error(ledgerResult.error);

                payload.paymentLedgerEntryId = await syncPaymentLedgerEntry({
                    companyId: companyResult.id || "",
                    billId: addResult.id || "",
                    bill: payload
                });

                await updateBillItem(activeOrg.orgId, addResult.id || "", {
                    companyId: companyResult.id || "",
                    ledgerEntryId: ledgerResult.id || "",
                    paymentLedgerEntryId: payload.paymentLedgerEntryId || ""
                });
                const inventoryResult = await syncInventoryFromBill(activeOrg.orgId, payload, user.uid);
                if (inventoryResult.error) throw new Error(inventoryResult.error);
            }

            closeDetail();
        } catch (saveError: any) {
            setError(saveError.message || "Failed to save bill.");
        } finally {
            setBusy(false);
        }
    };

    const removeBill = async (bill: BillItem) => {
        if (!activeOrg || !user) return;
        if (!window.confirm(`Delete ${bill.billNumber}?`)) return;

        try {
            const inventoryResult = await reconcileInventoryForBillUpdate(activeOrg.orgId, bill, { ...bill, products: [] }, user.uid);
            if (inventoryResult.error) throw new Error(inventoryResult.error);

            if (bill.companyId && bill.ledgerEntryId) {
                const ledgerType = bill.billType === "Sale" ? "salesLedger" : "purchaseLedger";
                const ledgerResult = await deleteCompanyLedgerEntry(activeOrg.orgId, bill.companyId, ledgerType, bill.ledgerEntryId);
                if (ledgerResult.error) throw new Error(ledgerResult.error);
            }

            if (bill.companyId && bill.paymentLedgerEntryId) {
                const ledgerType = bill.billType === "Sale" ? "salesLedger" : "purchaseLedger";
                const paymentDeleteResult = await deleteCompanyLedgerEntry(activeOrg.orgId, bill.companyId, ledgerType, bill.paymentLedgerEntryId);
                if (paymentDeleteResult.error) throw new Error(paymentDeleteResult.error);
            }

            const deleteResult = await deleteBillItem(activeOrg.orgId, bill.id as string);
            if (deleteResult.error) throw new Error(deleteResult.error);
            closeDetail();
        } catch (deleteError: any) {
            setError(deleteError.message || "Failed to delete bill.");
        }
    };

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <p className="section-kicker">Bills Workspace</p>
                    <h1 className="dashboard-title">Bills & Receipts</h1>
                    <p className="dashboard-subtitle">Track sales and purchases with cleaner list, detail, and payment flows.</p>
                </div>
                <button className="btn-primary" onClick={openNew}><Plus size={18} style={{ marginRight: "8px" }} /> Add Bill</button>
            </header>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            {showListPanel ? (
                <div style={{ display: "grid", gap: "18px" }}>
                    <div className="grid-dashboard" style={{ marginTop: 0 }}>
                        <div className="glass-panel stat-card">
                            <span className="stat-title">Purchase Bills</span>
                            <span className="stat-value">{purchaseCount}</span>
                            <div className="stat-foot">Total purchase entries</div>
                        </div>
                        <div className="glass-panel stat-card">
                            <span className="stat-title">Sales Bills</span>
                            <span className="stat-value">{saleCount}</span>
                            <div className="stat-foot">Total sales entries</div>
                        </div>
                    </div>

                    <section className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ padding: "18px", borderBottom: "1px solid var(--border-color)", display: "grid", gap: "14px" }}>
                            <div className="search-box">
                                <Search size={16} />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by bill number or company..." />
                            </div>
                            <div className="workspace-toolbar">
                                <div className="workspace-filter-pill">
                                    <Filter size={16} />
                                    {(["All", "Purchase", "Sale"] as BillFilter[]).map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            className={`company-tab ${billFilter === option ? "active" : ""}`}
                                            onClick={() => setBillFilter(option)}
                                        >
                                            {option}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                            {loading ? <div style={{ padding: "24px" }}>Loading bills...</div> : filtered.length === 0 ? <div style={{ padding: "24px", opacity: 0.7 }}>No bills found.</div> : filtered.map((bill) => (
                                <button key={bill.id} type="button" className="workspace-list-row" onClick={() => openSelected(bill.id || null)}>
                                    <div>
                                        <div style={{ fontWeight: 700 }}>{bill.billNumber || bill.id}</div>
                                        <div style={{ opacity: 0.76 }}>{bill.vendorName}</div>
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div className="status-pill" style={{ background: bill.billType === "Sale" ? "rgba(22,163,74,.12)" : "rgba(220,38,38,.12)", color: bill.billType === "Sale" ? "#15803d" : "#dc2626" }}>{bill.billType}</div>
                                        <div style={{ marginTop: "8px", fontWeight: 700 }}>{formatCurrencyINR(bill.amount)}</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            ) : (
                <section className="glass-panel workspace-detail-panel">
                    {showForm ? (
                        <form onSubmit={saveBill} style={{ display: "grid", gap: "16px" }}>
                            <div className="section-header-row">
                                <div>
                                    <p className="section-kicker">{editingId ? "Edit Bill" : "New Bill"}</p>
                                    <h2 className="section-title">{editingId ? form.billNumber || "Update bill" : "Add bill"}</h2>
                                </div>
                                <button type="button" className="panel-icon-btn" onClick={closeDetail}><X size={18} /></button>
                            </div>

                            <div className="bill-section">
                                <h3 className="bill-section-title">Bill Details</h3>
                                <div className="form-grid-3">
                                    <div>
                                        <label className="section-label">Bill Number</label>
                                        <input className="input-field" value={form.billNumber || ""} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="section-label">Date</label>
                                        <input className="input-field" type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className="section-label">Type</label>
                                        <select className="input-field" value={normalizeBillType(form.billType)} onChange={(e) => {
                                            const billType = normalizeBillType(e.target.value);
                                            const next = { ...form, billType };
                                            if (parsedCompanies && !editingId) {
                                                const company = billType === "Purchase" ? parsedCompanies.parent : parsedCompanies.customer;
                                                setForm({
                                                    ...next,
                                                    vendorName: company?.name || next.vendorName,
                                                    vendorGst: company?.gst || "",
                                                    vendorAddress: company?.address || "",
                                                    vendorPhone: company?.phoneNumbers || ""
                                                });
                                                return;
                                            }
                                            setForm(next);
                                        }}>
                                            <option value="Purchase">Purchase</option>
                                            <option value="Sale">Sale</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="bill-section">
                                <div className="section-header-row">
                                    <h3 className="bill-section-title">Bill File</h3>
                                    {!editingId && <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={scanning}><Upload size={16} style={{ marginRight: "8px" }} /> {scanning ? "Scanning..." : "Upload PNG / JPG / WEBP / PDF"}</button>}
                                </div>
                                <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf" style={{ display: "none" }} onChange={onFile} />
                                <div className="file-preview-box">
                                    {previewSrc ? <img src={previewSrc} alt="Bill preview" style={{ maxWidth: "100%", maxHeight: "240px", borderRadius: "12px", objectFit: "contain" }} /> : <div style={{ opacity: 0.7 }}>Upload a supported image or PDF to scan the bill.</div>}
                                    {previewLabel && <div style={{ marginTop: "10px", opacity: 0.75 }}>{previewLabel}</div>}
                                    {editingId && <div style={{ marginTop: "10px", opacity: 0.75 }}>Bill file is locked while updating.</div>}
                                </div>
                            </div>

                            <div className="bill-section">
                                <h3 className="bill-section-title">Company Details</h3>
                                <div className="form-grid-2">
                                    <div ref={companyDropdownRef} style={{ position: "relative" }}>
                                        <label className="section-label">Company Name</label>
                                        <input
                                            className="input-field"
                                            value={form.vendorName || ""}
                                            onChange={(e) => {
                                                setForm({ ...form, vendorName: e.target.value });
                                                setShowCompanySuggestions(true);
                                            }}
                                            onFocus={() => setShowCompanySuggestions(true)}
                                            disabled={!!editingId}
                                            required
                                        />
                                        {!editingId && showCompanySuggestions && companySuggestions.length > 0 && (
                                            <div className="suggestion-dropdown">
                                                {companySuggestions.map((company) => (
                                                    <button key={company.id} type="button" className="suggestion-item" onClick={() => applyCompanySelection(company)}>
                                                        <span className="suggestion-title">{company.name}</span>
                                                        <span className="suggestion-meta">{company.gst || "No GST"} {company.address ? `• ${company.address}` : ""}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="section-label">GST</label>
                                        <input className="input-field" value={form.vendorGst || ""} onChange={(e) => setForm({ ...form, vendorGst: e.target.value })} disabled={!!editingId} />
                                    </div>
                                </div>
                                <div className="form-grid-2" style={{ marginTop: "12px" }}>
                                    <div>
                                        <label className="section-label">Phone</label>
                                        <input className="input-field" value={form.vendorPhone || ""} onChange={(e) => setForm({ ...form, vendorPhone: e.target.value })} disabled={!!editingId} />
                                    </div>
                                    <div>
                                        <label className="section-label">Address</label>
                                        <input className="input-field" value={form.vendorAddress || ""} onChange={(e) => setForm({ ...form, vendorAddress: e.target.value })} disabled={!!editingId} />
                                    </div>
                                </div>
                            </div>

                            <div className="bill-section">
                                <h3 className="bill-section-title">Payment Status</h3>
                                <div className="form-grid-3">
                                    <div>
                                        <label className="section-label">Payment</label>
                                        <select
                                            className="input-field"
                                            value={form.paymentStatus || "Unpaid"}
                                            onChange={(e) => setForm((current) => ({
                                                ...current,
                                                paymentStatus: e.target.value as "Paid" | "Unpaid",
                                                paidDate: e.target.value === "Paid" ? current.paidDate || current.date || "" : "",
                                                paidType: e.target.value === "Paid" ? current.paidType || "NEFT/IMPS" : "",
                                                chequeNumber: e.target.value === "Paid" && current.paidType === "Cheque" ? current.chequeNumber || "" : ""
                                            }))}
                                        >
                                            <option value="Unpaid">Unpaid</option>
                                            <option value="Paid">Paid</option>
                                        </select>
                                    </div>
                                    {form.paymentStatus === "Paid" && (
                                        <>
                                            <div>
                                                <label className="section-label">Paid Date</label>
                                                <input className="input-field" type="date" value={form.paidDate || ""} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="section-label">Paid Type</label>
                                                <select className="input-field" value={form.paidType || "NEFT/IMPS"} onChange={(e) => setForm({ ...form, paidType: e.target.value as BillItem["paidType"], chequeNumber: e.target.value === "Cheque" ? form.chequeNumber || "" : "" })}>
                                                    <option value="NEFT/IMPS">NEFT / IMPS</option>
                                                    <option value="UPI">UPI</option>
                                                    <option value="Cash">Cash</option>
                                                    <option value="Cheque">Cheque</option>
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {form.paymentStatus === "Paid" && form.paidType === "Cheque" && (
                                    <div style={{ marginTop: "12px" }}>
                                        <label className="section-label">Cheque Number</label>
                                        <input className="input-field" value={form.chequeNumber || ""} onChange={(e) => setForm({ ...form, chequeNumber: e.target.value })} />
                                    </div>
                                )}
                            </div>

                            <div className="bill-section">
                                <div className="section-header-row">
                                    <h3 className="bill-section-title">Products</h3>
                                    <button type="button" className="btn-secondary" onClick={() => setForm({ ...form, products: [...(form.products || []), { name: "", quantity: "", unit: "", price: "", hsn: "", category: "Trade" }] })}>Add Row</button>
                                </div>
                                <div style={{ display: "grid", gap: "10px" }}>
                                    {(form.products || []).map((product, index) => (
                                        <div key={index} className="compact-product-grid">
                                            <>
                                                <input className="input-field" placeholder="Product" list={`inventory-products-${index}`} value={product.name} onChange={(e) => setProduct(index, "name", e.target.value)} required />
                                                <datalist id={`inventory-products-${index}`}>
                                                    {inventory.map((item) => (
                                                        <option key={`${item.id || item.name}-${index}`} value={item.name}>
                                                            {item.hsn ? `${item.name} - ${item.hsn}` : item.name}
                                                        </option>
                                                    ))}
                                                </datalist>
                                            </>
                                            <input className="input-field" placeholder="HSN" value={product.hsn || ""} onChange={(e) => setProduct(index, "hsn", e.target.value)} required />
                                            <input
                                                className="input-field"
                                                inputMode="decimal"
                                                placeholder="Qty"
                                                value={toFormNumber(product.quantity)}
                                                onChange={(e) => {
                                                    if (!isValidNumericInput(e.target.value)) return;
                                                    setProduct(index, "quantity", e.target.value);
                                                }}
                                                required
                                            />
                                            <input className="input-field" placeholder="Unit" value={product.unit || ""} onChange={(e) => setProduct(index, "unit", e.target.value)} />
                                            <input
                                                className="input-field"
                                                inputMode="decimal"
                                                placeholder="Unit Price"
                                                value={toFormNumber(product.price)}
                                                onChange={(e) => {
                                                    if (!isValidNumericInput(e.target.value)) return;
                                                    setProduct(index, "price", e.target.value);
                                                }}
                                                required
                                            />
                                            <button type="button" className="panel-icon-btn" onClick={() => {
                                                const products = (form.products || []).filter((_, row) => row !== index);
                                                setForm((current) => ({ ...current, products, ...recalc({ ...current, products }) }));
                                            }}><Trash2 size={16} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bill-section">
                                <h3 className="bill-section-title">Taxes & Totals</h3>
                                {(form.taxDetails || []).map((tax, index) => (
                                    <div key={index} className="form-grid-4" style={{ marginBottom: "10px" }}>
                                        <input className="input-field" placeholder="Tax type" value={tax.taxType} onChange={(e) => setTax(index, "taxType", e.target.value)} />
                                        <input
                                            className="input-field"
                                            inputMode="decimal"
                                            placeholder="Tax %"
                                            value={toFormNumber(tax.taxPercentage)}
                                            onChange={(e) => {
                                                if (!isValidNumericInput(e.target.value)) return;
                                                setTax(index, "taxPercentage", e.target.value);
                                            }}
                                        />
                                        <input
                                            className="input-field"
                                            inputMode="decimal"
                                            placeholder="Tax amount"
                                            value={toFormNumber(tax.taxAmount)}
                                            onChange={(e) => {
                                                if (!isValidNumericInput(e.target.value)) return;
                                                setTax(index, "taxAmount", e.target.value);
                                            }}
                                        />
                                        <button type="button" className="panel-icon-btn" onClick={() => {
                                            const taxDetails = (form.taxDetails || []).filter((_, row) => row !== index);
                                            setForm((current) => ({ ...current, taxDetails, ...recalc({ ...current, taxDetails }) }));
                                        }}><Trash2 size={16} /></button>
                                    </div>
                                ))}
                                <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                                    <button type="button" className="btn-secondary" onClick={() => setForm({ ...form, taxDetails: [...(form.taxDetails || []), { taxType: "CGST", taxPercentage: "", taxAmount: "" }] })}>Add Tax</button>
                                </div>
                                <div className="form-grid-3">
                                    <div><label className="section-label">Freight</label><input className="input-field" inputMode="decimal" placeholder="0" value={toFormNumber(form.freightAndForwardingCharges)} onChange={(e) => setFormNumericField("freightAndForwardingCharges", e.target.value)} /></div>
                                    <div><label className="section-label">Round Off</label><input className="input-field" inputMode="decimal" placeholder="0" value={toFormNumber(form.roundOff)} onChange={(e) => setFormNumericField("roundOff", e.target.value, true)} /></div>
                                    <div><label className="section-label">Total</label><input className="input-field" value={formatCurrencyINR(form.amount)} disabled /></div>
                                </div>
                            </div>

                            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                                <button type="button" className="btn-secondary" onClick={closeDetail}>Cancel</button>
                                <button className="btn-primary" disabled={busy}>{busy ? "Saving..." : editingId ? "Update Bill" : "Save Bill"}</button>
                            </div>
                        </form>
                    ) : selected ? (
                        <div style={{ display: "grid", gap: "16px" }}>
                            <div className="section-header-row">
                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                    <button type="button" className="panel-icon-btn" onClick={closeDetail}><ArrowLeft size={18} /></button>
                                    <div>
                                        <p className="section-kicker">Selected Bill</p>
                                        <h2 className="section-title">{selected.billNumber}</h2>
                                        <p style={{ opacity: 0.72 }}>{selected.vendorName}</p>
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: "10px" }}>
                                    <button type="button" className="btn-secondary" onClick={() => openEdit(selected)}><Edit size={16} style={{ marginRight: "8px" }} /> Edit</button>
                                    <button type="button" className="btn-secondary" onClick={() => removeBill(selected)} style={{ color: "#dc2626" }}><Trash2 size={16} style={{ marginRight: "8px" }} /> Delete</button>
                                </div>
                            </div>

                            <div className="bill-section">
                                <div className="detail-pair-grid">
                                    <div><span className="detail-label">Type</span><strong>{selected.billType}</strong></div>
                                    <div><span className="detail-label">Date</span><strong>{selected.date}</strong></div>
                                    <div><span className="detail-label">Amount</span><strong>{formatCurrencyINR(selected.amount)}</strong></div>
                                    <div><span className="detail-label">Bill File</span>{selected.photoPublicId ? <a className="inline-link" href={getBillAssetUrl(selected)} target="_blank" rel="noreferrer">Open file</a> : <strong>Not uploaded</strong>}</div>
                                    <div><span className="detail-label">Payment</span><strong>{selected.paymentStatus || "Unpaid"}</strong></div>
                                    <div><span className="detail-label">Paid Date</span><strong>{selected.paidDate || "-"}</strong></div>
                                    <div><span className="detail-label">Paid Type</span><strong>{selected.paidType || "-"}</strong></div>
                                    <div><span className="detail-label">Cheque Number</span><strong>{selected.chequeNumber || "-"}</strong></div>
                                </div>
                            </div>

                            <div className="bill-section">
                                <h3 className="bill-section-title">Products</h3>
                                <div style={{ display: "grid", gap: "10px" }}>
                                    {(selected.products || []).map((product, index) => (
                                        <div key={`${product.name}-${index}`} className="list-row-card">
                                            <div>
                                                <div style={{ fontWeight: 700 }}>{product.name}</div>
                                                <div style={{ opacity: 0.72 }}>{product.hsn || "No HSN"} {product.unit ? `• ${product.unit}` : ""}</div>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <div>{product.quantity} {product.unit || ""}</div>
                                                <div style={{ fontWeight: 700 }}>{formatCurrencyINR(product.price)}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state-panel"><FileText size={28} /><h2>No bill selected</h2><p>Choose a bill from the list or add a new one.</p></div>
                    )}
                </section>
            )}
        </div>
    );
}
