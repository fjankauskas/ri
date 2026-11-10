import type { OffResult } from "./lookup";
/** Texto claro para cada resultado de la consulta (null si hay un producto para mostrar). */
export function offStatusText(r: OffResult): string | null {
  switch (r.status) {
    case "local": case "found": return null;
    case "miss": return "Todavía no está en el catálogo local.";
    case "not_found": return "Open Food Facts no tiene este producto.";
    case "rate_limited": return "Se alcanzó el límite de consultas a Open Food Facts. Probá de nuevo en un momento.";
    case "unavailable": return `${r.message} Tu catálogo y el resto de la app siguen funcionando.`;
    case "invalid_response": return `${r.message} No se pudo confirmar si el producto existe.`;
    case "invalid_gtin": return r.message;
    case "disabled": return r.message;
    case "pending": return "Otra consulta del mismo código está en curso. Recargá en unos segundos.";
  }
}
