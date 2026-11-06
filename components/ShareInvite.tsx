"use client";
import { useState } from "react";
import { inviteMessage, mailtoUrl, whatsappUrl } from "@/lib/invite";
/** Opciones para hacerle llegar la invitación: email, WhatsApp o copiar el enlace. */
export default function ShareInvite({ link, from, kind, email, phone }: { link: string; from: string; kind: "customer" | "supplier"; email?: string; phone?: string }) {
  const [copied, setCopied] = useState(false);
  const msg = inviteMessage(from, kind, link);
  const copy = async () => { try { await navigator.clipboard.writeText(msg); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copiá este texto:", msg); } };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {email && <a className="btn btn-green no-underline" href={mailtoUrl(email, from, msg)}>✉ Enviar por email</a>}
        {phone && <a className="btn btn-teal no-underline" href={whatsappUrl(phone, msg)} target="_blank" rel="noreferrer">💬 Enviar por WhatsApp</a>}
        <button type="button" className="btn btn-gray" onClick={copy}>{copied ? "✔ Copiado" : "Copiar mensaje con el enlace"}</button>
      </div>
      <p className="break-all rounded-lg border border-line bg-surface p-3 font-mono text-xs text-mute">{link}</p>
    </div>
  );
}
