"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { supabaseServer } from "@/lib/supabase/server";
import * as inv from "@/services/inventory";
import { parseStockCsv } from "@/lib/csv";
import { UNITS, normUnit } from "@/lib/units";
import { IVA_OPTIONS } from "@/lib/billing";
import { validateGtin } from "@/lib/gs1/check";
import { gtinTaken } from "@/lib/gs1/data";
const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? "";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
// Destinos por defecto después de cada acción (cada submenú de Inventario y Red).
const PATH = { products: "/inventory?v=products", production: "/inventory?v=production", orders: "/network?v=orders", partners: "/network?v=partners", market: "/network?v=market", shipments: "/network?v=shipments" };
// Ruta a la que vuelve la pantalla después de una acción: solo rutas propias (/inventory o /network) con parámetros simples.
const back = (f: FormData, def: string) => (/^\/(inventory|network)(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const num = (x: string) => Number(x.replace(",", "."));
const ivaOf = (f: FormData) => { const v = s(f, "iva") || "21"; if (!IVA_OPTIONS.some((o) => o.key === v)) throw new Error("La alícuota de IVA no es válida"); return v; };
async function run(path: string, fn: () => Promise<unknown>, ok: string | (() => string)) {
  let err = "";
  try { await fn(); } catch (e: any) { err = e?.issues?.[0]?.message ?? e?.message ?? "Error inesperado"; }
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${err ? "e=" + encodeURIComponent(err) : "ok=" + encodeURIComponent(typeof ok === "function" ? ok() : ok)}`);
}
export async function signIn(f: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: s(f, "email"), password: s(f, "password") });
  if (error) redirect("/login?e=" + encodeURIComponent("Email o contraseña incorrectos"));
  redirect("/");
}
export async function signUp(f: FormData) {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({ email: s(f, "email"), password: s(f, "password") });
  const q = s(f, "invite") ? "?invite=" + encodeURIComponent(s(f, "invite")) : "";
  if (error) redirect("/login?e=" + encodeURIComponent(error.message));
  redirect(data.session ? "/onboarding" + q : "/login?ok=" + encodeURIComponent("Revisá tu email para confirmar la cuenta y después ingresá"));
}
export async function signOut() { const sb = await supabaseServer(); await sb.auth.signOut(); redirect("/login"); }
export async function createOrg(f: FormData) {
  const sb = await supabaseServer();
  const { data: orgId, error } = await sb.rpc("create_organization", { p_name: s(f, "name"), p_tax_id: s(f, "tax_id") || null });
  if (error) redirect("/onboarding?e=" + encodeURIComponent(error.message.replace(/^[A-Z_]+: /, "")));
  if (s(f, "invite")) await sb.rpc("redeem_invitation", { p_token: s(f, "invite"), p_my_org: orgId });
  redirect("/");
}
export async function createProduct(f: FormData) {
  const { sb, org } = await ctx();
  let msg = "Producto creado";
  await run(back(f, PATH.products), async () => {
    const unit = normUnit(s(f, "unit") || "u");
    if (!unit) throw new Error(`Elegí una unidad de medida de la lista (${UNITS.join(", ")}). Para cargar cantidad usá «Stock inicial».`);
    const price = s(f, "price") === "" ? null : num(s(f, "price")), per = s(f, "price_per") === "" ? 1 : num(s(f, "price_per"));
    if (price !== null && !(price >= 0)) throw new Error("El precio debe ser un número igual o mayor que cero");
    if (!(per > 0)) throw new Error("«Por cuántas unidades» debe ser mayor que cero");
    const qty = s(f, "qty") === "" ? 0 : num(s(f, "qty"));
    if (!(qty >= 0)) throw new Error("El stock inicial no puede ser negativo");
    if (qty > 0 && !s(f, "warehouse")) throw new Error("Elegí el depósito del stock inicial (si no tenés, creá uno primero)");
    const gtinRaw = s(f, "gtin").replace(/[\s-]/g, "");
    if (gtinRaw) { const v = validateGtin(gtinRaw); if (!v.ok) throw new Error(`GTIN: ${v.error}`); if (await gtinTaken(sb, org.id, gtinRaw)) throw new Error("Ya existe un producto con ese GTIN en tu empresa."); }
    const { data, error } = await sb.from("products").insert({ organization_id: org.id, sku: s(f, "sku"), name: s(f, "name"), unit, gtin: gtinRaw || null, min_stock: Number(s(f, "min_stock") || 0), price, price_per: per, iva: ivaOf(f) }).select("id").single();
    if (error) throw new Error(error.code === "23505" ? (/gtin/i.test(error.message) ? "Ya existe un producto con ese GTIN en tu empresa" : "Ya existe un producto con ese SKU") : error.message);
    if (qty > 0) {
      try { await inv.stockIn(sb, { org: org.id, warehouse: s(f, "warehouse"), product: data.id, lot: s(f, "lot") || "INICIAL", qty, type: "RECEIPT", expires: s(f, "expires") }); }
      catch (e: any) { throw new Error(`El producto se creó, pero no se pudo cargar el stock: ${e?.issues?.[0]?.message ?? e?.message}`); }
      msg = `Producto creado con stock inicial de ${qty} ${unit}`;
    }
  }, () => msg);
}
export async function createWarehouse(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), () => inv.call(sb, "create_warehouse", { p_org: org.id, p_name: s(f, "name") }), "Depósito creado");
}
export async function stockIn(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), () => inv.stockIn(sb, { org: org.id, warehouse: s(f, "warehouse"), product: s(f, "product"), lot: s(f, "lot"), qty: s(f, "qty"), note: s(f, "note"), type: s(f, "type") || "RECEIPT", expires: s(f, "expires") }), "Stock registrado");
}
export async function moveStock(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), () => inv.moveStock(sb, { org: org.id, position: s(f, "position"), to: s(f, "to") || undefined, qty: s(f, "qty"), note: s(f, "note"), type: s(f, "type") }), "Movimiento registrado");
}
export async function connect(f: FormData) { const { sb, org } = await ctx(); await run(back(f, PATH.partners), () => inv.requestConnection(sb, org.id, s(f, "tax_id")), "Solicitud enviada"); }
export async function accept(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.partners), () => inv.acceptConnection(sb, s(f, "id")), "Conexión activa"); }
export async function ship(f: FormData) {
  const { sb } = await ctx();
  await run(back(f, PATH.shipments), () => inv.shipToOrg(sb, { position: s(f, "position"), toOrg: s(f, "to_org"), qty: s(f, "qty") }), "Envío despachado");
}
export async function receive(f: FormData) {
  const { sb } = await ctx();
  await run(back(f, PATH.shipments), () => inv.receiveShipment(sb, { ship: s(f, "ship"), warehouse: s(f, "warehouse"), qty: s(f, "qty") }), "Recepción confirmada");
}
export async function importStock(f: FormData) {
  const { sb, org } = await ctx();
  let summary = "Stock importado";
  await run(back(f, PATH.products), async () => {
    const file = f.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : s(f, "csv");
    if (!text.trim()) throw new Error("Subí un archivo CSV o pegá las filas");
    const rows = parseStockCsv(text);
    let created = 0;
    if (f.get("create_missing")) {
      const have = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("products").select("sku").eq("organization_id", org.id).range(from, from + 999);
        if (error) throw new Error(error.message);
        (data ?? []).forEach((p) => have.add(p.sku.toLowerCase()));
        if ((data ?? []).length < 1000) break;
      }
      const missing = new Map<string, { organization_id: string; sku: string; name: string; unit: string }>();
      for (const r of rows) {
        if (have.has(r.sku.toLowerCase()) || missing.has(r.sku.toLowerCase())) continue;
        const unit = normUnit(r.unit ?? "u");
        if (!unit) throw new Error(`Fila ${r.line}: la unidad «${r.unit}» no es válida (usá ${UNITS.join(", ")})`);
        missing.set(r.sku.toLowerCase(), { organization_id: org.id, sku: r.sku, name: r.name ?? r.sku, unit });
      }
      if (missing.size) {
        const { error } = await sb.from("products").insert([...missing.values()]);
        if (error) throw new Error(error.code === "23505" ? "Hay SKUs repetidos con distinto formato de mayúsculas" : error.message);
        created = missing.size;
      }
    }
    await inv.call(sb, "import_stock", { p_org: org.id, p_wh: s(f, "warehouse"), p_rows: rows.map((r) => ({ sku: r.sku, lot: r.lot, qty: r.qty, expires: r.expires })) });
    summary = `Stock importado: ${rows.length} filas${created ? `, ${created} producto${created === 1 ? "" : "s"} nuevo${created === 1 ? "" : "s"} creado${created === 1 ? "" : "s"}` : ""}`;
  }, () => summary);
}
export async function saveBom(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.production), async () => {
    const comps = f.getAll("comp").map(String), qtys = f.getAll("qty").map(String);
    let items: { component: string; qty: number }[];
    if (comps.length) {
      items = comps.map((c, i) => ({ component: c.trim(), qty: num(qtys[i] ?? "") })).filter((i) => i.component);
    } else {
      const { data: prods } = await sb.from("products").select("id, sku").eq("organization_id", org.id);
      const bySku = new Map<string, string>((prods ?? []).map((p: any) => [String(p.sku).toLowerCase(), String(p.id)] as [string, string]));
      items = s(f, "items").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [sku, q] = l.split(/[:;,]/).map((x) => x.trim()); const id = bySku.get((sku ?? "").toLowerCase());
        if (!id) throw new Error(`SKU desconocido en la receta: ${sku}`);
        return { component: id, qty: num(q ?? "") };
      });
    }
    if (!items.length) throw new Error("Elegí al menos un insumo");
    if (items.some((i) => !(i.qty > 0))) throw new Error("Cada insumo necesita una cantidad mayor que cero por unidad");
    if (new Set(items.map((i) => i.component)).size !== items.length) throw new Error("Un insumo está repetido en la receta");
    await inv.call(sb, "save_bom", { p_org: org.id, p_product: s(f, "product"), p_items: items });
  }, "Receta guardada");
}
export async function produce(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.production), () => inv.call(sb, "produce", { p_org: org.id, p_wh: s(f, "warehouse"), p_product: s(f, "product"), p_qty: num(s(f, "qty")), p_lot: s(f, "lot"), p_expires: s(f, "expires") || null }), "Producción registrada");
}
export async function createOrder(f: FormData) {
  const { sb } = await ctx(); const [wh, product, lot] = s(f, "position").split("|");
  await run(back(f, PATH.orders), () => inv.call(sb, "create_sales_order", { p_wh: wh, p_buyer: s(f, "buyer"), p_product: product, p_lot: lot, p_qty: num(s(f, "qty")) }), "Pedido confirmado y stock reservado");
}
export async function shipOrder(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), () => inv.call(sb, "ship_sales_order", { p_id: s(f, "id") }), "Pedido despachado"); }
export async function cancelOrder(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), () => inv.call(sb, "cancel_sales_order", { p_id: s(f, "id") }), "Pedido cancelado, reserva liberada"); }
export async function setOffer(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.market), () => inv.call(sb, "set_offer", { p_org: org.id, p_product: s(f, "product"), p_qty: num(s(f, "qty")) }), "Stock publicado para tus socios");
}
export async function createInvite(f: FormData) {
  const { sb, org } = await ctx(); let ok = "", err = "";
  try {
    const email = s(f, "email"), token = await inv.call(sb, "create_invitation", { p_org: org.id, p_email: email });
    const link = `${site()}/login?invite=${token}`;
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM, to: email, subject: `${org.display_name} te invita a conectarte`, text: `${org.display_name} quiere conectarse con vos para gestionar pedidos y recepciones digitalmente. Entrá acá: ${link}` }) });
      ok = r.ok ? `Invitación enviada a ${email}. Link: ${link}` : `No se pudo enviar el email. Compartí este link: ${link}`;
    } else ok = `Compartí este link con ${email}: ${link}`;
  } catch (e: any) { err = e.message.replace(/^[A-Z_]+: /, ""); }
  const to = back(f, PATH.partners);
  redirect(`${to}${to.includes("?") ? "&" : "?"}${err ? "e=" + encodeURIComponent(err) : "ok=" + encodeURIComponent(ok)}`);
}
export async function setPrice(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    const raw = s(f, "price"), price = raw === "" ? null : num(raw), per = s(f, "price_per") === "" ? 1 : num(s(f, "price_per"));
    if (price !== null && !(price >= 0)) throw new Error("El precio debe ser un número igual o mayor que cero");
    if (!(per > 0)) throw new Error("«Por cuántas unidades» debe ser mayor que cero");
    const { error } = await sb.from("products").update({ price, price_per: per }).eq("id", s(f, "id")).eq("organization_id", org.id);
    if (error) throw new Error("No tenés permiso para cambiar precios");
  }, "Precio actualizado");
}
// Pedidos de compra: el comprador pide sobre el stock publicado por un proveedor conectado; el proveedor acepta (reserva) o rechaza.
export async function requestPurchase(f: FormData) {
  const { sb, org } = await ctx();
  const [supplier, product] = s(f, "offer").split("|");
  await run(back(f, PATH.orders), () => inv.call(sb, "request_purchase", { p_org: org.id, p_supplier: supplier, p_product: product, p_qty: num(s(f, "qty")), p_note: s(f, "note") || null }), "Pedido de compra enviado al proveedor");
}
export async function acceptPurchase(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), () => inv.call(sb, "accept_purchase_request", { p_id: s(f, "id") }), "Pedido aceptado: el stock quedó reservado y ya podés despacharlo"); }
export async function rejectPurchase(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), () => inv.call(sb, "reject_purchase_request", { p_id: s(f, "id") }), "Pedido rechazado"); }
export async function cancelPurchase(f: FormData) { const { sb } = await ctx(); await run(back(f, PATH.orders), () => inv.call(sb, "cancel_purchase_request", { p_id: s(f, "id") }), "Pedido de compra cancelado"); }
// Editar y eliminar productos / corregir stock (toda corrección de stock queda en el historial con su motivo)
export async function updateProduct(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    const unit = s(f, "unit");
    if (unit !== s(f, "unit_current") && !normUnit(unit)) throw new Error(`Elegí una unidad de medida de la lista (${UNITS.join(", ")})`);
    const price = s(f, "price") === "" ? null : num(s(f, "price")), per = s(f, "price_per") === "" ? 1 : num(s(f, "price_per")), min = s(f, "min_stock") === "" ? 0 : num(s(f, "min_stock"));
    if (price !== null && !(price >= 0)) throw new Error("El precio debe ser un número igual o mayor que cero");
    if (!(per > 0)) throw new Error("«Por cuántas unidades» debe ser mayor que cero");
    if (!(min >= 0)) throw new Error("El stock mínimo no puede ser negativo");
    if (!s(f, "sku") || !s(f, "name")) throw new Error("SKU y nombre son obligatorios");
    const gtinRaw = s(f, "gtin").replace(/[\s-]/g, "");
    if (gtinRaw) { const v = validateGtin(gtinRaw); if (!v.ok) throw new Error(`GTIN: ${v.error}`); if (await gtinTaken(sb, org.id, gtinRaw, s(f, "id"))) throw new Error("Ya existe otro producto con ese GTIN en tu empresa."); }
    const { error } = await sb.from("products").update({ sku: s(f, "sku"), name: s(f, "name"), unit, gtin: gtinRaw || null, min_stock: min, price, price_per: per, iva: ivaOf(f) }).eq("id", s(f, "id")).eq("organization_id", org.id);
    if (error) throw new Error(error.code === "23505" ? (/gtin/i.test(error.message) ? "Ya existe otro producto con ese GTIN en tu empresa" : "Ya existe otro producto con ese SKU") : "No tenés permiso para editar productos");
  }, "Producto actualizado");
}
export async function deleteProduct(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.products), async () => {
    if (!f.get("confirm")) throw new Error("Marcá «Confirmo que quiero eliminarlo» para continuar");
    await inv.call(sb, "delete_product", { p_org: org.id, p_product: s(f, "id") });
  }, "Producto eliminado");
}
async function changeStock(f: FormData, remove: boolean) {
  const { sb, org } = await ctx();
  let msg = "Stock corregido";
  await run(back(f, PATH.products), async () => {
    const note = s(f, "note");
    if (!note) throw new Error("Indicá el motivo de la corrección (queda en el historial)");
    const position = s(f, "position"), [wh, product, lot] = position.split("|");
    const { data: pos, error } = await sb.from("inventory_positions").select("quantity, reserved, lots(lot_number, expiration_date)").eq("warehouse_id", wh).eq("product_id", product).eq("lot_id", lot).maybeSingle();
    if (error || !pos) throw new Error("No se encontró esa existencia");
    const cur = Number(pos.quantity), res = Number(pos.reserved), target = remove ? 0 : num(s(f, "qty"));
    if (!(target >= 0)) throw new Error("La cantidad nueva debe ser un número igual o mayor que cero");
    if (target < res) throw new Error(`Hay ${res} reservados en pedidos y no podés dejar menos que eso. Cancelá o despachá esos pedidos primero.`);
    const diff = Math.round((target - cur) * 10000) / 10000;
    if (diff === 0) throw new Error("La cantidad no cambió");
    const lotRow: any = Array.isArray(pos.lots) ? pos.lots[0] : pos.lots;
    if (diff > 0) await inv.stockIn(sb, { org: org.id, warehouse: wh, product, lot: lotRow.lot_number, qty: diff, type: "ADJUSTMENT", note, expires: lotRow.expiration_date ?? "" });
    else await inv.moveStock(sb, { org: org.id, position, qty: -diff, note, type: "ADJUSTMENT" });
    msg = remove ? "Stock del lote eliminado" : `Stock corregido: de ${cur} a ${target}`;
  }, () => msg);
}
export async function adjustStock(f: FormData) { await changeStock(f, false); }
export async function deleteStock(f: FormData) { await changeStock(f, true); }
