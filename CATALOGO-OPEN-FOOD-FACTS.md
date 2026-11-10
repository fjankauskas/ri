# Catálogo público de Open Food Facts

Catálogo local de productos alimenticios **asociados a Argentina** en Open Food Facts (OFF), identificados por GTIN y con su procedencia. Guarda solo seis datos: GTIN (`code`), nombre (`product_name`), nombre genérico (`generic_name`), marca (`brands`), cantidad (`quantity`) y última modificación en OFF (`last_modified_t`). No se importan nutrición, ingredientes, alérgenos ni imágenes.

## Cómo funciona
| Qué | Cómo | Por qué así |
|---|---|---|
| **Carga inicial y sincronización diaria** | Script `scripts/off-sync.ts` con las **exportaciones oficiales** de OFF (CSV completo y archivos delta diarios), filtrando Argentina localmente | OFF indica que la API es para «1 consulta = 1 escaneo real» y que recorrer la base con la API probablemente se bloquee. No existe una exportación filtrada por país (verificalo con `check`) |
| **Escaneo de un GTIN** | Catálogo local → caché negativa → API v3 de OFF (una consulta por GTIN a la vez) | Es el uso previsto de la API; no bloquea ni rompe el escaneo si OFF falla |

El importador **no corre dentro de la app web** (el CSV pesa ~0,9 GB comprimido): se ejecuta en tu PC, un servidor o GitHub Actions. La app solo lee la base y consulta la API por escaneo.

## Puesta en marcha
1. Supabase: ejecutá `0012_catalogo_open_food_facts.sql` (después de la 0011).
2. Descomprimí `ri-v12.zip` sobre `ri\`.
3. En `.env.local` agregá `OFF_CONTACT_EMAIL=tu@email.com` (se envía en el User-Agent, como pide OFF; **sin él no se consulta a OFF**) y reiniciá `npm run dev`. Las demás variables están en `.env.example`.
4. Verificá las exportaciones: `npx tsx scripts/off-sync.ts check` (no descarga nada: muestra qué URL existe y cuánto pesa).
5. Primera carga (unos minutos, depende de tu conexión): `npx tsx scripts/off-sync.ts full`.
6. Automatizá la corrida diaria (`auto`: completa la primera vez, cada 30 días o si los delta ya no alcanzan; el resto de los días solo aplica los cambios):
   - **GitHub Actions:** copiá `docs/off-sync.workflow.yml` a `<raíz del repositorio>/.github/workflows/off-sync.yml` y cargá los secretos `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `OFF_CONTACT_EMAIL`.
   - **Windows:** Programador de tareas ejecutando `npx tsx scripts/off-sync.ts auto` una vez por día. **Linux:** cron.
7. Controlá todo en **GS1 → Catálogo público** (o `npx tsx scripts/off-sync.ts status`).

## En la app
- **GS1 → Lector:** si el código escaneado no es de ningún producto de tu empresa, muestra lo que dice el catálogo (consultando a OFF si falta) y permite **crear el producto** con nombre, marca y cantidad.
- **Ingreso de stock:** al escanear un GTIN desconocido aparece, sin demorar el escaneo, lo que dice Open Food Facts.
- **Alta de producto:** el botón del GTIN prueba primero GS1 Argentina y, si no está configurado o no lo tiene, el catálogo público.
- Los productos creados con estos datos quedan marcados con su procedencia (`product_gs1.data_source = 'off'`).

## Resultados de la consulta por escaneo
Producto encontrado (local o consultado) · no encontrado (se recuerda 7 días) · límite de consultas · OFF no disponible · respuesta inválida · GTIN inválido · pendiente (otra consulta del mismo código en curso). **Un error externo nunca se interpreta como «no existe».** Después de 3 fallas seguidas se pausa la consulta 2 minutos y se genera una alerta.

## Controles y límites
- Límite propio de 60 consultas por minuto (OFF permite 100), **compartido entre todas las instancias** (se cuenta en la base).
- Timeout de 4 s, hasta 2 reintentos con espera exponencial ante 503 o caídas, y sin insistir ante 429.
- Una sola consulta externa por GTIN aunque lo escaneen varias personas a la vez.
- Una sola sincronización a la vez; una abandonada hace más de 30 minutos se marca como interrumpida. Si falla o se corta, **repetirla la reanuda** sin duplicar.
- **Nunca se borran productos**, aunque dejen de aparecer en una exportación (se conserva su «última aparición»).
- Alertas: importación fallida, caída de más del 10 % en la cantidad de productos, OFF sin respuesta, límite alcanzado y más del 10 % de registros rechazados. Se ven en la pantalla y, si definís `OFF_ALERT_WEBHOOK_URL`, también se envían allí.

## Procedencia y licencia
- OFF publica su base bajo **ODbL 1.0** (y sus contenidos bajo DbCL). Cada registro guarda fuente, licencia, fecha de modificación en OFF, de importación, de actualización local y de última aparición; la leyenda de atribución se muestra junto a los datos.
- Los datos viven en tablas propias (`off_products`), separados de los tuyos y de los de GS1 Argentina; `catalog_sources` declara los derechos de cada fuente para sumar otras en el futuro.
- Que un producto figure asociado a Argentina **no prueba** que hoy se comercialice allí, y un GTIN válido **no** significa que esté registrado en GS1: la pantalla lo aclara.
- **Pendiente de revisión legal antes de comercializar o redistribuir la base:** el alcance de las obligaciones de ODbL (atribución, compartir igual en bases derivadas y combinadas). Seleccionar solo el GTIN y la descripción no las elimina.

## Qué se verificó y qué no
- **Probado con datos de ejemplo (37 pruebas, `npm run test:off`):** GTIN-8/12/13/14, inválidos y ceros iniciales; producto local, remoto, inexistente (caché negativa) y con OFF caído, 429 y 503; nombre vacío, sin marca y duplicados; importación interrumpida y reanudada, reejecución, producto modificado y producto que desaparece; consultas concurrentes; descarga real por HTTP con archivos comprimidos y una descarga cortada a la mitad. Se midió el rendimiento: ~80.000 filas por segundo con memoria constante (+33 MB aun con 1,2 millones de filas).
- **No probado contra Open Food Facts real** (sin acceso a internet). Supuestos tomados de su documentación: CSV con tabuladores y sin comillas, columnas `code`, `last_modified_t`, `product_name`, `generic_name`, `quantity`, `brands` y `countries_tags`; archivos delta con un documento JSON por línea; respuesta 404 de la API v3 para un producto inexistente. Si el formato cambia, la importación falla de forma explícita y avisa; no se «completa» en silencio.
- **Códigos de OFF** de 9 a 11 dígitos, o con dígito de control inválido, se rechazan y quedan en el registro de la ejecución.
- La migración SQL no se ejecutó en una base real.
