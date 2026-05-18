import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Only accept in-app relative paths as a back/return target. Rejects anything
// that could escape the SPA (protocol-relative `//evil.com`, full URLs, etc.).
// Used by routes that read `?from=…` from the URL.
export function sanitizeReturnHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}
