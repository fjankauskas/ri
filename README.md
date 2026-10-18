# Red de Inventario — MVP

Next.js 15 (App Router) + Supabase (Auth, PostgreSQL, RLS). El stock solo se modifica con funciones SQL transaccionales.

## Puesta en marcha
1. Creá un proyecto en supabase.com.
2. En el SQL Editor ejecutá, en orden, `supabase/migrations/0001_schema.sql`, `0002_ops.sql` y `0003_features.sql` (o pegá `schema.sql`, que las junta).
3. En Authentication > Providers dejá Email activo (para probar rápido, desactivá "Confirm email").
4. `cp .env.example .env.local` y completá URL y clave anon/publishable (Project Settings > API). `NEXT_PUBLIC_SITE_URL` es la URL pública (para los links de invitación).
5. `npm install && npm run dev` → http://localhost:3000
6. Deploy: importá el repo en Vercel y cargá las mismas dos variables.

## Probar la cadena completa
Registrá dos usuarios (dos navegadores), cada uno con su empresa y CUIT. Empresa A: crea un producto, ingresa stock,
envía solicitud de conexión al CUIT de B. B acepta. A despacha, B confirma la recepción (puede recibir menos: la diferencia queda registrada).
`inventory_drift` debe devolver 0 filas (el panel Resumen muestra "verificado").

## Seguridad
- RLS en todas las tablas; sin INSERT/UPDATE/DELETE directos sobre inventario, eventos, envíos ni auditoría.
- Nunca uses la `service_role` key en el navegador.

## Qué incluye
Productos, depósitos, lotes con vencimiento, importador CSV, transferencias, ajustes, recetas y producción (consume primero lo que vence antes),
pedidos con reserva, envíos y recepción con diferencias entre empresas, conexiones por CUIT o invitación por email, stock publicable,
cumplimiento de proveedores, alertas de stock bajo y vencimientos, trazabilidad bidireccional entre empresas, QR por lote + escáner de cámara,
roles (VIEWER solo lectura), exportación EPCIS 2.0 en `/api/epcis`.

## Pendiente
Webhooks y API keys para ERP, envío programado de alertas por email y conectores a ERP/ARCA. EPCIS usa identificadores provisorios (mapear SKU→GTIN y depósito→GLN).
