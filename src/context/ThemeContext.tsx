"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
    theme: "light",
    setTheme: () => { },
    toggleTheme: () => { }
});

const STORAGE_KEY = "inventory-manager-theme";

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
    const [theme, setThemeState] = useState<Theme>("light");

    useEffect(() => {
        const storedTheme = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
        const resolvedTheme = storedTheme || "light";
        setThemeState(resolvedTheme);
        document.documentElement.setAttribute("data-theme", resolvedTheme);
    }, []);

    const setTheme = (nextTheme: Theme) => {
        setThemeState(nextTheme);
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
        document.documentElement.setAttribute("data-theme", nextTheme);
    };

    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark");
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => useContext(ThemeContext);
