# Compras, Reportes y Equipo

## Puesta en marcha
1. En Supabase ejecutá `supabase/migrations/0009_compras_reportes_equipo.sql` (después de la 0008). No borra datos y **hay que correrla antes de usar la app nueva**: la ficha de producto ahora guarda el costo.
2. Descomprimí `ri-v9.zip` sobre tu carpeta `ri\` (reemplaza archivos). No hay paquetes nuevos: alcanza con reiniciar `npm run dev`.

## Compras (menú «Compras»)
- **Proveedores:** CUIT validado, contacto, plazo de pago, plazo de entrega, pedido mínimo y condiciones comerciales; opcionalmente se vinculan con una empresa de tu red.
- **Órdenes de compra:** borrador → *autorizada* (requiere el permiso «Autorizar») → recepciones totales o **parciales** → recibida. Cada recepción pide lote y vencimiento, ingresa el stock al depósito y no deja recibir más de lo pendiente.
- **Historial de precios:** se completa solo con cada orden y recepción; también podés cargar cotizaciones a mano. Al crear una orden, el precio se sugiere con el último que pagaste a ese proveedor.
- **Comparador:** último precio de cada proveedor por producto, diferencia con el mejor y variación contra el precio anterior; además, los precios de las empresas conectadas que publican el mismo producto (se vinculan por GTIN).
- **Facturas de proveedores:** cada factura se vincula con su proveedor y con las recepciones que cubre, así se ve qué productos entraron con qué factura. Compara el neto facturado contra el neto recibido y marca las diferencias.
- **Costo promedio:** cada recepción actualiza el costo promedio ponderado del producto (también se puede fijar a mano en la ficha). Alimenta el margen de los reportes.
- Lo que ya existía se conserva: los pedidos de compra entre empresas conectadas siguen en **Red → Pedidos**.

## Reportes (menú «Reportes»)
- **Más y menos vendidos:** ranking por unidades, ingresos o margen; período de 7 días a 1 año; canal consumidores / red / todos.
- **Sin movimiento:** productos con stock sin ventas, envíos ni consumo en 30 días a 1 año; capital inmovilizado a costo.
- **Margen estimado:** ingreso neto menos costo promedio, por producto y en total.
- **Comercio con la red:** enviado y recibido (valor estimado) con cada empresa conectada, y los productos que más salen hacia la red.
- Todos se descargan en CSV.
- **Qué significa «de la red»:** cada empresa ve solo sus propios movimientos, incluidos los que hace con su red. Nunca se muestran ventas, stock ni márgenes internos de otras empresas.
- **Es una estimación:** lo vendido a consumidores usa el precio real neto; lo enviado a la red se valúa a tu precio de lista actual; el costo es el promedio actual (no el del momento de cada venta).

## Equipo (menú «Equipo»)
- **Roles:** Dueño (acceso total, fijo), Administrador, Encargado, Trabajador y Auditor.
- **Permisos independientes** por módulo (Inventario, Ventas, Facturación ARCA, Compras, Red, GS1, Reportes, Usuarios) y por acción: consultar, crear, editar, eliminar y autorizar. Cada empresa puede cambiar los valores recomendados y restablecerlos.
- **Usuarios:** se agregan por email. Si la persona ya tiene cuenta entra al instante; si no, queda invitada y se une sola al registrarse o ingresar con ese email. Se puede cambiar el rol y quitar usuarios (no al dueño, ni a uno mismo).
- **Dónde se aplica:** en la base de datos para Compras, Reportes y Equipo, y en las acciones de Inventario, Ventas, Facturación, Red y GS1. El rol Auditor es de solo lectura también en la base.
- **Límite conocido:** algunas funciones históricas de Red e Inventario siguen verificando el rol histórico (Trabajador equivale a «operador de depósito»). Si un permiso del panel no alcanza para una operación, la base responde «sin permiso»: avisame cuál y la adapto.

## Verificación hecha y pendiente
- Reportes, ranking, márgenes y rangos probados con datos de ejemplo; la matriz de permisos de la base y la de la app se comprobaron idénticas (módulos y acciones); todo el proyecto compila con TypeScript.
- **No ejecutado:** la migración SQL en una base real ni las pantallas en el navegador.
