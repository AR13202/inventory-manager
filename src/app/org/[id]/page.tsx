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
            <th style={{ padding: "12px 10px" }}>Balance Amount</th>
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
    expenditures: [] as { id: string; name: string; cost: number }[],
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
      expenditures: activeOrg.expenditures || [],
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

    const currentMonthSalesTax = bills
      .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
      .filter((bill) => bill.billType === "Sale")
      .reduce((sum, bill) => sum + parseAmount(bill.taxAmount), 0);
    const currentMonthPurchaseTax = bills
      .filter((bill) => String(bill.date || "").startsWith(currentMonthKey))
      .filter((bill) => bill.billType === "Purchase")
      .reduce((sum, bill) => sum + parseAmount(bill.taxAmount), 0);
    const currentMonthNetTax = currentMonthSalesTax - currentMonthPurchaseTax;

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
      currentMonthSalesTax,
      currentMonthPurchaseTax,
      currentMonthNetTax,
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

    const sortedMonthBills = [...monthBills].sort((a, b) =>
      String(a.date || "").localeCompare(String(b.date || "")),
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

    const paymentsReceived = bills
      .filter((bill) => bill.billType === "Sale" && bill.paymentStatus === "Paid")
      .filter((bill) => {
        const pDate = bill.paidDate || bill.date || "";
        return pDate.startsWith(reportMonth);
      })
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);

    const paymentsSent = bills
      .filter((bill) => bill.billType === "Purchase" && bill.paymentStatus === "Paid")
      .filter((bill) => {
        const pDate = bill.paidDate || bill.date || "";
        return pDate.startsWith(reportMonth);
      })
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);

    const remainingSales = monthBills
      .filter((bill) => bill.billType === "Sale" && bill.paymentStatus !== "Paid")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);

    const remainingPurchase = monthBills
      .filter((bill) => bill.billType === "Purchase" && bill.paymentStatus !== "Paid")
      .reduce((sum, bill) => sum + parseAmount(bill.amount), 0);

    const paymentBreakdown = {
      received: {
        UPI: 0,
        "NEFT/IMPS": 0,
        Cash: 0,
        Cheque: 0,
      },
      sent: {
        UPI: 0,
        "NEFT/IMPS": 0,
        Cash: 0,
        Cheque: 0,
      }
    };

    bills
      .filter((bill) => bill.billType === "Sale" && bill.paymentStatus === "Paid")
      .filter((bill) => {
        const pDate = bill.paidDate || bill.date || "";
        return pDate.startsWith(reportMonth);
      })
      .forEach((bill) => {
        const mode = bill.paidType || "Cash";
        const amt = parseAmount(bill.amount);
        if (mode in paymentBreakdown.received) {
          paymentBreakdown.received[mode as keyof typeof paymentBreakdown.received] += amt;
        } else {
          paymentBreakdown.received["Cash"] += amt;
        }
      });

    bills
      .filter((bill) => bill.billType === "Purchase" && bill.paymentStatus === "Paid")
      .filter((bill) => {
        const pDate = bill.paidDate || bill.date || "";
        return pDate.startsWith(reportMonth);
      })
      .forEach((bill) => {
        const mode = bill.paidType || "Cash";
        const amt = parseAmount(bill.amount);
        if (mode in paymentBreakdown.sent) {
          paymentBreakdown.sent[mode as keyof typeof paymentBreakdown.sent] += amt;
        } else {
          paymentBreakdown.sent["Cash"] += amt;
        }
      });

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
      purchaseTax,
      paymentsReceived,
      paymentsSent,
      remainingSales,
      remainingPurchase,
      paymentBreakdown,
      sortedMonthBills,
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
    const totalExpenditures = (activeOrg?.expenditures || []).reduce(
      (sum: number, exp: any) => sum + parseAmount(exp.cost || 0),
      0
    );
    const netTax = monthlyReportData.salesTax - monthlyReportData.purchaseTax;
    const netProfit = monthlyReportData.salesTotal - monthlyReportData.purchaseTotal - netTax - totalExpenditures;

    const cardBorderClasses: Record<string, string> = {
      "Sales Total": "border-left: 4px solid #0284c7;",
      "Purchase Total": "border-left: 4px solid #475569;",
      "Net Tax Calculated": "border-left: 4px solid #6366f1;",
      "Total Expenditures": "border-left: 4px solid #f43f5e;",
      "Net Profit": "border-left: 4px solid " + (netProfit >= 0 ? "#16a34a;" : "#dc2626;"),
      "Payments Received": "border-left: 4px solid #22c55e;",
      "Payments Sent": "border-left: 4px solid #3b82f6;",
      "Remaining Sales": "border-left: 4px solid #f59e0b;",
      "Remaining Purchase": "border-left: 4px solid #ef4444;"
    };

    const summaryCards = [
      ["Sales Total", monthlyReportData.salesTotal],
      ["Purchase Total", monthlyReportData.purchaseTotal],
      ["Net Tax Calculated", netTax],
      ["Total Expenditures", totalExpenditures],
      ["Net Profit", netProfit],
      ["Payments Received", monthlyReportData.paymentsReceived],
      ["Payments Sent", monthlyReportData.paymentsSent],
      ["Remaining Sales", monthlyReportData.remainingSales],
      ["Remaining Purchase", monthlyReportData.remainingPurchase],
    ]
      .map(
        ([label, value]) => `
          <div class="card" style="${cardBorderClasses[String(label)] || ''}">
            <div class="label">${escapeHtml(String(label))}</div>
            <div class="value">${escapeHtml(formatCurrencyINR(Number(value)))}</div>
          </div>
        `,
      )
      .join("");

    const billRows = monthlyReportData.sortedMonthBills
      .map((bill) => {
        const grossAmount = parseAmount(bill.grossAmount || 0);
        const taxAmount = parseAmount(bill.taxAmount || 0);
        const totalAmount = parseAmount(bill.amount || 0);
        const status = bill.paymentStatus || "Unpaid";
        const paidAmount = status === "Paid" ? totalAmount : 0;
        const remainingAmount = status !== "Paid" ? totalAmount : 0;
        const mode = status === "Paid"
          ? (bill.paidType || "Cash") + (bill.chequeNumber ? ` (Chq: ${bill.chequeNumber})` : "")
          : "-";

        return `
          <tr>
            <td>${escapeHtml(bill.date || "")}</td>
            <td><strong>${escapeHtml(bill.billNumber || "")}</strong></td>
            <td>${escapeHtml(bill.vendorName || "")}</td>
            <td>
              <span style="font-weight: 600; color: ${bill.billType === "Sale" ? "#0284c7" : "#475569"}">
                ${escapeHtml(bill.billType || "")}
              </span>
            </td>
            <td>${escapeHtml(formatCurrencyINR(grossAmount))}</td>
            <td>${escapeHtml(formatCurrencyINR(taxAmount))}</td>
            <td><strong>${escapeHtml(formatCurrencyINR(totalAmount))}</strong></td>
            <td>
              <span class="status-badge" style="background: ${status === "Paid" ? "#dcfce7" : "#fee2e2"}; color: ${status === "Paid" ? "#15803d" : "#b91c1c"};">
                ${escapeHtml(status)}
              </span>
            </td>
            <td>${escapeHtml(mode)}</td>
            <td>${escapeHtml(formatCurrencyINR(paidAmount))}</td>
            <td style="font-weight: 600; color: ${remainingAmount > 0 ? "#b91c1c" : "inherit"};">
              ${escapeHtml(formatCurrencyINR(remainingAmount))}
            </td>
          </tr>
        `;
      })
      .join("");

    const billGrossTotal = monthlyReportData.sortedMonthBills.reduce((sum, b) => sum + parseAmount(b.grossAmount || 0), 0);
    const billTaxTotal = monthlyReportData.sortedMonthBills.reduce((sum, b) => sum + parseAmount(b.taxAmount || 0), 0);
    const billTotalTotal = monthlyReportData.sortedMonthBills.reduce((sum, b) => sum + parseAmount(b.amount || 0), 0);
    const billPaidTotal = monthlyReportData.sortedMonthBills.reduce((sum, b) => sum + parseAmount(b.paymentStatus === "Paid" ? b.amount : 0), 0);
    const billRemainingTotal = monthlyReportData.sortedMonthBills.reduce((sum, b) => sum + parseAmount(b.paymentStatus !== "Paid" ? b.amount : 0), 0);

    const billTableFooter = `
      <tfoot>
        <tr style="font-weight: bold; background: #e2e8f0;">
          <td colspan="4" style="text-align: right; padding: 8px; border: 1px solid #cbd5e1;">Grand Total:</td>
          <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(billGrossTotal))}</td>
          <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(billTaxTotal))}</td>
          <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(billTotalTotal))}</td>
          <td colspan="2" style="padding: 8px; border: 1px solid #cbd5e1; text-align: center;">-</td>
          <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(billPaidTotal))}</td>
          <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(billRemainingTotal))}</td>
        </tr>
      </tfoot>
    `;

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
        <style>
          @media print {
            @page {
              size: landscape;
              margin: 10mm;
            }
            body {
              padding: 0;
            }
          }
          .company-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 18px;
            margin-bottom: 24px;
          }
          .company-info-block {
            display: flex;
            gap: 16px;
            align-items: center;
          }
          .company-logo {
            width: 72px;
            height: 72px;
            object-fit: cover;
            border-radius: 12px;
            border: 1px solid #cbd5e1;
          }
          .company-name {
            font-size: 24px;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.2;
          }
          .company-detail-line {
            font-size: 11px;
            color: #475569;
            margin-top: 3px;
          }
          .report-info-block {
            text-align: right;
          }
          .report-title {
            font-size: 20px;
            font-weight: 700;
            color: #0284c7;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .report-month {
            font-size: 14px;
            font-weight: 600;
            color: #0f172a;
            margin-top: 4px;
          }
          .report-meta {
            font-size: 10px;
            color: #64748b;
            margin-top: 6px;
          }
          .report-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
            font-size: 11px;
          }
          .report-table th {
            background-color: #f1f5f9;
            color: #334155;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 9px;
            letter-spacing: 0.05em;
            border: 1px solid #cbd5e1;
            padding: 8px;
            text-align: left;
          }
          .report-table td {
            border: 1px solid #e2e8f0;
            padding: 8px;
            color: #334155;
            vertical-align: middle;
          }
          .report-table tr:nth-child(even) {
            background-color: #f8fafc;
          }
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: bold;
            font-size: 9px;
          }
          .page-break {
            page-break-before: always;
          }
        </style>

        <div class="company-header">
          <div class="company-info-block">
            ${activeOrg.logoPublicId ? `
              <img
                src="${window.location.origin}/api/bills/file?publicId=${encodeURIComponent(activeOrg.logoPublicId)}&resourceType=${encodeURIComponent(activeOrg.logoResourceType || 'image')}"
                alt="Logo"
                class="company-logo"
              />
            ` : ""}
            <div class="company-text">
              <div class="company-name">${escapeHtml(activeOrg.name)}</div>
              ${activeOrg.address ? `<div class="company-detail-line">${escapeHtml(activeOrg.address)}</div>` : ""}
              ${activeOrg.gst ? `<div class="company-detail-line"><strong>GST:</strong> ${escapeHtml(activeOrg.gst)}</div>` : ""}
              ${activeOrg.bankDetails ? `<div class="company-detail-line"><strong>Bank:</strong> ${escapeHtml(activeOrg.bankDetails)}</div>` : ""}
            </div>
          </div>
          <div class="report-info-block">
            <div class="report-title">Monthly Report</div>
            <div class="report-month">${escapeHtml(monthlyReportData.monthLabel)}</div>
            <div class="report-meta">Generated: ${escapeHtml(new Date().toLocaleString("en-IN"))}</div>
          </div>
        </div>

        <div class="grid" style="grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 18px 0 24px;">
          ${summaryCards}
        </div>

        <div style="display: flex; gap: 24px; margin-top: 20px; margin-bottom: 24px; align-items: flex-start;">
          <div class="section" style="flex: 1; min-width: 300px; max-width: 550px; margin-top: 0;">
            <h2 style="font-size: 14px; color: #0f172a; margin-bottom: 8px;">Payment Modes Breakdown</h2>
            <table class="report-table" style="width: 100%; margin-top: 0;">
              <thead>
                <tr>
                  <th>Payment Mode</th>
                  <th>Payments Received (Sales)</th>
                  <th>Payments Sent (Purchase)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>UPI</strong></td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.received.UPI))}</td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.sent.UPI))}</td>
                </tr>
                <tr>
                  <td><strong>NEFT/IMPS</strong></td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.received["NEFT/IMPS"]))}</td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.sent["NEFT/IMPS"]))}</td>
                </tr>
                <tr>
                  <td><strong>Cash</strong></td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.received.Cash))}</td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.sent.Cash))}</td>
                </tr>
                <tr>
                  <td><strong>Cheque</strong></td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.received.Cheque))}</td>
                  <td>${escapeHtml(formatCurrencyINR(monthlyReportData.paymentBreakdown.sent.Cheque))}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="font-weight: bold; background: #e2e8f0;">
                  <td style="padding: 8px; border: 1px solid #cbd5e1;">Total Paid:</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(monthlyReportData.paymentsReceived))}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1;">${escapeHtml(formatCurrencyINR(monthlyReportData.paymentsSent))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          ${activeOrg.expenditures && activeOrg.expenditures.length > 0 ? `
            <div class="section" style="flex: 1; min-width: 300px; max-width: 450px; margin-top: 0;">
              <h2 style="font-size: 14px; color: #0f172a; margin-bottom: 8px;">Monthly Expenditures</h2>
              <table class="report-table" style="width: 100%; margin-top: 0;">
                <thead>
                  <tr>
                    <th>Expenditure Name</th>
                    <th style="text-align: right;">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${activeOrg.expenditures.map((exp: any) => `
                    <tr>
                      <td><strong>${escapeHtml(exp.name)}</strong></td>
                      <td style="text-align: right;">${escapeHtml(formatCurrencyINR(Number(exp.cost || 0)))}</td>
                    </tr>
                  `).join("")}
                </tbody>
                <tfoot>
                  <tr style="font-weight: bold; background: #e2e8f0;">
                    <td style="padding: 8px; border: 1px solid #cbd5e1;">Total Expenditures:</td>
                    <td style="padding: 8px; border: 1px solid #cbd5e1; text-align: right;">${escapeHtml(formatCurrencyINR(totalExpenditures))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ` : ""}
        </div>

        <div class="section" style="margin-top: 24px; margin-bottom: 24px;">
          <h2 style="font-size: 14px; color: #0f172a; margin-bottom: 8px;">Financial Statement & Net Profit Calculation</h2>
          <table class="report-table" style="max-width: 650px; font-size: 11px;">
            <thead>
              <tr style="background: #0f172a; color: #ffffff;">
                <th style="background: #0f172a; color: #ffffff; font-weight: bold; padding: 6px 8px;">Calculation Step</th>
                <th style="background: #0f172a; color: #ffffff; font-weight: bold; text-align: right; padding: 6px 8px;">Amount</th>
                <th style="background: #0f172a; color: #ffffff; font-weight: bold; padding: 6px 8px;">Formula / Explanation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Total Sales Revenue</strong></td>
                <td style="text-align: right; font-weight: 600; color: #0284c7;">${escapeHtml(formatCurrencyINR(monthlyReportData.salesTotal))}</td>
                <td>Cumulative Sales invoiced (Tax Inclusive)</td>
              </tr>
              <tr>
                <td><strong>Total Purchases Cost</strong></td>
                <td style="text-align: right; font-weight: 600; color: #475569;">(${escapeHtml(formatCurrencyINR(monthlyReportData.purchaseTotal))})</td>
                <td>Cumulative Purchases invoiced (Tax Inclusive)</td>
              </tr>
              <tr style="background-color: #f1f5f9; font-weight: 600;">
                <td>Gross Trading Profit</td>
                <td style="text-align: right; color: ${monthlyReportData.salesTotal - monthlyReportData.purchaseTotal >= 0 ? "#15803d" : "#b91c1c"};">${escapeHtml(formatCurrencyINR(monthlyReportData.salesTotal - monthlyReportData.purchaseTotal))}</td>
                <td>Total Sales - Total Purchases</td>
              </tr>
              <tr>
                <td>Sales Output Tax (GST Collected)</td>
                <td style="text-align: right; color: #4f46e5;">${escapeHtml(formatCurrencyINR(monthlyReportData.salesTax))}</td>
                <td>Tax liability collected on sales</td>
              </tr>
              <tr>
                <td>Purchase Input Tax (GST Credit)</td>
                <td style="text-align: right; color: #4f46e5;">(${escapeHtml(formatCurrencyINR(monthlyReportData.purchaseTax))})</td>
                <td>Input tax paid on purchases (Input Tax Credit)</td>
              </tr>
              <tr style="background-color: #f8fafc;">
                <td><strong>Net Tax Calculated</strong></td>
                <td style="text-align: right; font-weight: 600; color: #4f46e5;">${escapeHtml(formatCurrencyINR(netTax))}</td>
                <td>Sales Tax - Purchase Tax (Liability offset)</td>
              </tr>
              <tr>
                <td><strong>Total Operating Expenditures</strong></td>
                <td style="text-align: right; font-weight: 600; color: #dc2626;">(${escapeHtml(formatCurrencyINR(totalExpenditures))})</td>
                <td>Overhead expenses (Rent, Salaries, Utilities, etc.)</td>
              </tr>
              <tr style="background: #dcfce7; font-weight: bold; border-top: 1.5px solid #16a34a; border-bottom: 1.5px solid #16a34a;">
                <td style="color: #14532d; padding: 8px;">NET PROFIT AFTER TAXES & EXPENSES</td>
                <td style="text-align: right; color: ${netProfit >= 0 ? "#14532d" : "#7f1d1d"}; padding: 8px;">${escapeHtml(formatCurrencyINR(netProfit))}</td>
                <td style="color: #14532d; padding: 8px;">Gross Trading Profit - Net Tax - Total Operating Expenditures</td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="section">
          <h2>All Monthly Bills</h2>
          <table class="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Bill Number</th>
                <th>Company Name</th>
                <th>Type</th>
                <th>Gross Amount</th>
                <th>Tax Amount</th>
                <th>Total Amount</th>
                <th>Status</th>
                <th>Payment Mode</th>
                <th>Paid Amount</th>
                <th>Remaining Amount</th>
              </tr>
            </thead>
            <tbody>
              ${billRows || '<tr><td colspan="11" style="text-align: center; padding: 20px; color: #64748b;">No bills found for this month.</td></tr>'}
            </tbody>
            ${billRows ? billTableFooter : ""}
          </table>
        </div>

        <div class="section page-break">
          <h2>Day-to-Day Sales and Purchase</h2>
          <table class="report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Sales</th>
                <th>Purchase</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows || '<tr><td colspan="3" style="text-align: center; padding: 20px; color: #64748b;">No daily records for this month.</td></tr>'}
            </tbody>
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
            </div>

            <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
              <h3 style={{ marginBottom: "6px", fontSize: "1.1rem", fontWeight: 600 }}>Expenditures</h3>
              <p style={{ fontSize: "0.85rem", opacity: 0.7, marginBottom: "12px" }}>
                Add monthly overhead or operation costs (e.g., Rent, Salaries, Utilities) to subtract from profit calculations.
              </p>
              <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
                {profileForm.expenditures.map((exp, idx) => (
                  <div key={exp.id || idx} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <input
                      placeholder="Expenditure Name"
                      className="input-field"
                      value={exp.name}
                      onChange={(e) => {
                        const next = [...profileForm.expenditures];
                        next[idx] = { ...next[idx], name: e.target.value };
                        setProfileForm({ ...profileForm, expenditures: next });
                      }}
                      required
                      style={{ flex: 2 }}
                    />
                    <input
                      placeholder="Cost"
                      type="number"
                      className="input-field"
                      value={exp.cost || ""}
                      onChange={(e) => {
                        const next = [...profileForm.expenditures];
                        next[idx] = { ...next[idx], cost: Number(e.target.value) };
                        setProfileForm({ ...profileForm, expenditures: next });
                      }}
                      required
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      style={{ color: "#dc2626", background: "none", border: "none", cursor: "pointer", fontSize: "0.875rem", padding: "8px" }}
                      onClick={() => {
                        const next = profileForm.expenditures.filter((_, i) => i !== idx);
                        setProfileForm({ ...profileForm, expenditures: next });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: "fit-content", padding: "8px 12px", fontSize: "0.875rem" }}
                  onClick={() => {
                    const newExp = {
                      id: "EXP-" + Math.random().toString(36).slice(2, 9).toUpperCase(),
                      name: "",
                      cost: 0
                    };
                    setProfileForm({
                      ...profileForm,
                      expenditures: [...profileForm.expenditures, newExp]
                    });
                  }}
                >
                  + Add Expenditure
                </button>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "flex-end",
                marginTop: "8px",
              }}
            >
              <button className="btn-primary" disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save Organization"}
              </button>
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
                <div style={{ fontSize: "0.88rem", opacity: 0.78 }}>
                  Net Tax (GST):{" "}
                  {formatCurrencyINR(dashboardData.currentMonthNetTax)}
                </div>
                {activeOrg.expenditures && activeOrg.expenditures.length > 0 && (
                  <div style={{ fontSize: "0.88rem", opacity: 0.78 }}>
                    Expenditures:{" "}
                    {formatCurrencyINR(
                      activeOrg.expenditures.reduce(
                        (sum: number, exp: any) => sum + Number(exp.cost || 0),
                        0
                      )
                    )}
                  </div>
                )}
                <div
                  style={{
                    marginTop: "8px",
                    borderTop: "1px solid var(--border-color)",
                    paddingTop: "8px",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    opacity: 0.95,
                  }}
                >
                  Net Profit:{" "}
                  {formatCurrencyINR(
                    dashboardData.currentMonthSales -
                      dashboardData.currentMonthNetTax -
                      (activeOrg.expenditures || []).reduce(
                        (sum: number, exp: any) => sum + Number(exp.cost || 0),
                        0
                      )
                  )}
                </div>
              </div>
            </section>
          </div>

          {activeOrg.expenditures && activeOrg.expenditures.length > 0 && (
            <section className="glass-panel" style={{ marginTop: "24px" }}>
              <div className="section-header-row" style={{ marginBottom: "12px" }}>
                <div>
                  <p className="section-kicker">Operations</p>
                  <h2 className="section-title">Operational Expenditures</h2>
                </div>
              </div>
              <div className="table-container">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th>Expense ID</th>
                      <th>Expenditure Name</th>
                      <th style={{ textAlign: "right" }}>Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrg.expenditures.map((exp: any) => (
                      <tr key={exp.id}>
                        <td><code>{exp.id}</code></td>
                        <td><strong>{exp.name}</strong></td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{formatCurrencyINR(exp.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: "bold", background: "var(--hover-bg)" }}>
                      <td colSpan={2} style={{ textAlign: "right" }}>Total Monthly Expenditures:</td>
                      <td style={{ textAlign: "right" }}>
                        {formatCurrencyINR(
                          activeOrg.expenditures.reduce((sum: number, e: any) => sum + Number(e.cost || 0), 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
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
              background: "var(--glass-bg)",
              padding: "28px",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.05)"
            }}
          >
            <div className="modal-header" style={{ marginBottom: "20px" }}>
              <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "var(--text-color)" }}>Generate Monthly Report</h2>
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
              <p style={{ marginTop: "14px", fontSize: "0.9rem", color: "var(--muted-text)", lineHeight: 1.5 }}>
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
