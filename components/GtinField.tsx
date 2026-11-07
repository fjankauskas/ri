"use client";
import { useEffect, useRef, useState } from "react";
import { validateGtin } from "@/lib/gs1/check";
import { prefixInfo } from "@/lib/gs1/prefix";
import { suggestedName, unitFor, type Gs1arProduct } from "@/lib/gs1ar/normalize";
// Campo GTIN con escáner de cámara. Celulares / Chrome en Mac y Android: detector nativo. Windows/Linux: decodificador ZXing.
// También funciona con lectores USB (escriben el código y mandan Enter): el Enter no envía el formulario.
export default function GtinField({ name = "gtin", initial = "" }: { name?: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("Apuntá la cámara al código de barras");
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [ar, setAr] = useState<{ ok: boolean; text: string } | null>(null);
  // Trae los datos oficiales de GS1 Argentina y completa nombre y unidad del formulario (sin pisar lo que ya escribiste).
  const fromGs1 = async () => {
    setBusy(true); setAr(null);
    try {
      const r = await (await fetch(`/api/gs1/ar?gtin=${encodeURIComponent(value.replace(/\D/g, ""))}`)).json();
      if (!r.ok || !r.found) return setAr({ ok: false, text: r.message ?? "No se pudo consultar a GS1 Argentina." });
      const p = r.product as Gs1arProduct, form = wrap.current?.closest("form"), done: string[] = [];
      const setField = (field: string, val: string, onlyEmpty: boolean) => { const el = form?.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement | null; if (!el || !val || (onlyEmpty && el.value)) return false; el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); return el.value === val; };
      if (setField("name", suggestedName(p), true)) done.push("nombre");
      if (setField("unit", unitFor(p), false)) done.push("unidad");
      setAr({ ok: true, text: `GS1 Argentina: ${[p.marca, p.razonSocial, p.estado].filter(Boolean).join(" · ")}${done.length ? ` — se completó: ${done.join(" y ")}.` : "."}` });
    } catch { setAr({ ok: false, text: "No se pudo consultar a GS1 Argentina." }); } finally { setBusy(false); }
  };
  const v = value.trim() ? validateGtin(value) : null, pre = v?.ok ? prefixInfo(value.replace(/\D/g, "")) : null;
  useEffect(() => {
    if (!open) return;
    let stop = false, stream: MediaStream | undefined, controls: { stop: () => void } | undefined;
    const done = (code: string) => { if (stop) return; stop = true; setValue(code.replace(/\s/g, "")); setOpen(false); };
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (video.current) { video.current.srcObject = stream; await video.current.play(); }
          const det = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"] });
          const tick = async () => {
            if (stop || !video.current) return;
            try { const raw = (await det.detect(video.current))[0]?.rawValue; if (raw) return done(raw); } catch {}
            setTimeout(tick, 300);
          };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stop || !video.current) return;
          controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current, (result) => { if (result) done(result.getText()); });
        }
      } catch { setMsg("No se pudo abrir la cámara. Revisá los permisos del navegador o escribí el código a mano."); }
    })();
    return () => { stop = true; controls?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open]);
  return (
    <>
      <div className="gtin" ref={wrap}>
        <label>GTIN / código de barras (opcional)
          <input name={name} value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
        </label>
        <button type="button" onClick={() => { setMsg("Apuntá la cámara al código de barras"); setOpen(true); }}>📷 Escanear</button>
      </div>
      {v && <p className={`text-sm ${v.ok ? "in" : "out"}`} role="status">{v.ok ? `✔ ${v.kind} válido${pre ? ` · ${pre.label}` : ""}` : `✖ ${v.error}`}</p>}
      {v?.ok && <button type="button" onClick={fromGs1} disabled={busy} className="justify-self-start">{busy ? "Consultando…" : "🔎 Completar con datos de GS1 Argentina"}</button>}
      {ar && <p className={`text-sm ${ar.ok ? "in" : "out"}`} role="status">{ar.text}</p>}
      {open && (
        <div className="ov" role="dialog" aria-modal="true" aria-label="Escanear código de barras">
          <div>
            <p role="status">{msg}</p>
            <video ref={video} playsInline muted />
            <button type="button" style={{ marginTop: 10, width: "100%" }} onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
