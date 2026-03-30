export const formatCurrencyINR = (value: number | string | undefined) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
        minimumFractionDigits: 2
    }).format(Number.isFinite(amount) ? amount : 0);
};

export const formatNumberINR = (value: number | string | undefined) => {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-IN").format(Number.isFinite(amount) ? amount : 0);
};

export const formatMonthYear = (date: Date) => {
    return new Intl.DateTimeFormat("en-IN", {
        month: "long",
        year: "numeric"
    }).format(date);
};
