"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useEffect, useMemo, useState } from "react";
import {
  InventoryItem,
  subscribeToInventory,
} from "@/utils/firebaseHelpers/inventory";
import { subscribeToBills, BillItem } from "@/utils/firebaseHelpers/bills";
import {
  Company,
  CompanyLedgerEntry,
  subscribeToCompanies,
  subscribeToCompanyLedger,
} from "@/utils/firebaseHelpers/companies";
import { formatCurrencyINR, formatMonthYear } from "@/utils/formatters";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownRight,
  FileText,
  Package,
  IndianRupee,
  AlertTriangle,
  ImagePlus,
  Building2,
} from "lucide-react";
import { updateOrganizationProfile } from "@/utils/firebaseHelpers/orgs";
import { escapeHtml, openPrintWindow } from "@/utils/print";

type HomeTab = "overview" | "outstanding";
type RevenueRange = "3m" | "6m" | "12m";
type RevenueCompanyFilter = "all" | string;
type MonthlyRevenuePoint = {
  monthKey: string;
  monthLabel: string;
  sales: number;
  purchase: number;
  profit: number;
};

const parseAmount = (value: unknown) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const parseBillDate = (value: string | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const buildMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split("-");
  const monthDate = new Date(Number(year), Number(month) - 1, 1);
  return monthDate.toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
};

const getRangeCount = (range: RevenueRange) =>
  range === "3m" ? 3 : range === "6m" ? 6 : 12;

const getMonthKeysForRange = (range: RevenueRange) => {
  const count = getRangeCount(range);
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth() - (count - index - 1),
      1,
    );
    return buildMonthKey(date);
  });
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

