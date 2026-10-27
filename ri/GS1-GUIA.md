# GS1 en Red de Inventario

## Puesta en marcha
1. En Supabase ejecutá `supabase/migrations/0008_gs1.sql` (después de la 0007). No borra datos.
   - Si avisa que hay GTIN repetidos dentro de una empresa, corregilos y creá después el índice `products_org_gtin_unique` (el aviso trae el nombre).
   - Los controles de dígito de control se agregan como «not valid»: no tocan los datos viejos, pero un producto con un GTIN inválido no se podrá modificar hasta corregirlo.
2. Descomprimí `ri-v8.zip` sobre tu carpeta `ri\` (reemplaza archivos).
3. En PowerShell, dentro de `ri\`: `npm install` (agrega `bwip-js`, necesario para DataMatrix, DataBar y GS1 QR) y luego `npm run dev`.
4. En GS1 → Configuración cargá el prefijo de empresa que te asignó GS1 Argentina (o trabajá con códigos internos).

## Qué incluye (menú «GS1»)
| Sección | Qué hace |
|---|---|
| **Productos GS1** | GTIN de cada producto (validado con el dígito de control, único por empresa), asignación automática (con tu prefijo o internos), presentaciones caja/pallet con GTIN-14, datos maestros y % de completitud, exportación CSV/JSON-LD. |
| **Códigos y etiquetas** | EAN-13, EAN-8, UPC-A, ITF-14, GS1-128, GS1 DataMatrix, GS1 QR, QR con GS1 Digital Link y GS1 DataBar (omni, limitado, expandido, apilado). Descarga en SVG a escala real y hoja A4 de etiquetas. |
| **Lector y decodificador** | Escaneo por cámara o pegado de cualquier código: interpreta los identificadores de aplicación (708 AI), valida dígitos de control y fechas, y lo relaciona con tus productos, lotes, stock y envíos. |
| **Ubicaciones y logística** | GLN de la empresa y de cada depósito, SSCC por envío y etiqueta logística GS1 (100 × 150 mm), búsqueda de envío por SSCC. |
| **EPCIS y datos** | Exportación EPCIS 2.0 (JSON-LD) con LGTIN, SGLN y vocabulario CBV; eventos de transformación para la producción; fichas en CSV/JSON-LD. |
| **Configuración** | Prefijo, GLN, páginas públicas y estado de la implementación. |

Integraciones en el resto de la app: el campo GTIN valida en vivo; **Ventas** permite agregar productos escaneando; **Inventario → Ingresar stock** completa producto, lote, vencimiento y cantidad al escanear una etiqueta GS1; y las rutas `/id/01/{GTIN}/10/{lote}` son el resolvedor público (el QR de Digital Link).

## Páginas públicas
Están **apagadas** por defecto. Al activarlas en Configuración, cualquiera que escanee el QR ve: nombre, marca, imagen, contenido, origen, vida útil y el lote/vencimiento. **Nunca** se muestran stock, precios ni datos de clientes.

## Qué NO incluye (requiere membresía o acceso de GS1)
- Prefijo y certificado de empresa (los emite GS1 Argentina).
- Sincronización GDSN / catálogos de GS1, GEPIR, Verified by GS1 y verificación de calidad de impresión (ISO/IEC 15416).
- Unidades logísticas con varios productos (pallets mixtos) y serialización de cada unidad (SGTIN): hoy el SSCC es por envío.
- Clasificación GPC completa: se carga el código de 8 dígitos; el catálogo de bricks no está incluido.
- Reglas de negocio de etiquetas de peso variable (balanza) propias de cada cadena: se incluye el constructor básico en la biblioteca.

## Verificación hecha
- Códigos lineales leídos con ZBar (decodificador real); SVG finales rasterizados y leídos.
- Dígitos de control, AI, Digital Link y EPC contra ejemplos de las especificaciones GS1.
- **No verificado:** la salida de DataMatrix/DataBar/GS1 QR (la dibuja `bwip-js`; probá escanear la pantalla con tu celular antes de imprimir una tirada) y el EPCIS contra un validador oficial.
- La migración SQL no se ejecutó en una base real.
