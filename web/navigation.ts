/**
 * Menu lateral del panel.
 *
 * La navegacion se mantiene en el hash (`#/ajustes`) para que la vista
 * sobreviva a una recarga y se pueda enlazar directamente.
 */

export type ViewId = "dashboard" | "nuevo" | "trabajos" | "preview" | "ajustes";

export type MenuItem = {
  id: ViewId;
  label: string;
};

export const MENU_ITEMS: MenuItem[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "nuevo", label: "Nuevo proyecto" },
  { id: "trabajos", label: "Trabajos" },
  { id: "preview", label: "Vista previa" },
  { id: "ajustes", label: "Ajustes" },
];

export const DEFAULT_VIEW: ViewId = "dashboard";

const VIEW_IDS = new Set<string>(MENU_ITEMS.map(item => item.id));

/** Devuelve la vista indicada por el hash, o la inicial si no es valida. */
export function viewFromHash(hash: string): ViewId {
  const raw = String(hash || "").replace(/^#\/?/, "").trim();
  return VIEW_IDS.has(raw) ? raw as ViewId : DEFAULT_VIEW;
}

/** Hash que corresponde a una vista. */
export function hashForView(view: ViewId): string {
  return `#/${view}`;
}
