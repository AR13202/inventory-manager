"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useEffect, useMemo, useState } from "react";
import { subscribeToInventory } from "@/utils/firebaseHelpers/inventory";
import { subscribeToBills, BillItem } from "@/utils/firebaseHelpers/bills";
import { Company, CompanyLedgerEntry, subscribeToCompanies, subscribeToCompanyLedger } from "@/utils/firebaseHelpers/companies";
import { formatCurrencyINR, formatMonthYear } from "@/utils/formatters";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, FileText, Package, IndianRupee, AlertTriangle, ImagePlus, Building2 } from "lucide-react";
import { updateOrganizationProfile } from "@/utils/firebaseHelpers/orgs";

type HomeTab = "overview" | "outstanding";

export default function OrgHomePage() {
    const { user } = useAuth();
    const { activeOrg, refreshOrgs } = useOrg();
    const [inventoryItems, setInventoryItems] = useState<any[]>([]);
    const [bills, setBills] = useState<BillItem[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [purchaseLedgerByCompany, setPurchaseLedgerByCompany] = useState<Record<string, CompanyLedgerEntry[]>>({});
    const [salesLedgerByCompany, setSalesLedgerByCompany] = useState<Record<string, CompanyLedgerEntry[]>>({});
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<HomeTab>("overview");
    const [showProfileForm, setShowProfileForm] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileError, setProfileError] = useState("");
    const [profileForm, setProfileForm] = useState({
        name: "",
        address: "",
        gst: "",
        bankDetails: "",
        logoUrl: "",
        logoPublicId: "",
        logoResourceType: "image" as "image" | "raw" | "video"
    });

    useEffect(() => {
        if (!activeOrg || !user) return;

        const unsubscribeInventory = subscribeToInventory(activeOrg.orgId, (items) => {
            setInventoryItems(items);
            setLoading(false);
        });
        const unsubscribeBills = subscribeToBills(activeOrg.orgId, setBills);
        const unsubscribeCompanies = subscribeToCompanies(activeOrg.orgId, setCompanies);

        return () => {
            unsubscribeInventory();
            unsubscribeBills();
            unsubscribeCompanies();
        };
    }, [activeOrg, user]);

    useEffect(() => {
        if (!activeOrg || !companies.length) {
            setPurchaseLedgerByCompany({});
            setSalesLedgerByCompany({});
            return;
        }

        const unsubscribers = companies.flatMap((company) => {
            if (!company.id) return [];

            const unsubPurchase = subscribeToCompanyLedger(activeOrg.orgId, company.id, "purchaseLedger", (items) => {
                setPurchaseLedgerByCompany((current) => ({ ...current, [company.id as string]: items }));
            });
            const unsubSales = subscribeToCompanyLedger(activeOrg.orgId, company.id, "salesLedger", (items) => {
                setSalesLedgerByCompany((current) => ({ ...current, [company.id as string]: items }));
            });

            return [unsubPurchase, unsubSales];
        });

        return () => {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
        };
    }, [activeOrg, companies]);

    useEffect(() => {
        if (!activeOrg) return;
        setProfileForm({
            name: activeOrg.name || "",
            address: activeOrg.address || "",
            gst: activeOrg.gst || "",
            bankDetails: activeOrg.bankDetails || "",
            logoUrl: activeOrg.logoUrl || "",
            logoPublicId: activeOrg.logoPublicId || "",
            logoResourceType: activeOrg.logoResourceType || "image"
        });
    }, [activeOrg]);

    const dashboardData = useMemo(() => {
        const totalProducts = inventoryItems.length;
        const totalInventoryValue = inventoryItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
        const lowStockCount = inventoryItems.filter((item) => Number(item.quantity || 0) <= 10).length;

        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;

        const currentMonthSalesOnly = bills
            .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
            .filter((bill) => bill.billType === "Sale")
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const currentMonthPurchaseOnly = bills
            .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
            .filter((bill) => bill.billType === "Purchase")
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const currentMonthSales = currentMonthSalesOnly - currentMonthPurchaseOnly;

        const previousMonthSalesOnly = bills
            .filter((bill) => String(bill.date || "").startsWith(previousMonthKey))
            .filter((bill) => bill.billType === "Sale")
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const previousMonthPurchaseOnly = bills
            .filter((bill) => String(bill.date || "").startsWith(previousMonthKey))
            .filter((bill) => bill.billType === "Purchase")
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const previousMonthSales = previousMonthSalesOnly - previousMonthPurchaseOnly;
        const salesDelta = previousMonthSales === 0
            ? (currentMonthSales > 0 ? 100 : 0)
            : ((currentMonthSales - previousMonthSales) / previousMonthSales) * 100;

        const recentCompanies = Array.from(new Set(bills.slice(0, 3).map((bill) => bill.vendorName).filter(Boolean)));
        const ledgerOutstandingByCompany = companies.map((company) => {
            const purchaseLedger = company.id ? (purchaseLedgerByCompany[company.id] || []) : [];
            const salesLedger = company.id ? (salesLedgerByCompany[company.id] || []) : [];

            const purchaseOutstanding = Math.max(
                purchaseLedger.reduce((sum, entry) => sum + Number(entry.credit || 0) - Number(entry.debit || 0), 0),
                0
            );
            const salesOutstanding = Math.max(
                salesLedger.reduce((sum, entry) => sum + Number(entry.debit || 0) - Number(entry.credit || 0), 0),
                0
            );

            return {
                name: company.name || "Unknown Company",
                purchaseOutstanding,
                salesOutstanding
            };
        });

        const totalReceivables = ledgerOutstandingByCompany.reduce((sum, company) => sum + company.salesOutstanding, 0);
        const totalPayables = ledgerOutstandingByCompany.reduce((sum, company) => sum + company.purchaseOutstanding, 0);

        const topReceivableCompanies = ledgerOutstandingByCompany
            .filter((company) => company.salesOutstanding > 0)
            .sort((a, b) => b.salesOutstanding - a.salesOutstanding)
            .slice(0, 5)
            .map((company) => ({ name: company.name, amount: company.salesOutstanding }));

        const topPayableCompanies = ledgerOutstandingByCompany
            .filter((company) => company.purchaseOutstanding > 0)
            .sort((a, b) => b.purchaseOutstanding - a.purchaseOutstanding)
            .slice(0, 5)
            .map((company) => ({ name: company.name, amount: company.purchaseOutstanding }));

        return {
            totalProducts,
            totalInventoryValue,
            lowStockCount,
            currentMonthSales,
            currentMonthSalesOnly,
            currentMonthPurchaseOnly,
            salesDelta,
            recentCompanies,
            totalReceivables,
            totalPayables,
            topReceivableCompanies,
            topPayableCompanies
        };
    }, [inventoryItems, bills, companies, purchaseLedgerByCompany, salesLedgerByCompany]);

    if (!activeOrg || !user) return <p>Loading dashboard...</p>;

    const saveProfile = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!activeOrg) return;
        setSavingProfile(true);
        setProfileError("");

        try {
            const result = await updateOrganizationProfile(activeOrg.orgId, profileForm);
            if (result.error) throw new Error(result.error);
            await refreshOrgs();
            setShowProfileForm(false);
        } catch (error: any) {
            setProfileError(error.message || "Failed to update organization profile.");
        } finally {
            setSavingProfile(false);
        }
    };

    const uploadLogo = async (file: File) => {
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Failed to read logo file."));
            reader.readAsDataURL(file);
        });

        const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                file: dataUrl,
                fileName: file.name,
                mimeType: file.type
            })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || "Failed to upload logo.");
        }

        setProfileForm((current) => ({
            ...current,
            logoUrl: data.url,
            logoPublicId: data.publicId,
            logoResourceType: data.resourceType || "image"
        }));
    };

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                    {activeOrg.logoPublicId && (
                        <img
                            src={`/api/bills/file?publicId=${encodeURIComponent(activeOrg.logoPublicId)}&resourceType=${encodeURIComponent(activeOrg.logoResourceType || "image")}`}
                            alt={`${activeOrg.name} logo`}
                            style={{ width: "62px", height: "62px", objectFit: "cover", borderRadius: "16px" }}
                        />
                    )}
                    <div>
                    <p className="section-kicker">Organization Home</p>
                    <h1 className="dashboard-title">{activeOrg.name}</h1>
                    <p className="dashboard-subtitle">Overview for {formatMonthYear(new Date())}</p>
                    </div>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                    <button type="button" className="btn-secondary" onClick={() => setShowProfileForm((current) => !current)}>
                        <Building2 size={18} style={{ marginRight: "8px" }} /> Org Details
                    </button>
                    <Link href={`/org/${activeOrg.orgId}/bills?mode=new`} className="btn-primary">
                        <FileText size={18} style={{ marginRight: "8px" }} /> Add Bill
                    </Link>
                </div>
            </header>

            {showProfileForm && (
                <section className="glass-panel" style={{ marginBottom: "24px" }}>
                    <div className="section-header-row" style={{ marginBottom: "16px" }}>
                        <div>
                            <p className="section-kicker">Organization Profile</p>
                            <h2 className="section-title">Logo and business details</h2>
                        </div>
                    </div>
                    {profileError && <div className="error-banner" style={{ marginBottom: "14px" }}>{profileError}</div>}
                    <form onSubmit={saveProfile} style={{ display: "grid", gap: "16px" }}>
                        <div className="form-grid-2">
                            <div>
                                <label className="section-label">Organization Name</label>
                                <input className="input-field" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="section-label">GST</label>
                                <input className="input-field" value={profileForm.gst} onChange={(e) => setProfileForm({ ...profileForm, gst: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-grid-2">
                            <div>
                                <label className="section-label">Address</label>
                                <input className="input-field" value={profileForm.address} onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })} />
                            </div>
                            <div>
                                <label className="section-label">Bank Details</label>
                                <input className="input-field" value={profileForm.bankDetails} onChange={(e) => setProfileForm({ ...profileForm, bankDetails: e.target.value })} placeholder="Account / IFSC / Branch" />
                            </div>
                        </div>
                        <div className="form-grid-2">
                            <div>
                                <label className="section-label">Organization Logo</label>
                                <div className="solid-upload-box">
                                    {profileForm.logoPublicId ? (
                                        <img
                                            src={`/api/bills/file?publicId=${encodeURIComponent(profileForm.logoPublicId)}&resourceType=${encodeURIComponent(profileForm.logoResourceType || "image")}`}
                                            alt="Organization logo"
                                            style={{ width: "72px", height: "72px", objectFit: "cover", borderRadius: "14px" }}
                                        />
                                    ) : (
                                        <ImagePlus size={22} />
                                    )}
                                    <label className="btn-secondary" style={{ marginTop: "10px" }}>
                                        Upload Logo
                                        <input
                                            type="file"
                                            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                                            style={{ display: "none" }}
                                            onChange={async (event) => {
                                                const file = event.target.files?.[0];
                                                if (!file) return;
                                                try {
                                                    await uploadLogo(file);
                                                } catch (error: any) {
                                                    setProfileError(error.message || "Failed to upload logo.");
                                                } finally {
                                                    event.target.value = "";
                                                }
                                            }}
                                        />
                                    </label>
                                </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
                                <button className="btn-primary" disabled={savingProfile}>
                                    {savingProfile ? "Saving..." : "Save Organization"}
                                </button>
                            </div>
                        </div>
                    </form>
                </section>
            )}

            <div className="company-tabs" style={{ marginBottom: "24px" }}>
                <button className={`company-tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>Overview</button>
                <button className={`company-tab ${activeTab === "outstanding" ? "active" : ""}`} onClick={() => setActiveTab("outstanding")}>Outstanding Payments</button>
            </div>

            {activeTab === "overview" ? (
                <>
            <div className="grid-dashboard" style={{ marginTop: "8px", marginBottom: "24px" }}>
                <div className="glass-panel stat-card">
                    <span className="stat-title">Total Products</span>
                    <span className="stat-value">{dashboardData.totalProducts}</span>
                    <div className="stat-foot"><Package size={16} /> Active inventory records</div>
                </div>
                <div className="glass-panel stat-card">
                    <span className="stat-title">Inventory Value</span>
                    <span className="stat-value" style={{ fontSize: "2rem" }}>{formatCurrencyINR(dashboardData.totalInventoryValue)}</span>
                    <div className="stat-foot"><IndianRupee size={16} /> All values shown in INR</div>
                </div>
                <div className="glass-panel stat-card">
                    <span className="stat-title">Low / Out of Stock</span>
                    <span className="stat-value">{dashboardData.lowStockCount}</span>
                    <div className="stat-foot"><AlertTriangle size={16} /> Items needing attention</div>
                </div>
            </div>

            <div className="org-home-grid">
                <section className="glass-panel">
                    <div className="section-header-row">
                        <div>
                            <p className="section-kicker">Recent Activity</p>
                            <h2 className="section-title">Recent Bills</h2>
                        </div>
                        <Link href={`/org/${activeOrg.orgId}/bills`} className="inline-link">Open bills</Link>
                    </div>
                    {loading ? (
                        <p>Loading recent bills...</p>
                    ) : dashboardData.recentCompanies.length === 0 ? (
                        <p style={{ opacity: 0.7 }}>No bills yet. Add the first bill to start tracking sales and purchase activity.</p>
                    ) : (
                        <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
                            {dashboardData.recentCompanies.map((name, index) => (
                                <div key={`${name}-${index}`} className="list-row-card">
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{name}</div>
                                        <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>Recent company in bill activity</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="glass-panel">
                    <div className="section-header-row">
                        <div>
                            <p className="section-kicker">Profit</p>
                            <h2 className="section-title">Current Month Profit</h2>
                        </div>
                    </div>
                        <div style={{ marginTop: "16px" }}>
                            <div style={{ fontSize: "2.2rem", fontWeight: 700 }}>{formatCurrencyINR(dashboardData.currentMonthSales)}</div>
                            <div className="trend-row" style={{ color: dashboardData.salesDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                                {dashboardData.salesDelta >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                                <span>{Math.abs(dashboardData.salesDelta).toFixed(1)}% {dashboardData.salesDelta >= 0 ? "increase" : "decrease"} from last month</span>
                            </div>
                            <div style={{ marginTop: "12px", fontSize: "0.88rem", opacity: 0.78 }}>
                                Sales: {formatCurrencyINR(dashboardData.currentMonthSalesOnly)}
                            </div>
                            <div style={{ fontSize: "0.88rem", opacity: 0.78 }}>
                                Purchase: {formatCurrencyINR(dashboardData.currentMonthPurchaseOnly)}
                            </div>
                        </div>
                    </section>
                </div>
                </>
            ) : (
                <div style={{ display: "grid", gap: "24px" }}>
                    <div className="grid-dashboard" style={{ marginTop: "8px", marginBottom: "0" }}>
                        <div className="glass-panel stat-card">
                            <span className="stat-title">Sales Payments Pending</span>
                            <span className="stat-value" style={{ fontSize: "2rem" }}>{formatCurrencyINR(dashboardData.totalReceivables)}</span>
                            <div className="stat-foot"><IndianRupee size={16} /> Amount customers still need to pay</div>
                        </div>
                        <div className="glass-panel stat-card">
                            <span className="stat-title">Purchase Payments Pending</span>
                            <span className="stat-value" style={{ fontSize: "2rem" }}>{formatCurrencyINR(dashboardData.totalPayables)}</span>
                            <div className="stat-foot"><IndianRupee size={16} /> Amount you still need to pay suppliers</div>
                        </div>
                    </div>

                    <div className="org-home-grid">
                        <section className="glass-panel">
                            <div className="section-header-row">
                                <div>
                                    <p className="section-kicker">Receivables</p>
                                    <h2 className="section-title">Top 5 Sales Companies</h2>
                                </div>
                                <Link href={`/org/${activeOrg.orgId}/bills`} className="inline-link">Open bills</Link>
                            </div>
                            {loading ? (
                                <p>Loading outstanding sales...</p>
                            ) : dashboardData.topReceivableCompanies.length === 0 ? (
                                <p style={{ opacity: 0.7 }}>No pending sales payments right now.</p>
                            ) : (
                                <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
                                    {dashboardData.topReceivableCompanies.map((company, index) => (
                                        <div key={`${company.name}-${index}`} className="list-row-card">
                                            <div>
                                                <div style={{ fontWeight: 700 }}>{company.name}</div>
                                                <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>Pending payment against sales bills</div>
                                            </div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrencyINR(company.amount)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="glass-panel">
                            <div className="section-header-row">
                                <div>
                                    <p className="section-kicker">Payables</p>
                                    <h2 className="section-title">Top 5 Purchase Companies</h2>
                                </div>
                            </div>
                            {loading ? (
                                <p>Loading outstanding purchases...</p>
                            ) : dashboardData.topPayableCompanies.length === 0 ? (
                                <p style={{ opacity: 0.7 }}>No pending purchase payments right now.</p>
                            ) : (
                                <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
                                    {dashboardData.topPayableCompanies.map((company, index) => (
                                        <div key={`${company.name}-${index}`} className="list-row-card">
                                            <div>
                                                <div style={{ fontWeight: 700 }}>{company.name}</div>
                                                <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>Pending payment against purchase bills</div>
                                            </div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrencyINR(company.amount)}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
}
