export function isCorrupt(order) {
  if (order.corruptedBy) return true;
  if (typeof order.total !== "number") return true;
  if (order.total <= 0) return true;
  if (order.total > order.unitPrice * order.quantity + 20) return true;
  return false;
}
