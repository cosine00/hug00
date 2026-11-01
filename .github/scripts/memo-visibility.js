/**
 * Public-blog allowlist for FlareMo Memo DTOs.
 * Missing/unknown visibility deliberately fails closed.
 */
export function isPublicMemo(memo) {
  return String(memo?.visibility || "").trim().toUpperCase() === "PUBLIC";
}

export function filterPublicMemos(memos) {
  return (Array.isArray(memos) ? memos : []).filter(isPublicMemo);
}
