// Enlaces para compartir una invitación por email o WhatsApp (la app no envía mensajes: abre tu correo o WhatsApp con el texto listo).
/** Número para wa.me: solo dígitos y con código de país. Un celular argentino de 10 dígitos (área + número) pasa a 549… */
export function waNumber(phone: string): string {
  let d = phone.replace(/\D/g, "").replace(/^00/, "");
  if (d.startsWith("54")) return d.startsWith("549") || d.length < 12 ? d : "549" + d.slice(2);
  d = d.replace(/^0/, "");
  return d.length === 10 ? "549" + d : d;
}
export function inviteMessage(from: string, kind: "customer" | "supplier", link: string): string {
  const role = kind === "customer" ? "como cliente" : "como proveedor";
  return `Hola, te invitamos a conectarte con ${from} en Red de Inventario ${role}. Es gratis y en unos minutos podemos operar con pedidos y facturas ordenados. Registrate acá: ${link}`;
}
export const mailtoUrl = (email: string, from: string, message: string) => `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Invitación de ${from} a Red de Inventario`)}&body=${encodeURIComponent(message)}`;
export const whatsappUrl = (phone: string, message: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(message)}`;
