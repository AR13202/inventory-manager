"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useEffect, useMemo, useState } from "react";
import { subscribeToInventory } from "@/utils/firebaseHelpers/inventory";
import { subscribeToBills, BillItem } from "@/utils/firebaseHelpers/bills";
import { formatCurrencyINR, formatMonthYear } from "@/utils/formatters";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, FileText, Package, IndianRupee, AlertTriangle } from "lucide-react";

export default function OrgHomePage() {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const [inventoryItems, setInventoryItems] = useState<any[]>([]);
    const [bills, setBills] = useState<BillItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!activeOrg || !user) return;

        const unsubscribeInventory = subscribeToInventory(activeOrg.orgId, (items) => {
            setInventoryItems(items);
            setLoading(false);
        });
        const unsubscribeBills = subscribeToBills(activeOrg.orgId, setBills);

        return () => {
            unsubscribeInventory();
            unsubscribeBills();
        };
    }, [activeOrg, user]);

    const dashboardData = useMemo(() => {
        const totalProducts = inventoryItems.length;
        const totalInventoryValue = inventoryItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
        const lowStockCount = inventoryItems.filter((item) => Number(item.quantity || 0) <= 10).length;

        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const previousMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;

        const salesBills = bills.filter((bill) => bill.billType === "Sale");
        const currentMonthSales = salesBills
            .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const previousMonthSales = salesBills
            .filter((bill) => String(bill.date || "").startsWith(previousMonthKey))
            .reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
        const salesDelta = previousMonthSales === 0
            ? (currentMonthSales > 0 ? 100 : 0)
            : ((currentMonthSales - previousMonthSales) / previousMonthSales) * 100;

        const recentCompanies = Array.from(new Set(bills.slice(0, 8).map((bill) => bill.vendorName).filter(Boolean)));

        return {
            totalProducts,
            totalInventoryValue,
            lowStockCount,
            currentMonthSales,
            salesDelta,
            recentCompanies
        };
    }, [inventoryItems, bills]);

    if (!activeOrg || !user) return <p>Loading dashboard...</p>;

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0, alignItems: "flex-start" }}>
                <div>
                    <p className="section-kicker">Organization Home</p>
                    <h1 className="dashboard-title">{activeOrg.name}</h1>
                    <p className="dashboard-subtitle">Overview for {formatMonthYear(new Date())}</p>
                </div>
                <div style={{ display: "flex", gap: "12px" }}>
                    <Link href={`/org/${activeOrg.orgId}/bills?mode=new`} className="btn-primary">
                        <FileText size={18} style={{ marginRight: "8px" }} /> Add Bill
                    </Link>
                </div>
            </header>

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
                            <p className="section-kicker">Sales</p>
                            <h2 className="section-title">Current Month Sales</h2>
                        </div>
                    </div>
                    <div style={{ marginTop: "16px" }}>
                        <div style={{ fontSize: "2.2rem", fontWeight: 700 }}>{formatCurrencyINR(dashboardData.currentMonthSales)}</div>
                        <div className="trend-row" style={{ color: dashboardData.salesDelta >= 0 ? "#16a34a" : "#dc2626" }}>
                            {dashboardData.salesDelta >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                            <span>{Math.abs(dashboardData.salesDelta).toFixed(1)}% {dashboardData.salesDelta >= 0 ? "increase" : "decrease"} from last month</span>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
