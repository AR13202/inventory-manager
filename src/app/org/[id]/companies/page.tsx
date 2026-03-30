"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Building2, CreditCard, FileText, Plus, Search, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import {
    addCompanyItem,
    addCompanyLedgerEntry,
    Company,
    CompanyLedgerEntry,
    deleteCompanyItem,
    subscribeToCompanies,
    subscribeToCompanyLedger,
    updateCompanyItem
} from "@/utils/firebaseHelpers/companies";
import { formatCurrencyINR } from "@/utils/formatters";

const emptyCompany = { name: "", gst: "", address: "", phoneNumbers: "" };
const emptyCredit = { gateway: "upi", amount: "", date: new Date().toISOString().split("T")[0], bank: "", chequeNumber: "", note: "" };

export default function CompaniesPage() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const [companies, setCompanies] = useState<Company[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [purchaseLedger, setPurchaseLedger] = useState<CompanyLedgerEntry[]>([]);
    const [salesLedger, setSalesLedger] = useState<CompanyLedgerEntry[]>([]);
    const [activeTab, setActiveTab] = useState<"purchaseLedger" | "salesLedger">("purchaseLedger");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [showCompanyModal, setShowCompanyModal] = useState(false);
    const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
    const [companyForm, setCompanyForm] = useState(emptyCompany);
    const [showCreditModal, setShowCreditModal] = useState(false);
    const [creditForm, setCreditForm] = useState(emptyCredit);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!activeOrg || !user) return;
        const unsubscribe = subscribeToCompanies(activeOrg.orgId, (items) => {
            setCompanies(items);
            setLoading(false);
            if (!selectedCompanyId && items[0]?.id) setSelectedCompanyId(items[0].id);
        });
        return () => unsubscribe();
    }, [activeOrg, user, selectedCompanyId]);

    useEffect(() => {
        if (!activeOrg || !selectedCompanyId) return;
        const unsubPurchase = subscribeToCompanyLedger(activeOrg.orgId, selectedCompanyId, "purchaseLedger", setPurchaseLedger);
        const unsubSales = subscribeToCompanyLedger(activeOrg.orgId, selectedCompanyId, "salesLedger", setSalesLedger);
        return () => { unsubPurchase(); unsubSales(); };
    }, [activeOrg, selectedCompanyId]);

    const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedCompanyId) || companies[0] || null, [companies, selectedCompanyId]);
    const ledgerRows = activeTab === "purchaseLedger" ? purchaseLedger : salesLedger;
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

    const saveCompany = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg || !user) return;
        setError("");
        if (editingCompanyId) {
            const result = await updateCompanyItem(activeOrg.orgId, editingCompanyId, companyForm);
            if (result.error) setError(result.error);
            else setShowCompanyModal(false);
            return;
        }
        const result = await addCompanyItem(activeOrg.orgId, { ...companyForm, createdBy: user.uid });
        if (result.error) setError(result.error);
        else setShowCompanyModal(false);
    };

    const addCredit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg || !selectedCompany || !selectedCompany.id) return;
        const targetLedger = activeTab === "purchaseLedger" ? "purchaseLedger" : "salesLedger";
        const amount = Number(creditForm.amount || 0);
        const result = await addCompanyLedgerEntry(activeOrg.orgId, selectedCompany.id, targetLedger, {
            entryKind: "credit",
            billNumber: "",
            date: creditForm.date,
            credit: targetLedger === "salesLedger" ? amount : 0,
            debit: targetLedger === "purchaseLedger" ? amount : 0,
            amount,
            companyName: selectedCompany.name,
            gateway: creditForm.gateway as "upi" | "bank transfer" | "cheque",
            bank: creditForm.bank,
            chequeNumber: creditForm.gateway === "cheque" ? creditForm.chequeNumber : "",
            note: creditForm.note
        });
        if (result.error) {
            setError(result.error);
            return;
        }
        setShowCreditModal(false);
        setCreditForm(emptyCredit);
    };

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <p className="section-kicker">Companies Workspace</p>
                    <h1 className="dashboard-title">Companies</h1>
                    <p className="dashboard-subtitle">Browse companies on the left and manage the selected ledger on the right.</p>
                </div>
                <button className="btn-primary" onClick={() => openCompanyModal()}><Plus size={18} style={{ marginRight: "8px" }} /> Add Company</button>
            </header>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="workspace-grid">
                <section className="glass-panel" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "18px", borderBottom: "1px solid var(--border-color)" }}>
                        <div className="search-box">
                            <Search size={16} />
                            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company name or GST..." />
                        </div>
                    </div>
                    <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                        {loading ? <div style={{ padding: "24px" }}>Loading companies...</div> : filteredCompanies.length === 0 ? <div style={{ padding: "24px", opacity: 0.7 }}>No companies found.</div> : filteredCompanies.map((company) => (
                            <button key={company.id} type="button" className={`workspace-list-row ${selectedCompany?.id === company.id ? "active" : ""}`} onClick={() => setSelectedCompanyId(company.id || null)}>
                                <div>
                                    <div style={{ fontWeight: 700 }}>{company.name}</div>
                                    <div style={{ opacity: 0.76 }}>{company.gst || "No GST recorded"}</div>
                                </div>
                                <Building2 size={18} />
                            </button>
                        ))}
                    </div>
                </section>

                <section className="glass-panel workspace-detail-panel">
                    {selectedCompany ? (
                        <div>
                            <div className="section-header-row" style={{ marginBottom: "18px" }}>
                                <div>
                                    <p className="section-kicker">Selected Company</p>
                                    <h2 className="section-title">{selectedCompany.name}</h2>
                                    <p style={{ opacity: 0.72 }}>{selectedCompany.address || "No address recorded"}</p>
                                </div>
                                <div style={{ display: "flex", gap: "10px" }}>
                                    <button className="btn-secondary" onClick={() => openCompanyModal(selectedCompany)}><FileText size={16} style={{ marginRight: "8px" }} /> Edit</button>
                                    <button className="btn-secondary" onClick={() => setShowCreditModal(true)}><CreditCard size={16} style={{ marginRight: "8px" }} /> Register Credit</button>
                                </div>
                            </div>

                            <div className="company-tabs">
                                <button className={`company-tab ${activeTab === "purchaseLedger" ? "active" : ""}`} onClick={() => setActiveTab("purchaseLedger")}>Purchase</button>
                                <button className={`company-tab ${activeTab === "salesLedger" ? "active" : ""}`} onClick={() => setActiveTab("salesLedger")}>Sales</button>
                            </div>

                            <div className="bill-section">
                                <div className="detail-pair-grid">
                                    <div><span className="detail-label">GST</span><strong>{selectedCompany.gst || "-"}</strong></div>
                                    <div><span className="detail-label">Phone</span><strong>{selectedCompany.phoneNumbers || "-"}</strong></div>
                                </div>
                            </div>

                            <div className="bill-section" style={{ padding: 0, overflow: "hidden" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead style={{ background: "var(--border-color)" }}>
                                        <tr>
                                            {["Date", "Bill Number", "Debit", "Credit", "Amount", "Gateway"].map((label) => <th key={label} style={{ padding: "14px 16px", textAlign: "left" }}>{label}</th>)}
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
                                                        entry.billNumber || "-"
                                                    )}
                                                </td>
                                                <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.debit)}</td>
                                                <td style={{ padding: "14px 16px" }}>{formatCurrencyINR(entry.credit)}</td>
                                                <td style={{ padding: "14px 16px", fontWeight: 700 }}>{formatCurrencyINR(entry.amount)}</td>
                                                <td style={{ padding: "14px 16px" }}>{entry.gateway || (entry.entryKind === "bill" ? "Bill" : "-")}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state-panel"><Building2 size={28} /><h2>No company selected</h2><p>Select a company from the list to open its ledgers.</p></div>
                    )}
                </section>
            </div>

            {showCompanyModal && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "520px", position: "relative" }}>
                        <button className="panel-close" onClick={() => setShowCompanyModal(false)}>&times;</button>
                        <h2 style={{ marginBottom: "18px" }}>{editingCompanyId ? "Edit Company" : "Add Company"}</h2>
                        <form onSubmit={saveCompany} style={{ display: "grid", gap: "14px" }}>
                            <input className="input-field" placeholder="Company Name" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} required />
                            <input className="input-field" placeholder="GST" value={companyForm.gst} onChange={(e) => setCompanyForm({ ...companyForm, gst: e.target.value })} />
                            <input className="input-field" placeholder="Phone" value={companyForm.phoneNumbers} onChange={(e) => setCompanyForm({ ...companyForm, phoneNumbers: e.target.value })} />
                            <textarea className="input-field" placeholder="Address" value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
                            <button className="btn-primary">{editingCompanyId ? "Update Company" : "Save Company"}</button>
                            {editingCompanyId && selectedCompany && <button type="button" className="btn-secondary" onClick={() => deleteCompanyItem(activeOrg!.orgId, selectedCompany.id as string)}>Delete Company</button>}
                        </form>
                    </div>
                </div>
            )}

            {showCreditModal && selectedCompany && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "520px", position: "relative" }}>
                        <button className="panel-close" onClick={() => setShowCreditModal(false)}>&times;</button>
                        <h2 style={{ marginBottom: "18px" }}>Register Credit for {selectedCompany.name}</h2>
                        <form onSubmit={addCredit} style={{ display: "grid", gap: "14px" }}>
                            <select className="input-field" value={creditForm.gateway} onChange={(e) => setCreditForm({ ...creditForm, gateway: e.target.value })}>
                                <option value="upi">UPI</option>
                                <option value="bank transfer">Bank Transfer</option>
                                <option value="cheque">Cheque</option>
                            </select>
                            <input className="input-field" type="number" placeholder="Amount" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} required />
                            <input className="input-field" type="date" value={creditForm.date} onChange={(e) => setCreditForm({ ...creditForm, date: e.target.value })} required />
                            <input className="input-field" placeholder="Bank" value={creditForm.bank} onChange={(e) => setCreditForm({ ...creditForm, bank: e.target.value })} />
                            {creditForm.gateway === "cheque" && <input className="input-field" placeholder="Cheque Number" value={creditForm.chequeNumber} onChange={(e) => setCreditForm({ ...creditForm, chequeNumber: e.target.value })} />}
                            <textarea className="input-field" placeholder="Note" value={creditForm.note} onChange={(e) => setCreditForm({ ...creditForm, note: e.target.value })} />
                            <button className="btn-primary">Save Credit Entry</button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
