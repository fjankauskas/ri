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
            if (id) { location.href = `/trace?lot=${id}`; return; }
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
      <p role="status">{msg}</p>
      <video ref={v} playsInline muted style={{ width: "100%", maxWidth: 420, borderRadius: 8 }} />
      <form action="/trace" className="f" style={{ marginTop: 12 }}><label>Código de lote<input name="lot" /></label><button className="p">Ver lote</button></form>
    </>
  );
}
