export function toSnippet(text: string | undefined): string {
  if (!text) {
    return "";
  }
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.slice(0, 180);
}

export function addressText(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string") {
    return value.text;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
    return text || undefined;
  }

  return undefined;
}
