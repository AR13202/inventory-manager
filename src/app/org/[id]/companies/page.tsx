"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Building2, CreditCard, FileText, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { BillItem, subscribeToBills } from "@/utils/firebaseHelpers/bills";
import {
    addCompanyItem,
    addCompanyLedgerEntry,
    Company,
    LedgerBillAdjustment,
    CompanyLedgerEntry,
    deleteCompanyItem,
    deleteCompanyLedgerEntry,
    LedgerGateway,
    recalculateCompanyBalance,
    subscribeToCompanies,
    subscribeToCompanyLedger,
    syncBillPaymentStatusFromLedger,
    updateCompanyItem,
    updateCompanyLedgerEntry
} from "@/utils/firebaseHelpers/companies";
import { formatCurrencyINR } from "@/utils/formatters";
import { escapeHtml, openPrintWindow } from "@/utils/print";

const emptyCompany = { name: "", gst: "", address: "", phoneNumbers: "" };
const emptyLedgerForm = {
    gateway: "upi" as LedgerGateway,
    entrySide: "credit" as "debit" | "credit",
    amount: "",
    date: new Date().toISOString().split("T")[0],
    bank: "",
    chequeNumber: "",
    note: "",
    adjustedBillIds: [] as string[]
};

const getEntryTypeLabel = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
    if (entry.entryKind === "receipt") return "Receipt";
    if (entry.source === "Purchase") return "Purchase";
    return "Sales";
};

const getEntryTypeStyles = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
    if (entry.entryKind === "receipt") {
        return {
            backgroundColor: "#dcfce7",
            color: "#166534"
        };
    }

    if (entry.source === "Purchase") {
        return {
            backgroundColor: "#eff6ff",
            color: "#1e40af"
        };
    }

    return {
        backgroundColor: "#fff7ed",
        color: "#9a3412"
    };
};

const getFinancialYearLabel = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
};

