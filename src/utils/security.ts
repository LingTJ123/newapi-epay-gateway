export function singleString(value: unknown): string {
  if (Array.isArray(value)) return "";
  return typeof value === "string" ? value : "";
}

export function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function maskAccount(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return `${value.slice(0, 1)}***${value.slice(-1)}`;
  return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char] ?? char);
}

export function summarize(value: string, maxLength = 500): string {
  return cleanText(value).slice(0, maxLength);
}
