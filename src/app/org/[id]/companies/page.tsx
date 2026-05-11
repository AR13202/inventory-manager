"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Building2, CreditCard, FileText, Info, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, Wallet } from "lucide-react";
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
    adjustedBillIds: [] as string[],
    financialYear: ""
};

const getEntryTypeLabel = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
    if (entry.entryKind === "receipt" || entry.entryKind === "payment") return "Receipt";
    if (entry.source === "Purchase") return "Purchase";
    return "Sales";
};

const getEntryTypeStyles = (entry: CompanyLedgerEntry & { source?: "Purchase" | "Sale" }) => {
    if (entry.entryKind === "receipt" || entry.entryKind === "payment") {
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
    const menuDropdownRef = useRef<HTMLDivElement>(null);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [bills, setBills] = useState<BillItem[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [selectedFY, setSelectedFY] = useState(getFinancialYearLabel());
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
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [printFromFY, setPrintFromFY] = useState("");
    const [printToFY, setPrintToFY] = useState("");
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
            if (!menuDropdownRef.current?.contains(event.target as Node)) {
                setOpenMenuId(null);
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
    const availableFYs = useMemo(() => {
        const years = new Set<string>();
        const addYearFromDate = (dateStr: string) => {
            if (!dateStr) return;
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return;
            const year = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
            years.add(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
        };
        purchaseLedger.forEach(e => addYearFromDate(e.date));
        salesLedger.forEach(e => addYearFromDate(e.date));
        years.add(getFinancialYearLabel());
        return Array.from(years).sort((a, b) => b.localeCompare(a));
    }, [purchaseLedger, salesLedger]);

    const { ledgerRows, openingBalance, closingBalance } = useMemo(() => {
        const purchase = purchaseLedger.map(e => ({ ...e, source: "Purchase" as const }));
        const sales = salesLedger.map(e => ({ ...e, source: "Sale" as const }));
        const allEntries = [...purchase, ...sales].sort((a, b) => {
            const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeA - timeB;
        });

        const startYear = parseInt(selectedFY.split("-")[0], 10);
        const fyStartDateStr = `${startYear}-04-01`;
        const fyEndDateStr = `${startYear + 1}-04-01`;

        let openingBalance = 0;
        const currentFyEntries: (CompanyLedgerEntry & { source?: "Purchase" | "Sale" })[] = [];

        for (const entry of allEntries) {
            const isOpeningBalance = entry.entryKind === "openingBalance";

            if (entry.date < fyStartDateStr || (isOpeningBalance && entry.date === fyStartDateStr)) {
                openingBalance += (Number(entry.debit || 0) - Number(entry.credit || 0));
            } else if (!isOpeningBalance && entry.date >= fyStartDateStr && entry.date < fyEndDateStr) {
                currentFyEntries.push(entry);
            }
        }

        let runningBalance = openingBalance;
        const rows = currentFyEntries.map(entry => {
            runningBalance += (Number(entry.debit || 0) - Number(entry.credit || 0));
            return { ...entry, runningBalance };
        });

        return { ledgerRows: rows, openingBalance, closingBalance: runningBalance };
    }, [purchaseLedger, salesLedger, selectedFY]);

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
            ledgerTarget: entry.source === "Purchase" ? "purchase" : "sales",
            financialYear: entry.entryKind === "openingBalance" && entry.date ? `${entry.date.split("-")[0]}-${String((parseInt(entry.date.split("-")[0], 10) + 1) % 100).padStart(2, "0")}` : getFinancialYearLabel()
        } : { ...emptyLedgerForm, date: new Date().toISOString().split("T")[0], ledgerTarget: "sales", financialYear: selectedFY || getFinancialYearLabel() });
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
            date: isOpeningBalanceEntry ? `${ledgerForm.financialYear.split("-")[0]}-04-01` : ledgerForm.date,
            amount,
            companyName: selectedCompany.name,
            gateway: isOpeningBalanceEntry ? "upi" : ledgerForm.gateway,
            bank: isOpeningBalanceEntry ? "" : ledgerForm.bank,
            chequeNumber: isOpeningBalanceEntry ? "" : (ledgerForm.gateway === "cheque" ? ledgerForm.chequeNumber : ""),
            note: isOpeningBalanceEntry ? "" : ledgerForm.note,
            entryKind: isOpeningBalanceEntry ? "openingBalance" : "receipt",
            billNumber: isOpeningBalanceEntry ? `Opening Balance FY ${ledgerForm.financialYear}` : selectedBillAdjustments.map((adjustment) => adjustment.billNumber).join(", "),
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

    const exportLedgerPdf = (fromFY: string, toFY: string) => {
        if (!selectedCompany) return;

        try {
            const purchase = purchaseLedger.map(e => ({ ...e, source: "Purchase" as const }));
            const sales = salesLedger.map(e => ({ ...e, source: "Sale" as const }));
            const allEntries = [...purchase, ...sales].sort((a, b) => {
                const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
                if (dateDiff !== 0) return dateDiff;
                const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                return timeA - timeB;
            });

            const startYear = parseInt(fromFY.split("-")[0], 10);
            const endYear = parseInt(toFY.split("-")[0], 10);

            const fyStartDateStr = `${startYear}-04-01`;
            const fyEndDateStr = `${endYear + 1}-04-01`;

            let pdfOpeningBalance = 0;
            const pdfEntries: (CompanyLedgerEntry & { source?: "Purchase" | "Sale" })[] = [];

            for (const entry of allEntries) {
                const isOpeningBalance = entry.entryKind === "openingBalance";

                if (entry.date < fyStartDateStr || (isOpeningBalance && entry.date === fyStartDateStr)) {
                    pdfOpeningBalance += (Number(entry.debit || 0) - Number(entry.credit || 0));
                } else if (!isOpeningBalance && entry.date >= fyStartDateStr && entry.date < fyEndDateStr) {
                    pdfEntries.push(entry);
                }
            }

            let runningBalance = pdfOpeningBalance;
            const rows = pdfEntries.map(entry => {
                runningBalance += (Number(entry.debit || 0) - Number(entry.credit || 0));
                return { ...entry, runningBalance };
            });

            const pdfClosingBalance = runningBalance;

            const openingRow = `
                <tr>
                    <td>${escapeHtml(`01-04-${startYear}`)}</td>
                    <td colspan="5" style="font-weight: bold;">Opening Balance</td>
                    <td style="font-weight: bold;">${escapeHtml(formatCurrencyINR(Math.abs(pdfOpeningBalance)))} ${pdfOpeningBalance > 0 ? "Dr" : pdfOpeningBalance < 0 ? "Cr" : ""}</td>
                    <td></td>
                </tr>
            `;

            const closingRow = `
                <tr style="border-top: 2px solid #000;">
                    <td>${escapeHtml(`31-03-${endYear + 1}`)}</td>
                    <td colspan="5" style="font-weight: bold;">Closing Balance</td>
                    <td style="font-weight: bold;">${escapeHtml(formatCurrencyINR(Math.abs(pdfClosingBalance)))} ${pdfClosingBalance > 0 ? "Dr" : pdfClosingBalance < 0 ? "Cr" : ""}</td>
                    <td></td>
                </tr>
            `;

            const rowsHtml = openingRow + (rows.length > 0 ? rows.map((entry) => `
                <tr>
                    <td>${escapeHtml(entry.date || "-")}</td>
                    <td>${escapeHtml(getEntryTypeLabel(entry))}</td>
                    <td>${escapeHtml(entry.billNumber || "-")}</td>
                    <td>${escapeHtml(entry.gateway || "-")}</td>
                    <td>${escapeHtml(formatCurrencyINR(Number(entry.debit || 0)))}</td>
                    <td>${escapeHtml(formatCurrencyINR(Number(entry.credit || 0)))}</td>
                    <td>${escapeHtml(formatCurrencyINR(Math.abs(entry.runningBalance)))} ${entry.runningBalance > 0 ? "Dr" : entry.runningBalance < 0 ? "Cr" : ""}</td>
                    <td>${escapeHtml(entry.note || "-")}</td>
                </tr>
            `).join("") : `<tr><td colspan="8" style="text-align:center;">No entries in this period.</td></tr>`) + closingRow;

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
                                    <th>Balance</th>
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
                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                <select 
                                    value={selectedFY} 
                                    onChange={(e) => setSelectedFY(e.target.value)}
                                    className="input-field"
                                    style={{ width: "auto", padding: "8px 12px", height: "auto" }}
                                >
                                    {availableFYs.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
                                </select>
                                <button className="btn-secondary" onClick={() => openCompanyModal(selectedCompany)}><FileText size={16} style={{ marginRight: "8px" }} /> Edit</button>
                                <button className="btn-secondary" onClick={() => {
                                    setPrintFromFY(selectedFY);
                                    setPrintToFY(selectedFY);
                                    setShowPrintModal(true);
                                }}><FileText size={16} style={{ marginRight: "8px" }} /> Ledger PDF</button>
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

                        <div className="bill-section" style={{ padding: 0, overflow: "visible" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead style={{ borderBottom: "1px solid var(--border-color)" }}>
                                    <tr>
                                        {["Date", "Type", "Bill Number", "Mode", "Debit", "Credit", "Balance", "Remarks", "Actions"].map((label) => <th key={label} style={{ padding: "14px 16px", textAlign: "left", whiteSpace: "nowrap" }}>{label}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                                        <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>01-04-{selectedFY.split("-")[0]}</td>
                                        <td colSpan={5} style={{ padding: "14px 16px", fontWeight: "bold" }}>Opening Balance</td>
                                        <td style={{ padding: "14px 16px", fontWeight: "bold", whiteSpace: "nowrap" }}>
                                            {formatCurrencyINR(Math.abs(openingBalance))}
                                            {openingBalance > 0 ? " Dr" : openingBalance < 0 ? " Cr" : ""}
                                        </td>
                                        <td colSpan={2} style={{ padding: "14px 16px" }}></td>
                                    </tr>
                                    {ledgerRows.length === 0 ? (
                                        <tr><td colSpan={9} style={{ padding: "24px 16px", opacity: 0.7, textAlign: "center" }}>No entries in this financial year.</td></tr>
                                    ) : ledgerRows.map((entry, index) => (
                                        <tr key={entry.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>{entry.date}</td>
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
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
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                                                {entry.billImagePublicId || entry.billImageUrl ? (
                                                    <a className="inline-link" href={entry.billImagePublicId ? `/api/bills/file?publicId=${encodeURIComponent(entry.billImagePublicId)}&resourceType=${encodeURIComponent(entry.billImageResourceType || "image")}` : entry.billImageUrl} target="_blank" rel="noreferrer">
                                                        {entry.billNumber || "View Bill"}
                                                    </a>
                                                ) : (
                                                    entry.billNumber || "-"
                                                )}
                                            </td>
                                            <td style={{ padding: "14px 16px", textTransform: "capitalize", whiteSpace: "nowrap" }}>{entry.gateway || "-"}</td>
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>{formatCurrencyINR(entry.debit)}</td>
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>{formatCurrencyINR(entry.credit)}</td>
                                            <td style={{ padding: "14px 16px", fontWeight: 700, whiteSpace: "nowrap" }}>
                                                {formatCurrencyINR(Math.abs(entry.runningBalance))}
                                                {entry.runningBalance > 0 ? " Dr" : entry.runningBalance < 0 ? " Cr" : ""}
                                            </td>
                                            <td style={{ padding: "14px 16px", color: "var(--muted-text)" }} title={entry.note}>
                                                {entry.note ? <Info size={16} /> : "-"}
                                            </td>
                                            <td style={{ padding: "14px 16px", whiteSpace: "nowrap", position: "relative" }}>
                                                <button 
                                                    type="button" 
                                                    className="panel-icon-btn" 
                                                    onClick={() => setOpenMenuId(openMenuId === entry.id ? null : entry.id!)}
                                                >
                                                    <MoreVertical size={16} />
                                                </button>
                                                {openMenuId === entry.id && (
                                                    <div
                                                        ref={menuDropdownRef}
                                                        style={{
                                                            position: "absolute",
                                                            right: "16px",
                                                            top: "40px",
                                                            zIndex: 9999,
                                                            background: "var(--surface-color)",
                                                            border: "1px solid var(--border-color)",
                                                            borderRadius: "8px",
                                                            boxShadow: "var(--shadow-md)",
                                                            padding: "4px",
                                                            display: "grid",
                                                            gap: "2px",
                                                            minWidth: "120px"
                                                        }}
                                                    >
                                                        <button 
                                                            type="button" 
                                                            onClick={() => {
                                                                setOpenMenuId(null);
                                                                handleEditLedgerEntry(entry);
                                                            }}
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "8px",
                                                                padding: "8px 12px",
                                                                width: "100%",
                                                                textAlign: "left",
                                                                borderRadius: "6px",
                                                                fontSize: "13px",
                                                                cursor: "pointer",
                                                                background: "transparent",
                                                                border: "none",
                                                                color: "var(--text-color)"
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover-bg)"}
                                                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                                        >
                                                            <Pencil size={14} /> Edit
                                                        </button>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => {
                                                                setOpenMenuId(null);
                                                                handleDeleteLedgerEntry(entry);
                                                            }}
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "8px",
                                                                padding: "8px 12px",
                                                                width: "100%",
                                                                textAlign: "left",
                                                                borderRadius: "6px",
                                                                fontSize: "13px",
                                                                cursor: "pointer",
                                                                background: "transparent",
                                                                border: "none",
                                                                color: "#dc2626"
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.background = "#fee2e2"}
                                                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                                        >
                                                            <Trash2 size={14} /> Delete
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    <tr style={{ borderBottom: "none" }}>
                                        <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>31-03-{parseInt(selectedFY.split("-")[0], 10) + 1}</td>
                                        <td colSpan={5} style={{ padding: "14px 16px", fontWeight: "bold" }}>Closing Balance</td>
                                        <td style={{ padding: "14px 16px", fontWeight: "bold", whiteSpace: "nowrap" }}>
                                            {formatCurrencyINR(Math.abs(closingBalance))}
                                            {closingBalance > 0 ? " Dr" : closingBalance < 0 ? " Cr" : ""}
                                        </td>
                                        <td colSpan={2} style={{ padding: "14px 16px" }}></td>
                                    </tr>
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
                            {ledgerModalMode !== "openingBalance" && (
                                <select className="input-field" value={ledgerForm.gateway} onChange={(e) => setLedgerForm({ ...ledgerForm, gateway: e.target.value as LedgerGateway })}>
                                    <option value="upi">UPI</option>
                                    <option value="bank transfer">Bank Transfer</option>
                                    <option value="cash">Cash</option>
                                    <option value="cheque">Cheque</option>
                                </select>
                            )}
                            {ledgerModalMode === "openingBalance" && (
                                <select className="input-field" value={ledgerForm.financialYear} onChange={(e) => setLedgerForm({ ...ledgerForm, financialYear: e.target.value })}>
                                    {[0, 1, 2, 3, 4, 5].map(offset => {
                                        const baseYear = parseInt(getFinancialYearLabel().split("-")[0], 10) - offset;
                                        const fy = `${baseYear}-${String((baseYear + 1) % 100).padStart(2, "0")}`;
                                        return <option key={fy} value={fy}>FY {fy}</option>;
                                    })}
                                </select>
                            )}
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
                            {ledgerModalMode !== "openingBalance" && (
                                <>
                                    <input className="input-field" type="date" value={ledgerForm.date} onChange={(e) => setLedgerForm({ ...ledgerForm, date: e.target.value })} required />
                                    <input className="input-field" placeholder="Bank" value={ledgerForm.bank} onChange={(e) => setLedgerForm({ ...ledgerForm, bank: e.target.value })} />
                                    {ledgerForm.gateway === "cheque" && <input className="input-field" placeholder="Cheque Number" value={ledgerForm.chequeNumber} onChange={(e) => setLedgerForm({ ...ledgerForm, chequeNumber: e.target.value })} />}
                                    <textarea className="input-field" placeholder="Note" value={ledgerForm.note} onChange={(e) => setLedgerForm({ ...ledgerForm, note: e.target.value })} />
                                </>
                            )}
                            <button className="btn-primary">
                                {ledgerModalMode === "openingBalance" ? "Save Opening Balance" : ledgerModalMode === "edit" ? "Update Entry" : "Save Receipt"}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {showPrintModal && selectedCompany && (
                <div className="overlay-panel">
                    <div className="glass-panel" style={{ width: "100%", maxWidth: "400px", position: "relative" }}>
                        <button className="panel-close" onClick={() => setShowPrintModal(false)}>&times;</button>
                        <h2 style={{ marginBottom: "18px" }}>Print Ledger</h2>
                        <div style={{ display: "grid", gap: "14px" }}>
                            <div>
                                <label className="section-label">From Financial Year</label>
                                <select className="input-field" value={printFromFY} onChange={(e) => setPrintFromFY(e.target.value)}>
                                    {availableFYs.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="section-label">To Financial Year</label>
                                <select className="input-field" value={printToFY} onChange={(e) => setPrintToFY(e.target.value)}>
                                    {availableFYs.map(fy => <option key={fy} value={fy}>FY {fy}</option>)}
                                </select>
                            </div>
                            <button className="btn-primary" onClick={() => {
                                setShowPrintModal(false);
                                exportLedgerPdf(printFromFY, printToFY);
                            }}>
                                Print Ledger
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
