# API de consulta de GS1 Argentina (V2)

## Puesta en marcha
1. En Supabase ejecutá `0011_gs1_argentina.sql` (después de la 0009).
2. Descomprimí `ri-v11.zip` sobre tu carpeta `ri\` y reiniciá `npm run dev`. No hay paquetes nuevos; usa las mismas variables que ya tenés (`SUPABASE_SERVICE_ROLE_KEY` y `ARCA_ENCRYPTION_KEY`, con la que se cifran las contraseñas).
3. En **GS1 → Configuración → «GS1 Argentina: consulta de productos»** cargá el ambiente, el usuario, el **clientid** y la contraseña que te dio GS1 Argentina (cada ambiente tiene los suyos) y tocá **«Probar conexión»**.
4. Para probar sin gastar consultas reales: ambiente *Pruebas* y el GTIN `7798419930133`, que figura en el manual. El set de datos de pruebas es incompleto.

## Qué hace en la aplicación
- **Alta de producto:** al escribir un GTIN válido aparece «Completar con datos de GS1 Argentina»: completa el nombre y la unidad sin pisar lo que ya escribiste, y muestra marca, empresa titular y estado.
- **GS1 → Lector:** al leer o escanear un GTIN, «Consultar en GS1 Argentina» muestra la ficha oficial completa (producto, clasificación GPC, empresa titular con CUIT y licencia, mercados, imágenes y enlaces). Si el producto no está en tu empresa, ofrece **crearlo con esos datos**; si ya está, **completar su ficha**.
- **GS1 → Productos GS1:** por producto, consulta y completa los datos maestros (marca, contenido neto, país, sitio web, imagen), solo los vacíos salvo que pidas reemplazar. Hay además «Completar fichas» para hacerlo en lote (hasta 25 por vez).
- **Inventario → Ingresar stock:** si escaneás una etiqueta cuyo GTIN no existe, ofrece buscarlo en GS1 Argentina y crear el producto.
- **Caché y registro:** cada consulta se guarda 7 días por empresa (12 horas si GS1 no tenía el producto) para no repetir pedidos; si GS1 no responde se usa la última copia guardada. Las últimas consultas se ven en Configuración. Nunca se guardan contraseñas ni tokens a la vista.
- El token de GS1 dura 24 horas: se reutiliza y se renueva solo si GS1 lo rechaza. Los errores del manual (empresa con deuda, inactiva, sin permisos, GTIN inválido, etc.) se muestran en español claro.

## Lo que el manual no dice (supuestos a confirmar con GS1)
- **Encabezado del token:** se envía como `Authorization: Bearer <token>` (el manual solo dice «en el HEADER» y el token es de tipo *bearer*).
- **Pedido del token:** los datos van en el cuerpo del pedido; como la captura del manual los muestra como parámetros de la URL, si el servidor responde que no los acepta así, se reintenta automáticamente en la URL.
- **Certificado:** se asume que el «certificado (CA) del asociado» lo valida GS1 del lado del servidor (vigencia de la membresía) y que no hace falta instalar un certificado de cliente.
- **GTIN:** se envía tal como está (8, 12, 13 o 14 dígitos), sin completar con ceros.
- Si algo de esto difiere, el error aparece en el registro de Configuración y se corrige en un solo archivo (`lib/gs1ar/client.ts`).

## Verificación hecha y pendiente
- Probado contra un **servidor simulado** armado con los ejemplos del manual: token (en cuerpo y en URL), consulta de GTIN-13 y GTIN-14, productos inexistentes, los 9 mensajes de error, HTTP 500, falta de conexión, token vencido a mitad de consulta y traducción de unidades, país y datos maestros.
- **No probado contra el servicio real de GS1**: no tuve credenciales ni salida a internet. La primera prueba real es «Probar conexión» en el ambiente de pruebas.
- Revisá con GS1 Argentina las condiciones de uso de sus datos e imágenes antes de publicarlos hacia tus clientes.
