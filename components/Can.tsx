// Oculta formularios de escritura al rol VIEWER (la base de datos igualmente lo impide).
export default function Can({ role, children }: { role: string; children: React.ReactNode }) {
  return role === "VIEWER" ? null : <>{children}</>;
}
