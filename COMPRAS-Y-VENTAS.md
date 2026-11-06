# Compras y ventas en una sola pantalla

## Puesta en marcha (en este orden)
1. En Supabase ejecutá `0010_red_busqueda_invitaciones.sql` (después de la 0009).
2. Descomprimí `ri-v10.zip` sobre tu carpeta `ri\`.
3. **Borrá las pantallas viejas**, que ya no se usan. En PowerShell, dentro de la carpeta que contiene `ri\`:
   `Remove-Item -Recurse -Force ri\app\sales\_views, ri\app\purchases\_views`
   (Si no las borrás no pasa nada grave, pero quedan archivos muertos.)
4. Reiniciá `npm run dev`. No hay paquetes nuevos.

## Una sola pantalla: «Compras y ventas»
El menú de arriba tiene un solo acceso y el menú de la izquierda se ordena en tres grupos:
- **Ventas:** Ventas · Clientes
- **Compras:** Órdenes de compra · Proveedores · Precios y comparador
- **Facturación:** Facturas (emitidas y recibidas) · Configuración ARCA

Los enlaces viejos (`/sales…` y `/purchases…`) siguen funcionando: redirigen a la pantalla nueva.

## Facturas: emitidas y recibidas juntas
Una sola tabla con todas, filtrable por **sentido** (emitidas a clientes / recibidas de proveedores) y por estado (por pagar, pagadas, anuladas, de prueba). Arriba ves cuatro totales: facturado (producción, sin anuladas ni pruebas), recibido, por pagar y recibidas sin vincular. Al abrir una:
- **Emitida:** CAE, observaciones de ARCA, imprimir, ver la venta y emitir nota de crédito.
- **Recibida:** neto facturado contra neto recibido, productos recibidos con esa factura y marcar como pagada.

## Agregar un cliente o un proveedor
«Nuevo cliente» y «Nuevo proveedor» empiezan con un buscador por **email, teléfono o CUIT**:
1. **Si la empresa ya usa la aplicación:** «Conectar y agregar». Se envía la solicitud de conexión y queda cargada en tu lista, vinculada a su empresa (con su CUIT y razón social).
2. **Si no la encuentra:** «Invitar a usar la aplicación». Se carga en tu lista y se genera un enlace que mandás por **email** o **WhatsApp** (se abre tu correo o WhatsApp con el mensaje listo) o copiás. Cuando se registre con ese enlace, queda conectada con vos y vinculada a ese cliente o proveedor automáticamente.
3. **Cargar sin conectar:** el alta manual de siempre, para quien no va a usar la app.

### Cómo se encuentra a una empresa
- Por **CUIT**: siempre (como ya pasaba al conectar).
- Por **email o teléfono**: solo si la empresa los cargó y lo permite, en Red → Empresas conectadas → «Cómo te encuentran».
- La búsqueda es **exacta** (hay que escribir el dato completo): no se puede recorrer ni listar el directorio. Al buscar por email o teléfono se muestra el CUIT con asteriscos.
- Si intentás invitar a una empresa que ya usa la app, te avisa y te pide que la busques.

## Límites a tener en cuenta
- La app **no envía** los mensajes de invitación: prepara el email y el mensaje de WhatsApp y los abre en tu dispositivo.
- Para que el enlace de invitación sea correcto en producción, configurá `NEXT_PUBLIC_SITE_URL` con la dirección de la app; si no, se arma con la dirección desde la que estás usando la app.
- El número de WhatsApp se normaliza para celulares argentinos de 10 dígitos (área + número); revisá que sea el correcto antes de enviar.
- Verificado: compila todo el proyecto y se probaron los enlaces de invitación. **No ejecutado:** la migración en una base real ni las pantallas en el navegador.
