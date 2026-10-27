"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// Escáner de cámara para todos los códigos GS1 (EAN/UPC, ITF-14, GS1-128, DataMatrix, QR). Celulares: detector del navegador; PC: ZXing.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"];
export default function ScanButton({ onCode, label = "📷 Escanear", className = "" }: { onCode: (text: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("Apuntá la cámara al código");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!open) return;
    let stop = false, stream: MediaStream | undefined, controls: { stop: () => void } | undefined;
    const done = (text: string) => { if (stop) return; stop = true; setOpen(false); onCode(text); };
    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (video.current) { video.current.srcObject = stream; await video.current.play(); }
          const det = new BD({ formats: FORMATS });
          const tick = async () => { if (stop || !video.current) return; try { const raw = (await det.detect(video.current))[0]?.rawValue; if (raw) return done(raw); } catch {} setTimeout(tick, 300); };
          tick();
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stop || !video.current) return;
          controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current, (result) => { if (result) done(result.getText()); });
        }
      } catch { setMsg("No se pudo abrir la cámara. Revisá los permisos del navegador (la cámara solo funciona en https o localhost)."); }
    })();
    return () => { stop = true; controls?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, onCode]);
  return (
    <>
      <button type="button" className={className} onClick={() => { setMsg("Apuntá la cámara al código"); setOpen(true); }}>{label}</button>
      {open && (
        <div className="ov" role="dialog" aria-modal="true" aria-label="Escanear código">
          <div>
            <p role="status" className="mb-3 text-sm text-mute">{msg}</p>
            <video ref={video} playsInline muted />
            <button type="button" style={{ marginTop: 10, width: "100%" }} onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </>
  );
}
/** Escanea y abre la dirección indicada con el código en el parámetro `code`. */
export function ScanLink({ href, label, className }: { href: string; label?: string; className?: string }) {
  const router = useRouter();
  return <ScanButton label={label} className={className} onCode={(t) => router.push(`${href}${href.includes("?") ? "&" : "?"}code=${encodeURIComponent(t)}`)} />;
}
