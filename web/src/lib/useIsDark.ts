import { useEffect, useState } from "react";

const compute = () => {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/** Tracks the effective theme (OS preference unless overridden by data-theme). */
export function useIsDark() {
  const [dark, setDark] = useState(compute);
  useEffect(() => {
    const update = () => setDark(compute());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return dark;
}

/** Reference categorical palette (fixed slot order), validated for both surfaces. */
export const CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

/** Single-hue sequential ramp (blue 250→700 light, 100→550 dark so the low end stays visible). */
export const SEQUENTIAL = {
  light: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281", "#0d366b"],
  dark: ["#1c5cab", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],
};
