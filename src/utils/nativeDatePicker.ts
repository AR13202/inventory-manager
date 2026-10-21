import type { MouseEvent } from "react";

/** Opens the native date/month picker when any part of its input is clicked. */
export const openNativeDatePicker = (event: MouseEvent<HTMLInputElement>) => {
  const input = event.currentTarget;

  if (input.disabled || input.readOnly || typeof input.showPicker !== "function") {
    return;
  }

  try {
    input.showPicker();
  } catch {
    // Browsers without native picker support retain their normal input behavior.
  }
};