export default function CompaniesPage() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const billAdjustmentDropdownRef = useRef<HTMLDivElement>(null);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [bills, setBills] = useState<BillItem[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [purchaseLedger, setPurchaseLedger] = useState<CompanyLedgerEntry[]>([]);
    const [salesLedger, setSalesLedger] = useState<CompanyLedgerEntry[]>([]);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showCompanyModal, setShowCompanyModal] = useState(false);
    const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [sortOption, setSortOption] = useState<"name-asc" | "name-desc" | "balance-asc" | "balance-desc">("name-asc");
    const [companyForm, setCompanyForm] = useState(emptyCompany);
    const [showLedgerModal, setShowLedgerModal] = useState(false);
    const [ledgerModalMode, setLedgerModalMode] = useState<"receipt" | "openingBalance" | "edit">("receipt");
    const [editingLedgerEntry, setEditingLedgerEntry] = useState<CompanyLedgerEntry | null>(null);
    const [ledgerForm, setLedgerForm] = useState({ ...emptyLedgerForm, ledgerTarget: "purchase" as "purchase" | "sales" });
    const [error, setError] = useState("");
    const [showBillAdjustmentDropdown, setShowBillAdjustmentDropdown] = useState(false);

    useEffect(() => {
        if (!activeOrg || !user) return;
        const unsubscribe = subscribeToCompanies(activeOrg.orgId, (items) => {
            setCompanies(items);
            setLoading(false);
        });
        const unsubscribeBills = subscribeToBills(activeOrg.orgId, setBills);
        return () => {
            unsubscribe();
            unsubscribeBills();
        };
    }, [activeOrg, user]);

    useEffect(() => {
        if (!activeOrg || !selectedCompanyId) return;
        const unsubPurchase = subscribeToCompanyLedger(activeOrg.orgId, selectedCompanyId, "purchaseLedger", setPurchaseLedger);
        const unsubSales = subscribeToCompanyLedger(activeOrg.orgId, selectedCompanyId, "salesLedger", setSalesLedger);
        return () => {
            unsubPurchase();
            unsubSales();
        };
    }, [activeOrg, selectedCompanyId]);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent) => {
            if (!billAdjustmentDropdownRef.current?.contains(event.target as Node)) {
                setShowBillAdjustmentDropdown(false);
            }
        };

        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) || null, [companies, selectedCompanyId]);
    const selectedCompanyBillIds = useMemo(() => new Set(
        bills
            .filter((bill) => bill.companyId === selectedCompanyId)
            .map((bill) => String(bill.id || ""))
            .filter(Boolean)
    ), [bills, selectedCompanyId]);
    const selectedCompanyReceiptBills = useMemo(() => bills
        .filter((bill) => bill.companyId === selectedCompanyId)
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()), [bills, selectedCompanyId]);
    const selectedAdjustmentBills = useMemo(() => selectedCompanyReceiptBills
        .filter((bill) => ledgerForm.adjustedBillIds.includes(String(bill.id || ""))), [selectedCompanyReceiptBills, ledgerForm.adjustedBillIds]);
    const ledgerRows = useMemo(() => {
        const purchase = purchaseLedger.map(e => ({ ...e, source: "Purchase" as const }));
        const sales = salesLedger.map(e => ({ ...e, source: "Sale" as const }));
        return [...purchase, ...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [purchaseLedger, salesLedger]);

    const totalDebit = [...purchaseLedger, ...salesLedger].reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
    const totalCredit = [...purchaseLedger, ...salesLedger].reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
    const remainingBalance = totalDebit - totalCredit;
    const filteredCompanies = useMemo(() => {
        const result = companies.filter((company) => {
            const q = query.toLowerCase();
            if (!q) return true;
            return company.name.toLowerCase().includes(q) || (company.gst || "").toLowerCase().includes(q);
        });

        result.sort((a, b) => {
            if (sortOption === "name-asc") return a.name.localeCompare(b.name);
            if (sortOption === "name-desc") return b.name.localeCompare(a.name);
            if (sortOption === "balance-asc") return (a.balance || 0) - (b.balance || 0);
            if (sortOption === "balance-desc") return (b.balance || 0) - (a.balance || 0);
            return 0;
        });

        return result;
    }, [companies, query, sortOption]);

    useEffect(() => {
        if (!activeOrg || loading || companies.length === 0 || refreshing) return;
        const needsRefresh = companies.filter(c => c.balance === undefined);
        if (needsRefresh.length > 0) {
            const batch = needsRefresh.slice(0, 5);
            batch.forEach(c => recalculateCompanyBalance(activeOrg.orgId, c.id!));
        }
    }, [companies, activeOrg, loading, refreshing]);

    const openCompanyModal = (company?: Company) => {
        setEditingCompanyId(company?.id || null);
        setCompanyForm(company ? { name: company.name, gst: company.gst, address: company.address, phoneNumbers: company.phoneNumbers } : emptyCompany);
        setShowCompanyModal(true);
        setError("");
    };

    const closeCompanyModal = () => {
        setShowCompanyModal(false);
        setEditingCompanyId(null);
        setCompanyForm(emptyCompany);
    };

    const openLedgerModal = (mode: "receipt" | "openingBalance" | "edit", entry?: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
        setLedgerModalMode(mode);
        setEditingLedgerEntry(entry || null);
        setLedgerForm(entry ? {
            gateway: entry.gateway || "upi",
            entrySide: Number(entry.credit || 0) > 0 ? "credit" : "debit",
            amount: String(entry.amount || ""),
            date: entry.date || new Date().toISOString().split("T")[0],
            bank: entry.bank || "",
            chequeNumber: entry.chequeNumber || "",
            note: entry.note || "",
            adjustedBillIds: (entry.billAdjustments || []).map((adjustment) => adjustment.billId),
            ledgerTarget: entry.source === "Purchase" ? "purchase" : "sales"
        } : { ...emptyLedgerForm, date: new Date().toISOString().split("T")[0], ledgerTarget: "sales" });
        setShowLedgerModal(true);
        setShowBillAdjustmentDropdown(false);
        setError("");
    };

    const closeLedgerModal = () => {
        setShowLedgerModal(false);
        setEditingLedgerEntry(null);
        setLedgerForm({ ...emptyLedgerForm, ledgerTarget: "purchase" });
        setShowBillAdjustmentDropdown(false);
    };

    const isOrphanedBillLinkedEntry = (entry: CompanyLedgerEntry) => {
        if ((entry.entryKind !== "bill" && entry.entryKind !== "payment") || !entry.billId) {
            return false;
        }
        return !selectedCompanyBillIds.has(String(entry.billId));
    };

    const handleEditLedgerEntry = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
        if (entry.entryKind === "bill" || entry.entryKind === "payment") {
            if (isOrphanedBillLinkedEntry(entry)) {
                setError("This bill-linked row is orphaned because the bill was deleted. You can delete it from the ledger.");
                return;
            }
            setError("Bill-linked ledger rows should be edited from the Bills tab.");
            return;
        }
        openLedgerModal("edit", entry);
    };

    const handleDeleteLedgerEntry = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
        if (entry.entryKind === "bill" || entry.entryKind === "payment") {
            if (isOrphanedBillLinkedEntry(entry)) {
                void removeLedgerEntry({
                    ...entry,
                    entryKind: "receipt"
                });
                return;
            }
            setError("Bill-linked ledger rows should be deleted from the Bills tab.");
            return;
        }
        void removeLedgerEntry(entry);
    };

    const saveCompany = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg || !user) return;
        setError("");
        if (editingCompanyId) {
            const result = await updateCompanyItem(activeOrg.orgId, editingCompanyId, companyForm);
            if (result.error) setError(result.error);
            else closeCompanyModal();
            return;
        }
        const result = await addCompanyItem(activeOrg.orgId, { ...companyForm, createdBy: user.uid });
        if (result.error) setError(result.error);
        else closeCompanyModal();
    };

    const saveLedgerEntry = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg || !selectedCompany || !selectedCompany.id) return;
        const selectedBillAdjustments: LedgerBillAdjustment[] = (ledgerForm.adjustedBillIds || [])
            .map((billId) => {
                const bill = selectedCompanyReceiptBills.find((item) => item.id === billId);
                if (!bill?.id) return null;
                return {
                    billId: bill.id,
                    billNumber: bill.billNumber,
                    amount: Number(bill.amount || 0)
                };
            })
            .filter((adjustment): adjustment is LedgerBillAdjustment => Boolean(adjustment));
        const amount = Number(ledgerForm.amount || 0);
        if (!amount) {
            setError("Enter a valid amount.");
            return;
        }

        const targetLedger = ledgerForm.ledgerTarget === "sales" ? "salesLedger" : "purchaseLedger";
        const isOpeningBalanceEntry = ledgerModalMode === "openingBalance" || editingLedgerEntry?.entryKind === "openingBalance";
        const payload: Partial<CompanyLedgerEntry> = {
            date: ledgerForm.date,
            amount,
            companyName: selectedCompany.name,
            gateway: ledgerForm.gateway,
            bank: ledgerForm.bank,
            chequeNumber: ledgerForm.gateway === "cheque" ? ledgerForm.chequeNumber : "",
            note: ledgerForm.note,
            entryKind: isOpeningBalanceEntry ? "openingBalance" : "receipt",
            billNumber: isOpeningBalanceEntry ? `Opening Balance FY ${getFinancialYearLabel()}` : selectedBillAdjustments.map((adjustment) => adjustment.billNumber).join(", "),
            billAdjustments: isOpeningBalanceEntry ? [] : selectedBillAdjustments,
            billType: ledgerForm.ledgerTarget === "sales" ? "Sale" : "Purchase",
            credit: ledgerForm.entrySide === "credit" ? amount : 0,
            debit: ledgerForm.entrySide === "debit" ? amount : 0
        };
        const affectedBillIds = Array.from(new Set([
            ...(editingLedgerEntry?.billAdjustments || []).map((adjustment) => adjustment.billId),
            ...selectedBillAdjustments.map((adjustment) => adjustment.billId)
        ]));

        if (ledgerModalMode === "edit" && editingLedgerEntry?.id) {
            if (editingLedgerEntry.entryKind === "bill" || editingLedgerEntry.entryKind === "payment") {
                setError("Bill-linked ledger rows should be edited from the Bills tab.");
                return;
            }
            const result = await updateCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, targetLedger, editingLedgerEntry.id, payload);
            if (result.error) {
                setError(result.error);
                return;
            }
            if (affectedBillIds.length) {
                const syncResult = await syncBillPaymentStatusFromLedger(activeOrg.orgId, selectedCompany.id, affectedBillIds);
                if (syncResult.error) {
                    setError(syncResult.error);
                    return;
                }
            }
            closeLedgerModal();
            return;
        }

        const result = await addCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, targetLedger, payload as Omit<CompanyLedgerEntry, "id" | "createdAt" | "updatedAt">);
        if (result.error) {
            setError(result.error);
            return;
        }
        if (selectedBillAdjustments.length) {
            const syncResult = await syncBillPaymentStatusFromLedger(activeOrg.orgId, selectedCompany.id, selectedBillAdjustments.map((adjustment) => adjustment.billId));
            if (syncResult.error) {
                setError(syncResult.error);
                return;
            }
        }
        closeLedgerModal();
    };

    const removeLedgerEntry = async (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
        if (!activeOrg || !selectedCompany?.id || !entry.id) return;
        if (entry.entryKind === "bill" || entry.entryKind === "payment") {
            setError("Bill-linked ledger rows should be deleted from the Bills tab.");
            return;
        }
        const targetLedger = entry.source === "Purchase" ? "purchaseLedger" : "salesLedger";
        const result = await deleteCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, targetLedger, entry.id);
        if (result.error) {
            setError(result.error);
            return;
        }
        if (entry.entryKind === "receipt" && (entry.billAdjustments || []).length > 0) {
            const syncResult = await syncBillPaymentStatusFromLedger(activeOrg.orgId, selectedCompany.id, (entry.billAdjustments || []).map((adjustment) => adjustment.billId));
            if (syncResult.error) {
                setError(syncResult.error);
            }
        }
    };

    const removeCompany = async () => {
        if (!activeOrg || !selectedCompany?.id) return;
        const result = await deleteCompanyItem(activeOrg.orgId, selectedCompany.id);
        if (result.error) {
            setError(result.error);
            return;
        }
        closeCompanyModal();
        setSelectedCompanyId(null);
    };

    const handleRefreshAllBalances = async () => {
        if (!activeOrg || refreshing) return;
        setRefreshing(true);
        try {
            await Promise.all(companies.map(c => recalculateCompanyBalance(activeOrg.orgId, c.id!)));
        } catch (error) {
            console.error("Refresh balances error:", error);
        } finally {
            setRefreshing(false);
        }
    };

    const exportLedgerPdf = () => {
        if (!selectedCompany) return;

        try {
            const rowsHtml = ledgerRows.map((entry) => `
                <tr>
                    <td>${escapeHtml(entry.date || "-")}</td>
                    <td>${escapeHtml(getEntryTypeLabel(entry))}</td>
                    <td>${escapeHtml(entry.billNumber || "-")}</td>
                    <td>${escapeHtml(entry.gateway || "-")}</td>
                    <td>${escapeHtml(formatCurrencyINR(Number(entry.debit || 0)))}</td>
                    <td>${escapeHtml(formatCurrencyINR(Number(entry.credit || 0)))}</td>
                    <td>${escapeHtml(formatCurrencyINR(Number(entry.amount || 0)))}</td>
                    <td>${escapeHtml(entry.note || "-")}</td>
                </tr>
            `).join("");

            openPrintWindow(
                `${selectedCompany.name} Ledger`,
                `
                    <h1>${escapeHtml(selectedCompany.name)} Ledger</h1>
                    <p class="meta">Generated on ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
                    <div class="grid">
                        <div class="card">
                            <div class="label">GST</div>
                            <div class="value" style="font-size:16px;">${escapeHtml(selectedCompany.gst || "-")}</div>
                        </div>
                        <div class="card">
                            <div class="label">Total Debit</div>
                            <div class="value">${escapeHtml(formatCurrencyINR(totalDebit))}</div>
                        </div>
                        <div class="card">
                            <div class="label">Total Credit</div>
                            <div class="value">${escapeHtml(formatCurrencyINR(totalCredit))}</div>
                        </div>
                    </div>
                    <div class="section">
                        <h2>Ledger Entries</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Bill Number</th>
                                    <th>Mode</th>
                                    <th>Debit</th>
                                    <th>Credit</th>
                                    <th>Amount</th>
                                    <th>Remarks</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml || '<tr><td colspan="8">No entries found.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                `
            );
        } catch (err: any) {
            setError(err.message || "Failed to open PDF. Please try again.");
        }
    };

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <p className="section-kicker">Companies Workspace</p>
                    <h1 className="dashboard-title">Companies</h1>
                    <p className="dashboard-subtitle">Manage profiles, ledgers, opening balances, and company balances from one place.</p>
                </div>
                <button className="btn-primary" onClick={() => openCompanyModal()}><Plus size={18} style={{ marginRight: "8px" }} /> Add Company</button>
            </header>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            {!selectedCompany ? (
                <section className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "18px", borderBottom: "1px solid var(--border-color)", display: "flex", flexWrap: "wrap", gap: "12px" }}>
                        <div className="search-box" style={{ flex: 2, minWidth: "200px" }}>
                            <Search size={16} />
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company name or GST..." />
                        </div>
                        <div style={{ display: "flex", gap: "8px", flex: 1, minWidth: "200px" }}>
                            <select 
                                value={sortOption} 
                                onChange={(e) => setSortOption(e.target.value as "name-asc" | "name-desc" | "balance-asc" | "balance-desc")}
                                className="panel-icon-btn"
                                style={{ flex: 1, padding: "0 10px", fontSize: "13px", height: "38px", border: "1px solid var(--border-color)", borderRadius: "8px", background: "var(--card-bg)" }}
                            >
                                <option value="name-asc">Name (A-Z)</option>
                                <option value="name-desc">Name (Z-A)</option>
                                <option value="balance-asc">Balance (Low-High)</option>
                                <option value="balance-desc">Balance (High-Low)</option>
                            </select>
                            <button
                                onClick={handleRefreshAllBalances}
                                disabled={refreshing}
                                className="panel-icon-btn"
                                title="Refresh Balances"
                                style={{ opacity: refreshing ? 0.5 : 1, width: "38px", height: "38px" }}
                            >
                                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                            </button>
                        </div>
                    </div>
                    <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                        {loading ? <div style={{ padding: "24px" }}>Loading companies...</div> : filteredCompanies.length === 0 ? <div style={{ padding: "24px", opacity: 0.7 }}>No companies found.</div> : filteredCompanies.map((company) => (
                            <button key={company.id} type="button" className="workspace-list-row" onClick={() => setSelectedCompanyId(company.id || null)}>
                                <div style={{ flex: 1, textAlign: "left" }}>
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                                        <div style={{ fontWeight: 700 }}>{company.name}</div>
                                        <div style={{ 
                                            fontSize: "11px", 
                                            fontWeight: 800, 
                                            padding: "2px 6px", 
                                            borderRadius: "12px",
                                            backgroundColor: (company.balance || 0) > 0 ? "#dcfce7" : (company.balance || 0) < 0 ? "#fee2e2" : "#f1f5f9",
                                            color: (company.balance || 0) > 0 ? "#166534" : (company.balance || 0) < 0 ? "#991b1b" : "#475569"
                                        }}>
                                            {formatCurrencyINR(Math.abs(company.balance || 0))}
                                            {(company.balance || 0) > 0 ? " Dr" : (company.balance || 0) < 0 ? " Cr" : ""}
                                        </div>
                                    </div>
                                    <div style={{ opacity: 0.76 }}>{company.gst || "No GST recorded"}</div>
                                </div>
                                <Building2 size={18} />
                            </button>
                        ))}
                    </div>
                </section>
            ) : (
                <section className="glass-panel workspace-detail-panel">
                    <div style={{ display: "grid", gap: "18px" }}>
                        <div className="section-header-row">
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                <button type="button" className="panel-icon-btn" onClick={() => setSelectedCompanyId(null)}><ArrowLeft size={18} /></button>
                                <div>
                                    <p className="section-kicker">Selected Company</p>
                                    <h2 className="section-title">{selectedCompany.name}</h2>
                                    <p style={{ opacity: 0.72 }}>{selectedCompany.address || "No address recorded"}</p>
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                                <button className="btn-secondary" onClick={() => openCompanyModal(selectedCompany)}><FileText size={16} style={{ marginRight: "8px" }} /> Edit</button>
                                <button className="btn-secondary" onClick={exportLedgerPdf}><FileText size={16} style={{ marginRight: "8px" }} /> Ledger PDF</button>
                                <button className="btn-secondary" onClick={() => openLedgerModal("receipt")}><CreditCard size={16} style={{ marginRight: "8px" }} /> Add a Receipt</button>
                                <button className="btn-secondary" onClick={() => openLedgerModal("openingBalance")}><Wallet size={16} style={{ marginRight: "8px" }} /> Opening Balance</button>
                            </div>
                        </div>

                        <div className="detail-pair-grid">
                            <div className="bill-section"><span className="detail-label">GST</span><strong>{selectedCompany.gst || "-"}</strong></div>
                            <div className="bill-section"><span className="detail-label">Phone</span><strong>{selectedCompany.phoneNumbers || "-"}</strong></div>
                            <div className="bill-section"><span className="detail-label">Total Debit</span><strong>{formatCurrencyINR(totalDebit)}</strong></div>
                            <div className="bill-section"><span className="detail-label">Total Credit</span><strong>{formatCurrencyINR(totalCredit)}</strong></div>
                            <div className="bill-section"><span className="detail-label">Remaining Balance</span>
                                <strong>
                                    {formatCurrencyINR(Math.abs(remainingBalance))}
                                    {remainingBalance > 0 ? " Dr (Receivable)" : remainingBalance < 0 ? " Cr (Payable)" : " (Settled)"}
                                </strong>
                            </div>
                        </div>

                        <div className="bill-section" style={{ padding: 0, overflow: "hidden" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead style={{ background: "var(--border-color)" }}>
                                    <tr>
                                        {["Date", "Type", "Bill Number", "Mode", "Debit", "Credit", "Amount", "Remarks", "Actions"].map((label) => <th key={label} style={{ padding: "14px 16px", textAlign: "left" }}>{label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledgerRows.length === 0 ? (
                                        <tr><td colSpan={9} style={{ padding: "24px 16px", opacity: 0.7 }}>No entries yet.</td></tr>
                                    ) : ledgerRows.map((entry) => (
                                        <tr key={entry.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                            <td style={{ padding: "14px 16px" }}>{entry.date}</td>
                                            <td style={{ padding: "14px 16px" }}>
                                                {(() => {
                                                    const typeStyles = getEntryTypeStyles(entry);
                                                    return (
                                                <span style={{ 
                                                    fontSize: "11px", 
                                                    fontWeight: 700, 
                                                    padding: "2px 6px", 
                                                    borderRadius: "4px",
                                                    backgroundColor: typeStyles.backgroundColor,
                                                    color: typeStyles.color
                                                }}>
                                                    {getEntryTypeLabel(entry)}
                                                </span>
                                                    );
                                                })()}
                                            </td>
                                            <td style={{ padding: "14px 16px" }}>
                                                {entry.billImagePublicId || entry.billImageUrl ? (
                                                    <a className="inline-link" href={entry.billImagePublicId ? `/api/bills/file?publicId=${encodeURIComponent(entry.billImagePublicId)}&resourceType=${encodeURIComponent(entry.billImageResourceType || "image")}` : entry.billImageUrl} target="_blank" rel="noreferrer">
                                                        {entry.billNumber || "View Bill"}
                                                    </a>
                                                ) : (
                                                    entry.billNumber || "-"
                                                )}
                                            </td>
                                            <td style={{ padding: "14px 16px", textTransform: "capitalize" }}>{entry.gateway || "-"}</td>
                                            <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.debit)}</td>
                                            <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.credit)}</td>
                                            <td style={{ padding: "14px 16px", fontWeight: 700 }}>{formatCurrencyINR(entry.amount)}</td>
                                            <td style={{ padding: "14px 16px", fontSize: "12px", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.note}>
                                                {entry.note || "-"}
                                            </td>
                                            <td style={{ padding: "14px 16px" }}>
                                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                    <button type="button" className="panel-icon-btn" onClick={() => handleEditLedgerEntry(entry)} title={entry.entryKind === "bill" || entry.entryKind === "payment" ? "Edit from Bills tab" : "Edit entry"}>
                                                        <Pencil size={15} />
                                                    </button>
                                                    <button type="button" className="panel-icon-btn" onClick={() => handleDeleteLedgerEntry(entry)} title={entry.entryKind === "bill" || entry.entryKind === "payment" ? "Delete from Bills tab" : "Delete entry"} style={{ color: entry.entryKind === "bill" || entry.entryKind === "payment" ? undefined : "#dc2626" }}>
                                                        <Trash2 size={15} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}

            {showCompanyModal && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "520px", position: "relative" }}>
                        <button className="panel-close" onClick={closeCompanyModal}>&times;</button>
                        <h2 style={{ marginBottom: "18px" }}>{editingCompanyId ? "Edit Company" : "Add Company"}</h2>
                        <form onSubmit={saveCompany} style={{ display: "grid", gap: "14px" }}>
                            <input className="input-field" placeholder="Company Name" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} required />
                            <input className="input-field" placeholder="GST" value={companyForm.gst} onChange={(e) => setCompanyForm({ ...companyForm, gst: e.target.value })} />
                            <input className="input-field" placeholder="Phone" value={companyForm.phoneNumbers} onChange={(e) => setCompanyForm({ ...companyForm, phoneNumbers: e.target.value })} />
                            <textarea className="input-field" placeholder="Address" value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
                            <button className="btn-primary">{editingCompanyId ? "Update Company" : "Save Company"}</button>
                            {editingCompanyId && selectedCompany && <button type="button" className="btn-secondary" onClick={removeCompany}>Delete Company</button>}
                        </form>
                    </div>
                </div>
            )}

            {showLedgerModal && selectedCompany && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "520px", position: "relative" }}>
                        <button className="panel-close" onClick={closeLedgerModal}>&times;</button>
                        <h2 style={{ marginBottom: "18px" }}>
                            {ledgerModalMode === "openingBalance"
                                ? `Opening Balance FY ${getFinancialYearLabel()}`
                                : ledgerModalMode === "edit"
                                    ? "Edit Ledger Entry"
                                    : `Add a Receipt for ${selectedCompany.name}`}
                        </h2>
                        <form onSubmit={saveLedgerEntry} style={{ display: "grid", gap: "14px" }}>
                            <select className="input-field" value={ledgerForm.gateway} onChange={(e) => setLedgerForm({ ...ledgerForm, gateway: e.target.value as LedgerGateway })}>
                                <option value="upi">UPI</option>
                                <option value="bank transfer">Bank Transfer</option>
                                <option value="cash">Cash</option>
                                <option value="cheque">Cheque</option>
                            </select>
                            <select className="input-field" value={ledgerForm.entrySide} onChange={(e) => setLedgerForm({ ...ledgerForm, entrySide: e.target.value as "debit" | "credit" })}>
                                <option value="credit">Credit</option>
                                <option value="debit">Debit</option>
                            </select>
                            {ledgerModalMode !== "openingBalance" && (
                                <div ref={billAdjustmentDropdownRef} style={{ position: "relative" }}>
                                    <label className="section-label">Bill Adjustments (Optional)</label>
                                    <button
                                        type="button"
                                        className="input-field"
                                        onClick={() => setShowBillAdjustmentDropdown((current) => !current)}
                                        style={{
                                            textAlign: "left",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between"
                                        }}
                                    >
                                        <span>
                                            {ledgerForm.adjustedBillIds.length > 0
                                                ? `${ledgerForm.adjustedBillIds.length} bill${ledgerForm.adjustedBillIds.length > 1 ? "s" : ""} selected`
                                                : "Select bill numbers"}
                                        </span>
                                        <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>{showBillAdjustmentDropdown ? "▲" : "▼"}</span>
                                    </button>
                                    {showBillAdjustmentDropdown && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                top: "calc(100% + 8px)",
                                                left: 0,
                                                right: 0,
                                                zIndex: 30,
                                                maxHeight: "220px",
                                                overflowY: "auto",
                                                border: "1px solid var(--border-color)",
                                                borderRadius: "14px",
                                                background: "var(--surface-color)",
                                                boxShadow: "var(--shadow-md)",
                                                padding: "8px"
                                            }}
                                        >
                                            {selectedCompanyReceiptBills.length === 0 ? (
                                                <div style={{ padding: "10px 12px", opacity: 0.7 }}>No sales bills available</div>
                                            ) : selectedCompanyReceiptBills.map((bill) => {
                                                const billId = String(bill.id || "");
                                                const checked = ledgerForm.adjustedBillIds.includes(billId);

                                                return (
                                                    <label
                                                        key={billId}
                                                        style={{
                                                            display: "flex",
                                                            gap: "10px",
                                                            alignItems: "flex-start",
                                                            padding: "10px 12px",
                                                            borderRadius: "12px",
                                                            cursor: "pointer"
                                                        }}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => setLedgerForm((current) => {
                                                                const adjustedBillIds = checked
                                                                    ? current.adjustedBillIds.filter((id) => id !== billId)
                                                                    : [...current.adjustedBillIds, billId];
                                                                return {
                                                                    ...current,
                                                                    adjustedBillIds,
                                                                    ledgerTarget: "sales"
                                                                };
                                                            })}
                                                            style={{ marginTop: "3px" }}
                                                        />
                                                        <span style={{ display: "grid", gap: "2px" }}>
                                                            <span style={{ fontWeight: 600 }}>{bill.billNumber}</span>
                                                            <span style={{ fontSize: "0.85rem", opacity: 0.72 }}>
                                                                {bill.billType} - {bill.date} - {formatCurrencyINR(Number(bill.amount || 0))}
                                                            </span>
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {selectedAdjustmentBills.length > 0 && (
                                        <div style={{ marginTop: "8px", fontSize: "0.84rem", opacity: 0.78 }}>
                                            {selectedAdjustmentBills.map((bill) => bill.billNumber).join(", ")}
                                        </div>
                                    )}
                                </div>
                            )}
                            <input
                                className="input-field"
                                type="number"
                                placeholder="Amount"
                                value={ledgerForm.amount}
                                onChange={(e) => setLedgerForm({ ...ledgerForm, amount: e.target.value })}
                                required
                            />
                            {ledgerModalMode !== "openingBalance" && selectedAdjustmentBills.length > 0 && (
                                <div style={{ fontSize: "0.84rem", opacity: 0.74 }}>
                                    Selected bill total: {formatCurrencyINR(selectedAdjustmentBills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0))}. Receipt amount is manual, so you can record partial payments or adjustments.
                                </div>
                            )}
                            <input className="input-field" type="date" value={ledgerForm.date} onChange={(e) => setLedgerForm({ ...ledgerForm, date: e.target.value })} required />
                            <input className="input-field" placeholder="Bank" value={ledgerForm.bank} onChange={(e) => setLedgerForm({ ...ledgerForm, bank: e.target.value })} />
                            {ledgerForm.gateway === "cheque" && <input className="input-field" placeholder="Cheque Number" value={ledgerForm.chequeNumber} onChange={(e) => setLedgerForm({ ...ledgerForm, chequeNumber: e.target.value })} />}
                            <textarea className="input-field" placeholder="Note" value={ledgerForm.note} onChange={(e) => setLedgerForm({ ...ledgerForm, note: e.target.value })} />
                            <button className="btn-primary">
                                {ledgerModalMode === "openingBalance" ? "Save Opening Balance" : ledgerModalMode === "edit" ? "Update Entry" : "Save Receipt"}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