function MonthlySummaryTable({
  salesData,
  purchaseData,
  profitData,
}: {
  salesData: Array<{ label: string; value: number }>;
  purchaseData: Array<{ label: string; value: number }>;
  profitData: Array<{ label: string; value: number }>;
}) {
  const rowCount = Math.max(
    salesData.length,
    purchaseData.length,
    profitData.length,
  );

  if (!rowCount) {
    return (
      <p style={{ opacity: 0.7 }}>No monthly data available for this filter.</p>
    );
  }

  return (
    <div className="outstanding-table-wrap">
      <table
        style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}
      >
        <thead>
          <tr
            style={{
              textAlign: "left",
              borderBottom: "1px solid rgba(148, 163, 184, 0.25)",
            }}
          >
            <th style={{ padding: "12px 10px" }}>Month</th>
            <th style={{ padding: "12px 10px" }}>Sales Amount</th>
            <th style={{ padding: "12px 10px" }}>Purchase Amount</th>
            <th style={{ padding: "12px 10px" }}>Profit Amount</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, index) => {
            const sales = salesData[index];
            const purchase = purchaseData[index];
            const profit = profitData[index];
            const monthLabel =
              sales?.label || purchase?.label || profit?.label || "-";

            return (
              <tr
                key={`${monthLabel}-${index}`}
                style={{ borderBottom: "1px solid rgba(148, 163, 184, 0.16)" }}
              >
                <td style={{ padding: "12px 10px", fontWeight: 600 }}>
                  {monthLabel}
                </td>
                <td style={{ padding: "12px 10px" }}>
                  {formatCurrencyINR(sales?.value || 0)}
                </td>
                <td style={{ padding: "12px 10px" }}>
                  {formatCurrencyINR(purchase?.value || 0)}
                </td>
                <td
                  style={{
                    padding: "12px 10px",
                    color: (profit?.value || 0) >= 0 ? "inherit" : "#dc2626",
                    fontWeight: 600,
                  }}
                >
                  {formatCurrencyINR(profit?.value || 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OrgHomePage() {
  const { user } = useAuth();
  const { activeOrg, refreshOrgs } = useOrg();
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [bills, setBills] = useState<BillItem[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [purchaseLedgerByCompany, setPurchaseLedgerByCompany] = useState<
    Record<string, CompanyLedgerEntry[]>
  >({});
  const [salesLedgerByCompany, setSalesLedgerByCompany] = useState<
    Record<string, CompanyLedgerEntry[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<HomeTab>("overview");
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("3m");
  const [reportMonth, setReportMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [selectedRevenueCompany, setSelectedRevenueCompany] =
    useState<RevenueCompanyFilter>("all");
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileForm, setProfileForm] = useState({
    name: "",
    address: "",
    gst: "",
    bankDetails: "",
    logoUrl: "",
    logoPublicId: "",
    logoResourceType: "image" as "image" | "raw" | "video",
  });

  useEffect(() => {
    if (!activeOrg || !user) return;

    const unsubscribeInventory = subscribeToInventory(
      activeOrg.orgId,
      (items) => {
        setInventoryItems(items);
        setLoading(false);
      },
    );
    const unsubscribeBills = subscribeToBills(activeOrg.orgId, setBills);
    const unsubscribeCompanies = subscribeToCompanies(
      activeOrg.orgId,
      setCompanies,
    );

    return () => {
      unsubscribeInventory();
      unsubscribeBills();
      unsubscribeCompanies();
    };
  }, [activeOrg, user]);

  useEffect(() => {
    // Subscribing to all ledgers for all companies causes severe performance
    // issues and data race conditions on render. We now rely on the pre-computed
    // `company.balance` instead of fetching full ledgers for dashboard summaries.
    setPurchaseLedgerByCompany({});
    setSalesLedgerByCompany({});
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
      logoResourceType: activeOrg.logoResourceType || "image",
    });
  }, [activeOrg]);

  const dashboardData = useMemo(() => {
    const totalProducts = inventoryItems.length;
    const totalInventoryValue = inventoryItems.reduce(
      (sum, item) => sum + parseAmount(item.price) * parseAmount(item.quantity),
      0,
    );
    const lowStockCount = inventoryItems.filter(
      (item) => Number(item.quantity || 0) <= 10,
    ).length;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const previousMonthDate = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );
    const previousMonthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;

    const currentMonthSalesOnly = bills
      .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
      .filter((bill) => bill.billType === "Sale")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const currentMonthPurchaseOnly = bills
      .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
      .filter((bill) => bill.billType === "Purchase")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const currentMonthSales = currentMonthSalesOnly - currentMonthPurchaseOnly;

    const previousMonthSalesOnly = bills
      .filter((bill) => String(bill.date || "").startsWith(previousMonthKey))
      .filter((bill) => bill.billType === "Sale")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const previousMonthPurchaseOnly = bills
      .filter((bill) => String(bill.date || "").startsWith(previousMonthKey))
      .filter((bill) => bill.billType === "Purchase")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const previousMonthSales =
      previousMonthSalesOnly - previousMonthPurchaseOnly;
    const salesDelta =
      previousMonthSales === 0
        ? currentMonthSales > 0
          ? 100
          : 0
        : ((currentMonthSales - previousMonthSales) / previousMonthSales) * 100;

    const recentCompanies = Array.from(
      new Set(
        bills
          .slice(0, 3)
          .map((bill) => bill.vendorName)
          .filter(Boolean),
      ),
    );
    const ledgerOutstandingByCompany = companies.map((company) => {
      const balance = parseAmount(company.balance);

      return {
        name: company.name || "Unknown Company",
        purchaseOutstanding: balance < 0 ? Math.abs(balance) : 0,
        salesOutstanding: balance > 0 ? balance : 0,
        gst: company.gst || "",
        phoneNumbers: company.phoneNumbers || "",
        address: company.address || "",
      };
    });

    const totalReceivables = ledgerOutstandingByCompany.reduce(
      (sum, company) => sum + company.salesOutstanding,
      0,
    );
    const totalPayables = ledgerOutstandingByCompany.reduce(
      (sum, company) => sum + company.purchaseOutstanding,
      0,
    );

    const topReceivableCompanies = ledgerOutstandingByCompany
      .filter((company) => company.salesOutstanding > 0)
      .sort((a, b) => b.salesOutstanding - a.salesOutstanding)
      .slice(0, 5)
      .map((company) => ({
        name: company.name,
        amount: company.salesOutstanding,
      }));

    const topPayableCompanies = ledgerOutstandingByCompany
      .filter((company) => company.purchaseOutstanding > 0)
      .sort((a, b) => b.purchaseOutstanding - a.purchaseOutstanding)
      .slice(0, 5)
      .map((company) => ({
        name: company.name,
        amount: company.purchaseOutstanding,
      }));

    return {
      ledgerOutstandingByCompany,
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
      topPayableCompanies,
    };
  }, [
    inventoryItems,
    bills,
    companies,
    purchaseLedgerByCompany,
    salesLedgerByCompany,
  ]);

  const monthlyReportData = useMemo(() => {
    const [yearText, monthText] = reportMonth.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const daysInMonth =
      Number.isFinite(year) && Number.isFinite(monthIndex)
        ? new Date(year, monthIndex + 1, 0).getDate()
        : 0;

    const monthBills = bills.filter((bill) =>
      String(bill.date || "").startsWith(reportMonth),
    );

    const salesTotal = monthBills
      .filter((bill) => bill.billType === "Sale")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const purchaseTotal = monthBills
      .filter((bill) => bill.billType === "Purchase")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
    const salesTax = monthBills
      .filter((bill) => bill.billType === "Sale")
      .reduce((sum, bill) => sum + parseAmount(bill.taxAmount), 0);
    const purchaseTax = monthBills
      .filter((bill) => bill.billType === "Purchase")
      .reduce((sum, bill) => sum + parseAmount(bill.taxAmount), 0);

    const dailyRows = Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(year, monthIndex, index + 1);
      const dayKey = `${reportMonth}-${String(index + 1).padStart(2, "0")}`;
      const daySales = monthBills
        .filter((bill) => bill.billType === "Sale" && String(bill.date || "").startsWith(dayKey))
        .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);
      const dayPurchase = monthBills
        .filter((bill) => bill.billType === "Purchase" && String(bill.date || "").startsWith(dayKey))
        .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);

      return {
        label: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        sales: daySales,
        purchase: dayPurchase,
      };
    });

    return {
      monthLabel:
        Number.isFinite(year) && Number.isFinite(monthIndex)
          ? new Date(year, monthIndex, 1).toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          })
          : reportMonth,
      salesTotal,
      purchaseTotal,
      profitTotal: salesTotal - purchaseTotal,
      salesTax,
      salesTax,
      purchaseTax,
      dailyRows,
    };
  }, [bills, reportMonth]);

  const companyOptions = useMemo(() => {
    return companies
      .filter((company) => company.id)
      .map((company) => ({
        id: company.id as string,
        name: company.name || "Unknown Company",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [companies]);

  const revenueInsights = useMemo(() => {
    const rangeMonthKeys = getMonthKeysForRange(revenueRange);
    const rangeMonthKeySet = new Set(rangeMonthKeys);
    const monthlyTemplate = rangeMonthKeys.map((monthKey) => ({
      monthKey,
      monthLabel: buildMonthLabel(monthKey),
      sales: 0,
      purchase: 0,
      profit: 0,
    }));

    const filteredBills = bills.filter((bill) =>
      selectedRevenueCompany === "all"
        ? true
        : bill.companyId === selectedRevenueCompany,
    );

    const salesPurchaseMonthMap = new Map<string, MonthlyRevenuePoint>(
      monthlyTemplate.map((point) => [point.monthKey, point]),
    );
    const profitMonthMap = new Map<string, MonthlyRevenuePoint>(
      monthlyTemplate.map((point) => [point.monthKey, { ...point }]),
    );

    filteredBills.forEach((bill) => {
      const billDate = parseBillDate(bill.date);
      if (!billDate) return;

      const monthKey = buildMonthKey(billDate);
      if (!rangeMonthKeySet.has(monthKey)) return;

      const current = salesPurchaseMonthMap.get(monthKey);
      if (!current) return;

      const amount = parseAmount(bill.amount);
      if (bill.billType === "Sale") {
        current.sales += amount;
      } else {
        current.purchase += amount;
      }
      current.profit = current.sales - current.purchase;
    });

    bills.forEach((bill) => {
      const billDate = parseBillDate(bill.date);
      if (!billDate) return;

      const monthKey = buildMonthKey(billDate);
      if (!rangeMonthKeySet.has(monthKey)) return;

      const current = profitMonthMap.get(monthKey);
      if (!current) return;

      const amount = parseAmount(bill.amount);
      if (bill.billType === "Sale") {
        current.sales += amount;
      } else {
        current.purchase += amount;
      }
      current.profit = current.sales - current.purchase;
    });

    const totals = bills.reduce(
      (acc, bill) => {
        const amount = parseAmount(bill.amount);
        if (bill.billType === "Sale") {
          acc.sales += amount;
        } else {
          acc.purchase += amount;
        }
        return acc;
      },
      { sales: 0, purchase: 0 },
    );

    const salesMonthly = Array.from(salesPurchaseMonthMap.values());
    const purchaseMonthly = Array.from(salesPurchaseMonthMap.values()).map(
      (point) => ({ ...point }),
    );
    const profitMonthly = Array.from(profitMonthMap.values());

    return {
      salesChart: salesMonthly.map((point) => ({
        label: point.monthLabel,
        value: point.sales,
      })),
      purchaseChart: purchaseMonthly.map((point) => ({
        label: point.monthLabel,
        value: point.purchase,
      })),
      profitChart: profitMonthly.map((point) => ({
        label: point.monthLabel,
        value: point.profit,
      })),
      totals: {
        ...totals,
        profit: totals.sales - totals.purchase,
      },
      selectedCompanyName:
        selectedRevenueCompany === "all"
          ? "All companies"
          : companyOptions.find(
            (company) => company.id === selectedRevenueCompany,
          )?.name || "Selected company",
    };
  }, [bills, revenueRange, selectedRevenueCompany, companyOptions]);

  if (!activeOrg || !user) return <p>Loading dashboard...</p>;

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeOrg) return;
    setSavingProfile(true);
    setProfileError("");

    try {
      const result = await updateOrganizationProfile(
        activeOrg.orgId,
        profileForm,
      );
      if (result.error) throw new Error(result.error);
      await refreshOrgs();
      setShowProfileForm(false);
    } catch (error: unknown) {
      setProfileError(
        getErrorMessage(error, "Failed to update organization profile."),
      );
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
        mimeType: file.type,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to upload logo.");
    }

    setProfileForm((current) => ({
      ...current,
      logoUrl: data.url,
      logoPublicId: data.publicId,
      logoResourceType: data.resourceType || "image",
    }));
  };

  const exportMonthlyReportPdf = () => {
    const summaryCards = [
      ["Sales", monthlyReportData.salesTotal],
      ["Purchase", monthlyReportData.purchaseTotal],
      ["Profit", monthlyReportData.profitTotal],
      ["Sales Tax", monthlyReportData.salesTax],
      ["Purchase Tax", monthlyReportData.purchaseTax],
    ]
      .map(
        ([label, value]) => `
          <div class="card">
            <div class="label">${escapeHtml(String(label))}</div>
            <div class="value">${escapeHtml(formatCurrencyINR(Number(value)))}</div>
          </div>
        `,
      )
      .join("");

    const dailyRows = monthlyReportData.dailyRows
      .filter((row) => row.sales > 0 || row.purchase > 0)
      .map(
        (row) => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(formatCurrencyINR(row.sales))}</td>
            <td>${escapeHtml(formatCurrencyINR(row.purchase))}</td>
          </tr>
        `,
      )
      .join("");

    openPrintWindow(
      `${activeOrg.name} Monthly Report ${monthlyReportData.monthLabel}`,
      `
        <h1>${escapeHtml(activeOrg.name)} Monthly Report</h1>
        <p class="meta">${escapeHtml(monthlyReportData.monthLabel)} • Generated on ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
        <div class="grid">${summaryCards}</div>
        <div class="section">
          <h2>Day-to-Day Sales and Purchase</h2>
          <table>
            <thead><tr><th>Date</th><th>Sales</th><th>Purchase</th></tr></thead>
            <tbody>${dailyRows || '<tr><td colspan="3">No daily records for this month.</td></tr>'}</tbody>
          </table>
        </div>
      `,
    );

    setShowReportModal(false);
  };

  const exportPendingSalesPdf = () => {
    const rows = dashboardData.ledgerOutstandingByCompany
      .slice()
      .sort((a, b) => b.salesOutstanding - a.salesOutstanding)
      .map(
        (company) => `
          <tr>
            <td>
              <strong>${escapeHtml(company.name)}</strong>
              ${company.gst ? `<br/><span style="font-size: 0.8em; color: #666;">GST: ${escapeHtml(company.gst)}</span>` : ""}
              ${company.phoneNumbers ? `<br/><span style="font-size: 0.8em; color: #666;">Phone: ${escapeHtml(company.phoneNumbers)}</span>` : ""}
              ${company.address ? `<br/><span style="font-size: 0.8em; color: #666;">Address: ${escapeHtml(company.address)}</span>` : ""}
            </td>
            <td style="text-align: right; vertical-align: top;">${escapeHtml(formatCurrencyINR(company.salesOutstanding))}</td>
          </tr>
        `
      )
      .join("");

    openPrintWindow(
      `${activeOrg.name} Pending Sales Report`,
      `
        <h1>${escapeHtml(activeOrg.name)} Pending Sales Report</h1>
        <p class="meta">Generated on ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
        <div class="section">
          <table>
            <thead><tr><th>Company Details</th><th style="text-align: right;">Pending Sales Amount</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="2">No data.</td></tr>'}</tbody>
            <tfoot>
              <tr>
                <td style="font-weight: bold; text-align: right;">Total Pending Sales:</td>
                <td style="font-weight: bold; text-align: right;">${escapeHtml(formatCurrencyINR(dashboardData.totalReceivables))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `,
    );
  };

  const exportPendingPurchasePdf = () => {
    const rows = dashboardData.ledgerOutstandingByCompany
      .slice()
      .sort((a, b) => b.purchaseOutstanding - a.purchaseOutstanding)
      .map(
        (company) => `
          <tr>
            <td>
              <strong>${escapeHtml(company.name)}</strong>
              ${company.gst ? `<br/><span style="font-size: 0.8em; color: #666;">GST: ${escapeHtml(company.gst)}</span>` : ""}
              ${company.phoneNumbers ? `<br/><span style="font-size: 0.8em; color: #666;">Phone: ${escapeHtml(company.phoneNumbers)}</span>` : ""}
              ${company.address ? `<br/><span style="font-size: 0.8em; color: #666;">Address: ${escapeHtml(company.address)}</span>` : ""}
            </td>
            <td style="text-align: right; vertical-align: top;">${escapeHtml(formatCurrencyINR(company.purchaseOutstanding))}</td>
          </tr>
        `
      )
      .join("");

    openPrintWindow(
      `${activeOrg.name} Pending Purchase Report`,
      `
        <h1>${escapeHtml(activeOrg.name)} Pending Purchase Report</h1>
        <p class="meta">Generated on ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
        <div class="section">
          <table>
            <thead><tr><th>Company Details</th><th style="text-align: right;">Pending Purchase Amount</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="2">No data.</td></tr>'}</tbody>
            <tfoot>
              <tr>
                <td style="font-weight: bold; text-align: right;">Total Pending Purchase:</td>
                <td style="font-weight: bold; text-align: right;">${escapeHtml(formatCurrencyINR(dashboardData.totalPayables))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      `,
    );
  };

  return (
    <div>
      <header
        className="dashboard-header flex-between"
        style={{ marginTop: 0, alignItems: "flex-start" }}
      >
        <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
          {activeOrg.logoPublicId && (
            <img
              src={`/api/bills/file?publicId=${encodeURIComponent(activeOrg.logoPublicId)}&resourceType=${encodeURIComponent(activeOrg.logoResourceType || "image")}`}
              alt={`${activeOrg.name} logo`}
              style={{
                width: "62px",
                height: "62px",
                objectFit: "cover",
                borderRadius: "16px",
              }}
            />
          )}
          <div>
            <p className="section-kicker">Organization Home</p>
            <h1 className="dashboard-title">{activeOrg.name}</h1>
            <p className="dashboard-subtitle">
              Overview for {formatMonthYear(new Date())}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowProfileForm((current) => !current)}
          >
            <Building2 size={18} style={{ marginRight: "8px" }} /> Org Details
          </button>
          <Link
            href={`/org/${activeOrg.orgId}/bills?mode=new`}
            className="btn-primary"
          >
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
          {profileError && (
            <div className="error-banner" style={{ marginBottom: "14px" }}>
              {profileError}
            </div>
          )}
          <form onSubmit={saveProfile} style={{ display: "grid", gap: "16px" }}>
            <div className="form-grid-2">
              <div>
                <label className="section-label">Organization Name</label>
                <input
                  className="input-field"
                  value={profileForm.name}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, name: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="section-label">GST</label>
                <input
                  className="input-field"
                  value={profileForm.gst}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, gst: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="form-grid-2">
              <div>
                <label className="section-label">Address</label>
                <input
                  className="input-field"
                  value={profileForm.address}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, address: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="section-label">Bank Details</label>
                <input
                  className="input-field"
                  value={profileForm.bankDetails}
                  onChange={(e) =>
                    setProfileForm({
                      ...profileForm,
                      bankDetails: e.target.value,
                    })
                  }
                  placeholder="Account / IFSC / Branch"
                />
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
                      style={{
                        width: "72px",
                        height: "72px",
                        objectFit: "cover",
                        borderRadius: "14px",
                      }}
                    />
                  ) : (
                    <ImagePlus size={22} />
                  )}
                  <label
                    className="btn-secondary"
                    style={{ marginTop: "10px" }}
                  >
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
                        } catch (error: unknown) {
                          setProfileError(
                            getErrorMessage(error, "Failed to upload logo."),
                          );
                        } finally {
                          event.target.value = "";
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "flex-end",
                }}
              >
                <button className="btn-primary" disabled={savingProfile}>
                  {savingProfile ? "Saving..." : "Save Organization"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <div className="company-tabs" style={{ marginBottom: "24px" }}>
        <button
          className={`company-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`company-tab ${activeTab === "outstanding" ? "active" : ""}`}
          onClick={() => setActiveTab("outstanding")}
        >
          Outstanding Payments
        </button>
      </div>

      {activeTab === "overview" ? (
        <>
          <div
            className="grid-dashboard"
            style={{ marginTop: "8px", marginBottom: "24px" }}
          >
            <div className="glass-panel stat-card">
              <span className="stat-title">Total Products</span>
              <span className="stat-value">{dashboardData.totalProducts}</span>
              <div className="stat-foot">
                <Package size={16} /> Active inventory records
              </div>
            </div>
            <div className="glass-panel stat-card">
              <span className="stat-title">Inventory Value</span>
              <span className="stat-value" style={{ fontSize: "2rem" }}>
                {formatCurrencyINR(dashboardData.totalInventoryValue)}
              </span>
              <div className="stat-foot">
                <IndianRupee size={16} /> All values shown in INR
              </div>
            </div>
            <div className="glass-panel stat-card">
              <span className="stat-title">Low / Out of Stock</span>
              <span className="stat-value">{dashboardData.lowStockCount}</span>
              <div className="stat-foot">
                <AlertTriangle size={16} /> Items needing attention
              </div>
            </div>
          </div>

          <div className="org-home-grid">
            <section className="glass-panel">
              <div className="section-header-row">
                <div>
                  <p className="section-kicker">Recent Activity</p>
                  <h2 className="section-title">Recent Bills</h2>
                </div>
                <Link
                  href={`/org/${activeOrg.orgId}/bills`}
                  className="inline-link"
                >
                  Open bills
                </Link>
              </div>
              {loading ? (
                <p>Loading recent bills...</p>
              ) : dashboardData.recentCompanies.length === 0 ? (
                <p style={{ opacity: 0.7 }}>
                  No bills yet. Add the first bill to start tracking sales and
                  purchase activity.
                </p>
              ) : (
                <div
                  style={{ display: "grid", gap: "10px", marginTop: "12px" }}
                >
                  {dashboardData.recentCompanies.map((name, index) => (
                    <div key={`${name}-${index}`} className="list-row-card">
                      <div>
                        <div style={{ fontWeight: 600 }}>{name}</div>
                        <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>
                          Recent company in bill activity
                        </div>
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
                <div style={{ fontSize: "2.2rem", fontWeight: 700 }}>
                  {formatCurrencyINR(dashboardData.currentMonthSales)}
                </div>
                <div
                  className="trend-row"
                  style={{
                    color:
                      dashboardData.salesDelta >= 0 ? "#16a34a" : "#dc2626",
                  }}
                >
                  {dashboardData.salesDelta >= 0 ? (
                    <ArrowUpRight size={18} />
                  ) : (
                    <ArrowDownRight size={18} />
                  )}
                  <span>
                    {Math.abs(dashboardData.salesDelta).toFixed(1)}%{" "}
                    {dashboardData.salesDelta >= 0 ? "increase" : "decrease"}{" "}
                    from last month
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "12px",
                    fontSize: "0.88rem",
                    opacity: 0.78,
                  }}
                >
                  Sales:{" "}
                  {formatCurrencyINR(dashboardData.currentMonthSalesOnly)}
                </div>
                <div style={{ fontSize: "0.88rem", opacity: 0.78 }}>
                  Purchase:{" "}
                  {formatCurrencyINR(dashboardData.currentMonthPurchaseOnly)}
                </div>
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="outstanding-layout">
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={exportPendingSalesPdf}
            >
              <FileText size={16} style={{ marginRight: "8px" }} /> Pending Sales PDF
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={exportPendingPurchasePdf}
            >
              <FileText size={16} style={{ marginRight: "8px" }} /> Pending Purchase PDF
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowReportModal(true)}
            >
              <FileText size={16} style={{ marginRight: "8px" }} /> Monthly Report PDF
            </button>
          </div>
          <div className="outstanding-summary-grid">
            <div className="glass-panel stat-card outstanding-summary-card">
              <span className="stat-title">Profit Till Date</span>
              <span className="stat-value" style={{ fontSize: "2.2rem" }}>
                {formatCurrencyINR(revenueInsights.totals.profit)}
              </span>
              <div className="stat-foot">All-time organization profit</div>
            </div>
            <div className="glass-panel stat-card outstanding-summary-card">
              <span className="stat-title">Sales Till Date</span>
              <span className="stat-value" style={{ fontSize: "2.2rem" }}>
                {formatCurrencyINR(revenueInsights.totals.sales)}
              </span>
              <div className="stat-foot">
                All-time organization sales total.
              </div>
            </div>
            <div className="glass-panel stat-card outstanding-summary-card">
              <span className="stat-title">Purchase Till Date</span>
              <span className="stat-value" style={{ fontSize: "2.2rem" }}>
                {formatCurrencyINR(revenueInsights.totals.purchase)}
              </span>
              <div className="stat-foot">
                All-time organization purchase total.
              </div>
            </div>
          </div>

          <div
            className="grid-dashboard"
            style={{ marginTop: "8px", marginBottom: "0" }}
          >
            <div className="glass-panel stat-card">
              <span className="stat-title">Sales Payments Pending</span>
              <span className="stat-value" style={{ fontSize: "2rem" }}>
                {formatCurrencyINR(dashboardData.totalReceivables)}
              </span>
              <div className="stat-foot">
                <IndianRupee size={16} /> Amount customers still need to pay
              </div>
            </div>
            <div className="glass-panel stat-card">
              <span className="stat-title">Purchase Payments Pending</span>
              <span className="stat-value" style={{ fontSize: "2rem" }}>
                {formatCurrencyINR(dashboardData.totalPayables)}
              </span>
              <div className="stat-foot">
                <IndianRupee size={16} /> Amount you still need to pay suppliers
              </div>
            </div>
          </div>

          <section className="glass-panel outstanding-analytics-shell">
            <div
              className="section-header-row outstanding-analytics-header"
              style={{ alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                  <p className="section-kicker">Revenue Analytics</p>
                  <h2 className="section-title">
                    Monthly sales, purchase and profit summary
                  </h2>
                </div>
                <div className="outstanding-filter-row">
                  <div className="outstanding-filter-field">
                    <select
                      className="input-field"
                      value={revenueRange}
                      onChange={(e) =>
                        setRevenueRange(e.target.value as RevenueRange)
                      }
                    >
                      <option value="3m">Last 3 months</option>
                      <option value="6m">Last 6 months</option>
                      <option value="12m">Last 12 months</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <section className="outstanding-monthly-card">
              <MonthlySummaryTable
                salesData={revenueInsights.salesChart}
                purchaseData={revenueInsights.purchaseChart}
                profitData={revenueInsights.profitChart}
              />
            </section>
          </section>

          <div className="org-home-grid">
            <section className="glass-panel">
              <div className="section-header-row">
                <div>
                  <p className="section-kicker">Receivables</p>
                  <h2 className="section-title">Top 5 Sales Companies</h2>
                </div>
                <Link
                  href={`/org/${activeOrg.orgId}/bills`}
                  className="inline-link"
                >
                  Open bills
                </Link>
              </div>
              {loading ? (
                <p>Loading outstanding sales...</p>
              ) : dashboardData.topReceivableCompanies.length === 0 ? (
                <p style={{ opacity: 0.7 }}>
                  No pending sales payments right now.
                </p>
              ) : (
                <div
                  style={{ display: "grid", gap: "10px", marginTop: "12px" }}
                >
                  {dashboardData.topReceivableCompanies.map(
                    (company, index) => (
                      <div
                        key={`${company.name}-${index}`}
                        className="list-row-card"
                      >
                        <div>
                          <div style={{ fontWeight: 700 }}>{company.name}</div>
                          <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>
                            Pending payment against sales bills
                          </div>
                        </div>
                        <div style={{ fontWeight: 700 }}>
                          {formatCurrencyINR(company.amount)}
                        </div>
                      </div>
                    ),
                  )}
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
                <p style={{ opacity: 0.7 }}>
                  No pending purchase payments right now.
                </p>
              ) : (
                <div
                  style={{ display: "grid", gap: "10px", marginTop: "12px" }}
                >
                  {dashboardData.topPayableCompanies.map((company, index) => (
                    <div
                      key={`${company.name}-${index}`}
                      className="list-row-card"
                    >
                      <div>
                        <div style={{ fontWeight: 700 }}>{company.name}</div>
                        <div style={{ opacity: 0.65, fontSize: "0.875rem" }}>
                          Pending payment against purchase bills
                        </div>
                      </div>
                      <div style={{ fontWeight: 700 }}>
                        {formatCurrencyINR(company.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {showReportModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowReportModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px"
          }}
        >
          <div
            className="modal-content glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              padding: "28px",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)"
            }}
          >
            <div className="modal-header" style={{ marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>Generate Monthly Report</h2>
            </div>
            <div className="modal-body" style={{ marginBottom: "28px" }}>
              <label className="section-label" style={{ display: "block", marginBottom: "8px" }}>Select Month</label>
              <input
                className="input-field"
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                style={{ width: "100%", padding: "12px", fontSize: "1rem" }}
              />
              <p style={{ marginTop: "14px", fontSize: "0.9rem", color: "#64748b", lineHeight: 1.5 }}>
                The generated PDF will include day-to-day sales and purchase data, total sales, purchases, profit, and tax for the selected month.
              </p>
            </div>
            <div className="modal-actions" style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowReportModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={exportMonthlyReportPdf}
              >
                <FileText size={18} style={{ marginRight: "8px" }} />
                Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
