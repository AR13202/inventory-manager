"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CreditCard, FileText, Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import {
    addCompanyItem,
    addCompanyLedgerEntry,
    Company,
    CompanyLedgerEntry,
    deleteCompanyItem,
    deleteCompanyLedgerEntry,
    LedgerGateway,
    LedgerType,
    subscribeToCompanies,
    subscribeToCompanyLedger,
    updateCompanyItem,
    updateCompanyLedgerEntry
} from "@/utils/firebaseHelpers/companies";
import { formatCurrencyINR } from "@/utils/formatters";

const emptyCompany = { name: "", gst: "", address: "", phoneNumbers: "" };
const emptyLedgerForm = {
    gateway: "upi" as LedgerGateway,
    amount: "",
    date: new Date().toISOString().split("T")[0],
    bank: "",
    chequeNumber: "",
    note: ""
};

const getFinancialYearLabel = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
};

export default function CompaniesPage() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [purchaseLedger, setPurchaseLedger] = useState<CompanyLedgerEntry[]>([]);
    const [salesLedger, setSalesLedger] = useState<CompanyLedgerEntry[]>([]);
    const [activeTab, setActiveTab] = useState<LedgerType>("purchaseLedger");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showCompanyModal, setShowCompanyModal] = useState(false);
    const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
    const [companyForm, setCompanyForm] = useState(emptyCompany);
    const [showLedgerModal, setShowLedgerModal] = useState(false);
    const [ledgerModalMode, setLedgerModalMode] = useState<"credit" | "openingBalance" | "edit">("credit");
    const [editingLedgerEntry, setEditingLedgerEntry] = useState<CompanyLedgerEntry | null>(null);
    const [ledgerForm, setLedgerForm] = useState(emptyLedgerForm);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!activeOrg || !user) return;
        const unsubscribe = subscribeToCompanies(activeOrg.orgId, (items) => {
            setCompanies(items);
            setLoading(false);
        });
        return () => unsubscribe();
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

    const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) || null, [companies, selectedCompanyId]);
    const ledgerRows = activeTab === "purchaseLedger" ? purchaseLedger : salesLedger;
    const totalDebit = [...purchaseLedger, ...salesLedger].reduce((sum, entry) => sum + Number(entry.debit || 0), 0);
    const totalCredit = [...purchaseLedger, ...salesLedger].reduce((sum, entry) => sum + Number(entry.credit || 0), 0);
    const remainingBalance = totalCredit - totalDebit;
    const filteredCompanies = useMemo(() => companies.filter((company) => {
        const q = query.toLowerCase();
        if (!q) return true;
        return company.name.toLowerCase().includes(q) || (company.gst || "").toLowerCase().includes(q);
    }), [companies, query]);

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

    const openLedgerModal = (mode: "credit" | "openingBalance" | "edit", entry?: CompanyLedgerEntry) => {
        setLedgerModalMode(mode);
        setEditingLedgerEntry(entry || null);
        setLedgerForm(entry ? {
            gateway: entry.gateway || "upi",
            amount: String(entry.amount || ""),
            date: entry.date || new Date().toISOString().split("T")[0],
            bank: entry.bank || "",
            chequeNumber: entry.chequeNumber || "",
            note: entry.note || ""
        } : emptyLedgerForm);
        setShowLedgerModal(true);
        setError("");
    };

    const closeLedgerModal = () => {
        setShowLedgerModal(false);
        setEditingLedgerEntry(null);
        setLedgerForm(emptyLedgerForm);
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
        const amount = Number(ledgerForm.amount || 0);
        if (!amount) {
            setError("Enter a valid amount.");
            return;
        }

        const commonPayload = {
            date: ledgerForm.date,
            amount,
            companyName: selectedCompany.name,
            gateway: ledgerForm.gateway,
            bank: ledgerForm.bank,
            chequeNumber: ledgerForm.gateway === "cheque" ? ledgerForm.chequeNumber : "",
            note: ledgerForm.note
        };

        const payload: Omit<CompanyLedgerEntry, "id" | "createdAt" | "updatedAt"> = {
            entryKind: ledgerModalMode === "openingBalance" ? "openingBalance" : "credit",
            billNumber: ledgerModalMode === "openingBalance" ? `Opening Balance FY ${getFinancialYearLabel()}` : "",
            billType: activeTab === "salesLedger" ? "Sale" : "Purchase",
            credit: activeTab === "salesLedger" ? amount : 0,
            debit: activeTab === "purchaseLedger" ? amount : 0,
            ...commonPayload
        };

        if (ledgerModalMode === "edit" && editingLedgerEntry?.id) {
            if (editingLedgerEntry.entryKind === "bill" || editingLedgerEntry.entryKind === "payment") {
                setError("Bill-linked ledger rows should be edited from the Bills tab.");
                return;
            }
            const result = await updateCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, activeTab, editingLedgerEntry.id, payload);
            if (result.error) {
                setError(result.error);
                return;
            }
            closeLedgerModal();
            return;
        }

        const result = await addCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, activeTab, payload);
        if (result.error) {
            setError(result.error);
            return;
        }
        closeLedgerModal();
    };

    const removeLedgerEntry = async (entry: CompanyLedgerEntry) => {
        if (!activeOrg || !selectedCompany?.id || !entry.id) return;
        if (entry.entryKind === "bill" || entry.entryKind === "payment") {
            setError("Bill-linked ledger rows should be deleted from the Bills tab.");
            return;
        }
        const result = await deleteCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, activeTab, entry.id);
        if (result.error) {
            setError(result.error);
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
                    <div style={{ padding: "18px", borderBottom: "1px solid var(--border-color)" }}>
                        <div className="search-box">
                            <Search size={16} />
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company name or GST..." />
                        </div>
                    </div>
                    <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                        {loading ? <div style={{ padding: "24px" }}>Loading companies...</div> : filteredCompanies.length === 0 ? <div style={{ padding: "24px", opacity: 0.7 }}>No companies found.</div> : filteredCompanies.map((company) => (
                            <button key={company.id} type="button" className="workspace-list-row" onClick={() => setSelectedCompanyId(company.id || null)}>
                                <div>
                                    <div style={{ fontWeight: 700 }}>{company.name}</div>
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
                                <button className="btn-secondary" onClick={() => openLedgerModal("credit")}><CreditCard size={16} style={{ marginRight: "8px" }} /> Register Credit</button>
                                <button className="btn-secondary" onClick={() => openLedgerModal("openingBalance")}><Wallet size={16} style={{ marginRight: "8px" }} /> Opening Balance</button>
                            </div>
                        </div>

                        <div className="company-tabs">
                            <button className={`company-tab ${activeTab === "purchaseLedger" ? "active" : ""}`} onClick={() => setActiveTab("purchaseLedger")}>Purchase</button>
                            <button className={`company-tab ${activeTab === "salesLedger" ? "active" : ""}`} onClick={() => setActiveTab("salesLedger")}>Sales</button>
                        </div>

                        <div className="detail-pair-grid">
                            <div className="bill-section"><span className="detail-label">GST</span><strong>{selectedCompany.gst || "-"}</strong></div>
                            <div className="bill-section"><span className="detail-label">Phone</span><strong>{selectedCompany.phoneNumbers || "-"}</strong></div>
                            <div className="bill-section"><span className="detail-label">Total Debit</span><strong>{formatCurrencyINR(totalDebit)}</strong></div>
                            <div className="bill-section"><span className="detail-label">Total Credit</span><strong>{formatCurrencyINR(totalCredit)}</strong></div>
                            <div className="bill-section"><span className="detail-label">Remaining Balance</span><strong>{formatCurrencyINR(remainingBalance)}</strong></div>
                        </div>

                        <div className="bill-section" style={{ padding: 0, overflow: "hidden" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead style={{ background: "var(--border-color)" }}>
                                    <tr>
                                        {["Date", "Bill Number", "Debit", "Credit", "Amount", "Actions"].map((label) => <th key={label} style={{ padding: "14px 16px", textAlign: "left" }}>{label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledgerRows.length === 0 ? (
                                        <tr><td colSpan={6} style={{ padding: "24px 16px", opacity: 0.7 }}>No {activeTab === "purchaseLedger" ? "purchase" : "sales"} entries yet.</td></tr>
                                    ) : ledgerRows.map((entry) => (
                                        <tr key={entry.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                            <td style={{ padding: "14px 16px" }}>{entry.date}</td>
                                            <td style={{ padding: "14px 16px" }}>
                                                {entry.billImagePublicId || entry.billImageUrl ? (
                                                    <a className="inline-link" href={entry.billImagePublicId ? `/api/bills/file?publicId=${encodeURIComponent(entry.billImagePublicId)}&resourceType=${encodeURIComponent(entry.billImageResourceType || "image")}` : entry.billImageUrl} target="_blank" rel="noreferrer">
                                                        {entry.billNumber || "View Bill"}
                                                    </a>
                                                ) : (
                                                    entry.billNumber || entry.note || "-"
                                                )}
                                            </td>
                                            <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.debit)}</td>
                                            <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.credit)}</td>
                                            <td style={{ padding: "14px 16px", fontWeight: 700 }}>{formatCurrencyINR(entry.amount)}</td>
                                            <td style={{ padding: "14px 16px" }}>
                                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                                    <button type="button" className="panel-icon-btn" onClick={() => openLedgerModal("edit", entry)} disabled={entry.entryKind === "bill" || entry.entryKind === "payment"} title={entry.entryKind === "bill" || entry.entryKind === "payment" ? "Edit from Bills tab" : "Edit entry"}>
                                                        <Pencil size={15} />
                                                    </button>
                                                    <button type="button" className="panel-icon-btn" onClick={() => removeLedgerEntry(entry)} disabled={entry.entryKind === "bill" || entry.entryKind === "payment"} title={entry.entryKind === "bill" || entry.entryKind === "payment" ? "Delete from Bills tab" : "Delete entry"} style={{ color: entry.entryKind === "bill" || entry.entryKind === "payment" ? undefined : "#dc2626" }}>
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
                                    : `Register Credit for ${selectedCompany.name}`}
                        </h2>
                        <form onSubmit={saveLedgerEntry} style={{ display: "grid", gap: "14px" }}>
                            <select className="input-field" value={ledgerForm.gateway} onChange={(e) => setLedgerForm({ ...ledgerForm, gateway: e.target.value as LedgerGateway })}>
                                <option value="upi">UPI</option>
                                <option value="bank transfer">Bank Transfer</option>
                                <option value="cash">Cash</option>
                                <option value="cheque">Cheque</option>
                            </select>
                            <input className="input-field" type="number" placeholder="Amount" value={ledgerForm.amount} onChange={(e) => setLedgerForm({ ...ledgerForm, amount: e.target.value })} required />
                            <input className="input-field" type="date" value={ledgerForm.date} onChange={(e) => setLedgerForm({ ...ledgerForm, date: e.target.value })} required />
                            <input className="input-field" placeholder="Bank" value={ledgerForm.bank} onChange={(e) => setLedgerForm({ ...ledgerForm, bank: e.target.value })} />
                            {ledgerForm.gateway === "cheque" && <input className="input-field" placeholder="Cheque Number" value={ledgerForm.chequeNumber} onChange={(e) => setLedgerForm({ ...ledgerForm, chequeNumber: e.target.value })} />}
                            <textarea className="input-field" placeholder="Note" value={ledgerForm.note} onChange={(e) => setLedgerForm({ ...ledgerForm, note: e.target.value })} />
                            <button className="btn-primary">
                                {ledgerModalMode === "openingBalance" ? "Save Opening Balance" : ledgerModalMode === "edit" ? "Update Entry" : "Save Credit Entry"}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
