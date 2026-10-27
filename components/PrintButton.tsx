"use client";
export default function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="btn btn-green">Imprimir o guardar como PDF</button>;
}
