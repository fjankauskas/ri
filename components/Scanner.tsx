"use client";
import { useEffect, useRef, useState } from "react";
export default function Scanner() {
  const v = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState("Apuntá la cámara al QR del lote");
  useEffect(() => {
    let stop = false, stream: MediaStream | undefined;
    (async () => {
      const BD = (window as any).BarcodeDetector;
      if (!BD) return setMsg("Este navegador no puede escanear QR. Pegá el código del lote abajo.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (v.current) { v.current.srcObject = stream; await v.current.play(); }
        const det = new BD({ formats: ["qr_code"] });
        const tick = async () => {
          if (stop || !v.current) return;
          try {
            const raw = (await det.detect(v.current))[0]?.rawValue;
            const id = raw && new URL(raw, location.origin).searchParams.get("lot");
            if (id) { location.href = `/inventory?v=trace&lot=${id}`; return; }
          } catch {}
          setTimeout(tick, 400);
        };
        tick();
      } catch { setMsg("No se pudo abrir la cámara. Revisá los permisos del navegador."); }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (
    <>
      <p role="status" className="mb-3 text-sm text-mute">{msg}</p>
      <video ref={v} playsInline muted className="w-full rounded-lg bg-black" />
      <form action="/inventory" className="f" style={{ marginTop: 12 }}><input type="hidden" name="v" value="trace" /><label>Código de lote<input name="lot" required /></label><button className="btn btn-green">Ver lote</button></form>
    </>
  );
}
