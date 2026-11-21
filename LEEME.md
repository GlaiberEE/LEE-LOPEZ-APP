# Elevated Exteriors — App interna v1.4.1

Una app para manejar la compañía: obras, tareas, gastos, subcontratistas, change orders y pagos de clientes. Cada persona entra con su propio usuario y ve solo lo que le corresponde.

## Cómo abrirla (Windows)

1. Instale **Node.js LTS** desde https://nodejs.org (versión 22.13 o más nueva). Solo se hace una vez.
2. Doble clic en **`INICIAR_WINDOWS.cmd`**. Se abre el navegador en `http://localhost:8090`.
3. La primera vez le pide crear la cuenta del dueño. Después, en **Equipo y accesos**, cree la cuenta de Jack (rol Dueño), las de trabajadores y subs, y las de clientes.
4. Para cerrar la app, cierre la ventana negra.

**¿Quiere practicar primero?** Doble clic en `PROBAR_CON_DATOS_DE_EJEMPLO.cmd`. Abre la app con obras ficticias en otra carpeta (`datos-demo`), en `http://localhost:8091`. Usuarios: `dueno`, `jack` (dueño con Ventas), `mario` (project manager), `vero` (vendedora), `pedro`, `luis`, `cliente`, y en JKL Homes `tilepro` (sub); la contraseña de todos es `demo-demo-123`. Cada vez que lo abre se reinicia desde cero.

No hay que instalar nada más: no usa `npm install` ni paquetes externos.

## Qué ve cada quien

| | Dueño (Glaiber, Jack) | Trabajador / Sub | Cliente |
|---|---|---|---|
| Inicio | Todo + Hoy + Ventas (si la prende) | Sus obras y sus próximas tareas | Su proyecto, materiales y galería |
| Obras | Todas | Solo donde tiene tareas asignadas | Solo la suya |
| Tareas | Crea, asigna, ordena | Marca avance en **sus** tareas, agrega notas | Ve el avance |
| Fotos | Sube y borra | Sube fotos | Las ve |
| Gastos | Todo, con recibos | Registra compras (no ve totales) | Nunca |
| Dinero de la obra | Todo | Nunca | Solo precio, change orders, sus pagos y saldo |

## Nuevo en v2.2.2: lista para la nube

- `render.yaml`: configuración para publicar la app en Render con un disco que no se borra (`/data`).
- Primer dueño desde internet: si existe la variable `SETUP_CODE`, la pantalla de primera vez pide ese código. Sin el código nadie puede crear el primer dueño.
- `TRUST_PROXY=1`: detrás del proxy de la nube, los intentos fallidos de entrar se cuentan por la IP real de cada persona.
- La app arranca dando permisos a la carpeta de datos y corre sin permisos de administrador (`docker-entrypoint.sh`).

## Nuevo en v2.2.1: botón de Ayuda

En el menú (abajo) y en el teléfono (el botón **?** de arriba) está la **Ayuda**. Muestra solo los temas de quien la abre (dueño, project manager, vendedor, sub o cliente), primero los de la pantalla donde estaba, con los pasos en español o inglés y un buscador. Para cambiar o agregar temas: archivo `public/help.js`.

## Nuevo en v2.2: dos empresas, partidas, reparto, importar sus Excel y agentes de AI

**Dos empresas separadas (Elevated Exteriors y JKL Homes).** Cada empresa tiene su propia información: obras, clientes, subs, gastos, ventas, reportes y respaldos. Nada se ve de una empresa en la otra.
- Para activar JKL Homes: arriba del menú toque **🏢 Elevated Exteriors ▾ → JKL Homes → Activar**. Se copian los dueños con el mismo usuario y contraseña, y la empresa empieza vacía.
- Quien tenga el mismo usuario y contraseña en las dos empresas entra a las dos de una vez y cambia con ese botón. Un sub que solo trabaja con JKL entra directo a JKL.
- Los PDFs y mensajes dicen el nombre de la empresa en la que está. JKL se ve con el menú azul marino.
- Formulario web de cotización de JKL: `https://SU-DIRECCION/cotizar.html?co=jkl`.
- Cada empresa guarda sus datos en su carpeta: Elevated Exteriors en `datos`, JKL Homes en `datos/empresas/jkl` (la lista está en `datos/empresas.json`).

**Partidas (lo que se vendió).** Obra → pestaña **Partidas**: cada renglón (PC-01 Patio cover, ATTCH-01, ELECT-01…) con vendido, gastado, lo que falta pagar a sus subs, costo y margen.
- Cada gasto y cada sub se asigna a una partida; los pagos e invoices de un sub caen solos en su partida.
- El **margen proyectado** cuenta lo que todavía falta pagar a los subs, así que es realista desde el primer día aunque no hayan llegado los recibos.
- Partidas de **pase directo** (como sprinklers): se le cobra al cliente lo que cueste de verdad; si quedan en negativo, la app le recuerda cobrarlo.
- Tipos nuevos para interiores: remodelación de baño, de cocina y remodelación interior.

**Alerta de margen (35%).** En Inicio, "Margen: revisar" muestra las obras con margen menor a 35%, las partidas en negativo y las obras con margen sospechosamente alto (casi siempre faltan costos por anotar). El porcentaje se cambia en Reportes.

**Reparto de ganancia.** Normal: Jack 35%, Glaiber 35% y la empresa 30%. Se cambia en **Reportes → Reparto normal y alerta de margen** (por ejemplo, si entra un PM con porcentaje) y también por obra (como Twin Lakes). En Reportes: total por persona en el año, real (obras terminadas) y proyectado (obras activas). Solo lo ven los dueños.

**Margen por oficio** (su TRADE_CONTROL): en Reportes, todos los oficios de todas las obras con vendido, costo y margen. En rojo los de menos de 35%.

**Importar sus libros de Excel.** Obras → **📥 Importar de Excel**. En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx). Puede subir varios a la vez.
- Lee PROJECT_INFO, TRADES/SCOPE, MATERIALS (cada renglón del ticket, agrupado por ticket), SUBCONTRACTORS (lo acordado y los pagos CHECK1/CHECK2), SALES (change orders), SCHEDULE, DOCUMENTS (enlaces), ISSUES y FINAL_REVIEW.
- Primero muestra un resumen con avisos (por ejemplo, si el total vendido no cuadra con las partidas). Usted marca qué subs ya están pagados completos: los que dicen Zelle, cheque o "paid" ya vienen marcados; los que dicen "NOT a payment" no.
- No importa dos veces la misma obra (usa el PROJECT ID).
- Obra → **Datos**: documentos (enlaces), **lecciones aprendidas** y **revisión final** (¿fue rentable?, estrés, qué funcionó y qué no).

**Agentes de AI (Grok, ChatGPT, Claude…).** Equipo y accesos → **🤖 Agentes**.
- Cree un agente: **Operador de obras** (como un PM que ve todas las obras) o **Vendedor**. Créele una **llave** de solo lectura o de lectura y escritura; se muestra una sola vez. Péguela en su bot como encabezado `Authorization: Bearer <llave>`.
- **Instrucciones para el bot**: texto listo para pegar y formato OpenAPI (para "Actions" o "function calling").
- Mismas reglas que una persona: lo que mueve dinero queda esperando a un dueño, y todo queda en el Historial con 🤖. Un agente nunca puede cambiar usuarios, reparto, ajustes, importar ni autorizar. La llave solo sirve en su empresa. Se puede quitar o apagar al agente en cualquier momento.
- Cuidado: un agente puede equivocarse o dejarse engañar por un texto (un correo o PDF que diga "haz esto"). Empiece con llaves de solo lectura.

## Nuevo en v2.1: recuperar usuario o contraseña

1. En la pantalla de entrada, la persona toca **“¿Olvidó su usuario o contraseña?”** y escribe su nombre, su usuario o su teléfono.
2. A los dueños les llega una notificación y en **Inicio** aparece "Pidieron recuperar su acceso", con el nombre y el usuario de la persona. Si la app no sabe quién es, ustedes la eligen de la lista.
3. **Dar contraseña temporal**: la app crea una contraseña que vale **24 horas** y abre WhatsApp (o SMS) con el mensaje listo, en el idioma de la persona: el enlace de la app, su usuario y la contraseña temporal. También se puede dar desde **Equipo y accesos → ✎ → 🔑 Contraseña temporal**.
4. Al entrar con la temporal, la app **obliga a poner una contraseña propia** antes de dejarla hacer cualquier cosa.

Seguridad: la pantalla de entrada nunca dice si un usuario existe; hay límite de pedidos; solo los dueños dan contraseñas temporales (un PM no puede); dar una contraseña temporal cierra las sesiones abiertas de esa persona y queda en el **Historial**. Si a un dueño se le olvida, el otro dueño le da la temporal. Si los dos dueños pierden el acceso, en la computadora o servidor de la app se corre `node crear-dueno.js usuario "Nombre"` para crear un dueño nuevo (no se pierde nada).

## Nuevo en v2.0: ventas, tablero del día, plan con AI, materiales y reporte de PMs

**Herramientas según el papel de cada persona.** Al crear un usuario se elige su papel y la app le arma su inicio y su menú:
Dueño (todo) · Project manager (sus obras) · **Vendedor (nuevo)** · Trabajador / Sub · Cliente.
Además, a cualquier dueño o PM se le puede prender la herramienta **Ventas** (Equipo y accesos → ✎ → "Herramienta de Ventas"). Así, por ejemplo, Jack sigue siendo dueño y también tiene su agenda y sus estimados.

**Ventas** (menú Ventas, o el inicio del vendedor):
- **Mi día:** citas de hoy (con dirección para Maps y teléfono), los clientes a los que toca llamar (en rojo si ya se pasó la fecha), clientes nuevos por atender (los de la página web llegan solos) y los próximos 7 días.
- **Clientes y estimados:** tablero Nuevos → Con cita → Estimado enviado → Ganados → Perdidos, con buscador.
- Botones en cada cliente: Llamé · Mensaje · Cita · Envié estimado (pide el monto y pone el seguimiento a 3 días) · Ganado (pasa a obra activa y avisa a los dueños) · Perdido (pide el motivo: precio, tiempo, otra compañía…).
- **Agenda:** 30 días de citas. La app manda aviso al teléfono 1 hora antes de cada cita y cada mañana con cuántas citas y llamadas hay.
- El vendedor **solo ve sus clientes y el monto de sus estimados**. Nunca ve costos, gastos, ganancias ni otras obras. Los dueños ven todo y asignan vendedor.

**Hoy** (dueños y PMs): por cada obra activa, qué paso va ahora, cuál sigue y quién es el siguiente sub, con su estado (sin avisar / avisado / confirmó). Botón **Avisar**: le llega notificación al sub y se abre el WhatsApp con el mensaje ya escrito en su idioma. Arriba, lo pendiente de la empresa: autorizaciones, inspecciones de la semana, invoices por revisar, casos, tickets. El sub ve "Mis próximas tareas" con el botón **Confirmo que voy**; si cambian la fecha, tiene que volver a confirmar.

**Plan de trabajo con AI** (obra → Tareas): suba el estimado o invoice (PDF o foto) y la AI propone las tareas en orden, los días, las inspecciones, el material a pedir y qué sub hace cada una. Usted cambia nombres, días, orden y quién lo hace; las fechas se recalculan solas (sin domingos; sábados si se marca). Se guarda en el calendario y se puede **guardar como plantilla** para que la AI la use de guía en obras parecidas. Usa la misma clave `ANTHROPIC_API_KEY` que el escaneo de tickets; sin clave, propone el plan base del tipo de proyecto.

**Materiales y galería** (menú Materiales, todos los papeles): catálogo con buscador por nombre, color o marca, filtros por zona (ceiling, fascia, stain, cubierta de cocina…), foto de cerca (close-up) y fotos de trabajos terminados donde se usó. En cada obra, pestaña **Materiales**: la ficha de qué material y color va en cada parte; el cliente la ve en su portal. **Al marcar la obra como Terminado, las fotos de la última semana y de las tareas finales entran solas a la galería**, y también cualquier foto que se suba después. Recibos y fotos de casos nunca entran. Con ★ se quita o se pone una foto. En la galería no aparece el nombre ni la dirección del cliente.

**Project managers** (menú, dueños): reporte del día de cada PM (lo que la app registró que hizo + su nota de fin de día: qué hizo, problemas, qué sigue) y **calificación del mes** de 1 a 5, explicada por partes: puntualidad 20%, presupuesto 20%, calidad/retrabajo 15%, calificación del cliente 20%, disciplina (notas diarias) 10% y la evaluación de los dueños 15%. Historial de 6 meses. El PM no ve su calificación. El cliente califica su proyecto con estrellas al terminar.

## Nuevo en v1.9: Project Managers con controles y contrapesos

Para cuando haya project managers (o cualquier persona con autoridad intermedia) sin que nadie se beneficie solo ni la empresa pierda el control del dinero.

**Crear un PM:** Equipo y accesos → + Usuario → rol **Project manager**. Ahí se ponen su **límite por gasto** (por ejemplo $500) y su **límite al mes** (por ejemplo $5,000). **Asignarle obras:** en cada obra → Editar obra → *Project manager a cargo*.

**Qué SÍ puede hacer el PM (solo en sus obras):** tareas y calendario, fotos, casos con el cliente y los subs, reporte diario, permisos, escanear tickets, gastos dentro de su límite, registrar pagos que entran del cliente, crear change orders (pendientes), aprobar invoices o estimados de subs dentro de su límite.

**Qué pasa SIEMPRE por un dueño (le llega como solicitud con su motivo):**
- Cualquier gasto arriba de su límite, o que pase su límite del mes.
- Gastos **partidos** (varios del mismo día y la misma tienda que juntos pasan su límite).
- **Reembolsos a su propio nombre** (lo pagó con su dinero).
- **Pagos a subs** (de cualquier monto) y marcar invoices como pagados.
- Aprobar change orders, cambiar el precio de la obra, cancelarla, cambiar el acceso del cliente, cambiar presupuestos.
- Cambiar o borrar **cualquier** registro de dinero, aunque sea de $1.
- Aprobar cualquier cosa de un sub **relacionado** con él (en Equipo, al editar al sub: *¿Es familiar o socio de un project manager?*).

**Qué NO puede hacer nunca:** ver obras que no son suyas, ver Cuentas, Reportes, Proyecciones, Horas, el historial completo, usuarios, ajustes, cerrar o reabrir periodos, cambiar límites (nadie puede cambiar los suyos), asignarse obras, borrar recibos ni borrar obras. Tampoco puede autorizar solicitudes.

**Vigilancia para los dueños:** en Inicio, la tarjeta **Project managers (últimos 30 días)** muestra cuánto gastó cada uno, qué aprobó, cuánto lleva del mes y **alertas** 🚩: muchos gastos justo debajo del límite, reembolsos a su nombre, más del 80% del mes usado, solicitudes rechazadas. Todo queda en el Historial de cambios.

**Los dueños también tienen contrapesos:** cambios de $1,000 o más y los **reembolsos a un dueño** los autoriza el otro dueño.

## Nuevo en v1.8: seguridad para cambiar lo que ya se registró

Para que no haya conflictos ni dudas entre los dueños, el contador, los subs o los clientes:

1. **Motivo obligatorio.** Para cambiar o borrar algo de dinero ya registrado, la app pide escribir el motivo. Aplica a pagos de clientes, pagos a subs, gastos, change orders ya aprobados, el precio de una obra ya contratada, lo acordado con un sub y las horas.
2. **Dos dueños desde $1,000.** Si el cambio es de $1,000 o más, no se aplica hasta que el otro dueño lo autoriza en Inicio → *Cambios por autorizar*. Ahí ve qué se quiere cambiar (antes → después), quién lo pide y por qué. Con un "No autorizar" no cambia nada. Nadie se autoriza a sí mismo. **Borrar una obra** siempre necesita al otro dueño. Le llega una notificación al otro dueño. Si en la app solo hay un dueño activo, basta con el motivo.
3. **Historial de cambios.** Todo lo que se registra, cambia o borra de dinero queda guardado: quién, cuándo, cómo estaba antes, cómo quedó y el motivo. Se ve en *Historial* (menú) o desde la pestaña Datos de cada obra. **No se puede borrar.**
4. **Cierre de periodo.** En Mi cuenta → *Cierre de periodo*: cuando el contador revise un mes (o lo exporten a QuickBooks), ciérrenlo. Nada con esa fecha o antes se podrá crear, cambiar ni borrar. Para reabrir se necesita al otro dueño.
5. **Choques.** Si dos personas editan lo mismo al mismo tiempo, el segundo cambio se rechaza y la app pide recargar, para no pisar el trabajo del otro. Si un cambio esperaba autorización y mientras tanto el registro cambió, **no se aplica** y hay que pedirlo de nuevo con los datos actuales.

Lo que no es dinero (descripciones, fechas de tareas, notas, fotos) se sigue cambiando normal, sin pedir motivo.

## Nuevo en v1.7.1: pagos parciales a subs

- En la pestaña **Subcontratistas** de la obra, botón **+ Pago** en cada sub. En cada pago se registra:
  **monto** (puede ser parcial), **fecha**, **forma de pago** (Zelle, Cheque, Depósito directo, Transferencia, Efectivo, Tarjeta, Otro), **referencia** (# de cheque, confirmación de Zelle o del depósito), nota y foto del cheque o comprobante.
- **Aplicar a:** un **invoice** aprobado (se van restando los pagos y cuando se completa queda *Pagado* solo) o el **acuerdo de la obra** (pagos sin invoice: anticipos, avances).
- Pagar un invoice **no suma otro gasto** (el invoice ya es gasto de la obra). Un pago al acuerdo **sí** es gasto y la ganancia se recalcula.
- También se paga desde el invoice: ábralo → **Registrar pago**. Ahí se ve *Pagado $X de $Y* y la lista de pagos.
- Cada pago se puede borrar (✕) si se registró mal. Un invoice con pagos ya no se puede corregir: para una diferencia, el sub manda un invoice nuevo.
- Después de registrar, la app ofrece mandarle al sub un WhatsApp en su idioma: cuánto se le pagó, cómo, cuánto lleva pagado y cuánto falta.
- El sub ve todo en **Mis pagos** (fecha, forma de pago, referencia) y en el PDF de su estado de cuenta. El PDF del invoice también lista los pagos.
- Los pagos registrados en versiones anteriores se pasan solos a este registro al actualizar.

## Nuevo en v1.7

### 💵 Estado de cuenta del cliente
- En la pestaña **Pagos** de cada obra: todos los movimientos (precio del proyecto, change orders aprobados, pagos recibidos) con el **saldo después de cada uno**, % pagado, **PDF** y botón **Mandar saldo al cliente** por WhatsApp (en su idioma).
- El cliente ve lo mismo en su app (**Su cuenta**) y puede descargar el PDF. Nunca ve costos. Los change orders pendientes no se suman hasta aprobarse.

### 👷 Estado de cuenta de los subs
- Menú **Cuentas**: todos los clientes (cuánto pagaron y cuánto deben, último pago, aviso si pasaron más de 30 días) y todos los subs (acordado, pagado, cuánto se les debe y **invoices aprobados por pagar ya**), con el detalle por obra, PDF y mensaje para el sub.
- **Pagado** = pagos directos al sub + invoices marcados como pagados. Para que cuadre: cuando le paguen un invoice, márquenlo como pagado (no agreguen además un pago aparte).
- Cada sub tiene **Mis pagos** en su app: lo acordado, lo pagado y lo que se le debe en cada obra, con PDF. Solo ve lo suyo.

### 📈 Proyecciones
- Menú **Proyecciones**: ventas nuevas, cobros, ganancia y obras de los próximos **3, 6 o 12 meses**, cada número con su **rango** (lo más probable, y entre qué valores caen 8 de cada 10 futuros).
- Cómo calcula: hace 2,000 simulaciones con su historial. Usa la probabilidad de cierre **por origen** (referido, Google, web…), los prospectos que llegan por mes y la **temporada**, el tamaño y el margen típico **por tipo de proyecto**, los días que tardan en firmar, la duración de las obras y el anticipo. Toma en cuenta los prospectos y estimados abiertos y lo que falta cobrar de las obras activas.
- Avisa de **meses flojos de efectivo** (probabilidad de gastar más de lo que entra) y de **saturación** (ponga su capacidad: cuántas obras pueden llevar al mismo tiempo).
- **Escenarios:** "¿qué pasa si cerramos 10% más, llegan menos prospectos, subimos precios o sube el material?".
- **Importar historial:** para que sea confiable necesita historial. En Proyecciones → *Importar historial* descargue la plantilla, llénela en Excel con las obras y prospectos de los últimos 1–2 años (también los que **no** se cerraron) y guárdela como CSV. Columnas: fecha_prospecto, fecha_cierre, fecha_terminado, cliente, tipo, origen, precio, costo, cerrado (si/no). Se puede borrar y volver a importar cuando quieran.
- La app indica la **calidad de los datos** (poca / media / buena). Con poco historial los rangos son amplios. Es una ayuda para decidir, no una garantía.
- El demo trae 18 meses de historial inventado para que vean cómo se ve; en su app real empieza vacío.

## Nuevo en v1.6

### ✍️ Firma del cliente y pago en línea
- Si la obra está en **Prospecto** o **Cotizado**, tiene precio y el cliente tiene acceso, el cliente ve **"Firmar estimado"** en su app. Firma con el dedo, escribe su nombre y acepta firmar electrónicamente.
- Los **change orders pendientes** también los aprueba y firma el cliente desde su teléfono: al firmar quedan **aprobados** y se suman al contrato.
- La firma sale en el **PDF** con nombre, fecha, IP y un código de verificación. Si después cambian el precio o la descripción, la firma deja de valer y la app pide firmar otra vez.
- **Pago en línea (APAGADO al instalar):** el cliente no ve nada de pagos hasta que un dueño lo active en Mi cuenta → Ajustes de la empresa → *Pagos en línea: Activados*. Ahí mismo ponga un *link de pago* (Stripe Payment Link, Square o QuickBooks Payments) y otras formas de pago (Zelle, cheque). También puede poner un link distinto por obra. El cliente ve **"Pagar en línea"**. El pago se registra en la app cuando ustedes lo confirman (la app no cobra ni guarda tarjetas).

### 📊 Presupuesto por categoría
- Pestaña **Presupuesto** de cada obra: cuánto planean gastar en material, subs, permisos, mano de obra, etc. Barras de gastado contra presupuesto y ganancia planeada.
- Aviso (notificación y tarjeta en Inicio) cuando una categoría llega al **90%** y cuando se **pasa**.

### ⏱️ Reloj de entrada y salida con GPS
- El trabajador marca **entrada** y **salida** desde Mis obras. La app guarda la ubicación y marca si checó **lejos de la obra**.
- Para eso, en la pestaña **Datos** de la obra toque *"Estoy en la obra: guardar ubicación"* una vez.
- En **Horas** (menú) ven quién está trabajando, las horas de cada quien, los que **olvidaron marcar salida**, y pueden corregir horas.
- **Pago por hora** (solo lo ven los dueños): con eso las horas se suman solas como gasto de **Mano de obra** en la obra. A los subs con precio cerrado déjenlos en $0.

### 🔍 Permisos e inspecciones
- Pestaña **Permisos** en cada obra: permisos e inspecciones con número, estado y fecha. En Inicio salen las próximas y las atrasadas. Los subs ven las inspecciones de sus obras (sin las notas).

### 📅 Reporte diario con fotos
- Pestaña **Reporte diario**: qué se hizo hoy, cuadrilla, clima y fotos. El cliente lo ve en su app y le llega notificación. Las notas internas nunca las ve.

### ⭐ Garantía, mantenimiento y reseñas
- Cuando una obra se marca **Terminado** con su fecha, la app recuerda: a la semana **pedir reseña y referidos**, a los 6 meses **revisión de mantenimiento**, y a los 11 meses **la garantía vence pronto**. Mensaje listo para WhatsApp en el idioma del cliente (ponga su link de reseñas de Google en Mi cuenta).

### 🌐 Prospectos desde su página web
- Formulario público en `https://SU-DIRECCION/cotizar.html` (español/inglés). Pónganlo como botón "Pida su cotización" en su sitio web (o dentro de la página). Cada solicitud llega como **prospecto nuevo** con notificación. Tiene protección contra robots y spam.

### 💰 Reportes: ganancia por tipo de proyecto
- Menú **Reportes**: ganancia y margen por tipo (patio cover, cocina, fogón…), promedio por obra, retrabajo, y **de dónde vienen los clientes** (prospectos, cerrados, % de cierre, cuánto vendió cada medio).

### 📤 QuickBooks (opción a futuro) y exportar
- En Reportes: **exportar CSV** de gastos, pagos de clientes, invoices de subs (bills) y horas, para QuickBooks, Excel o el contador. Protegido contra fórmulas peligrosas.
- **Conexión directa con QuickBooks Online:** queda como opción a futuro (botón "próximamente"). Cuando decidan hacerlo, se necesita una cuenta de QuickBooks Online y registrar la app con Intuit; los datos ya están organizados para eso.

### 🔔 Notificaciones push
- Mi cuenta → **Activar notificaciones** (cada persona, en cada teléfono). En Android funciona directo; en **iPhone** primero hay que instalar la app en la pantalla de inicio (iOS 16.4 o más nuevo).
- Avisan de: casos nuevos y respuestas, estimados/invoices de subs, permisos para corregir, decisiones, cambios de fecha, tickets por asignar, prospectos web, firmas de clientes, presupuesto al límite, reporte diario (al cliente).
- Necesitan que la app esté en internet con **https** (Render/Railway lo dan). En la computadora local no llegan a teléfonos.

## Escanear tickets (nuevo en v1.5)

- En el teléfono hay un botón verde **Escanear** (abajo a la derecha). Toma foto del ticket (o varios) o sube un PDF.
- **Código de obra:** cada obra tiene un código, por ejemplo **EE-0001**. Al pagar en Home Depot / Lowe's, den ese código como *Job name* o *PO*. Sale impreso en el ticket y la app lo archiva sola en esa obra.
- Si no trae el código, la app busca la **dirección** de la obra o el **nombre del cliente** en el ticket. Si el sub solo tiene una obra activa, va a esa.
- Cuando la app está segura, el gasto se guarda solo (con la foto como recibo) y la ganancia se recalcula. Si no está segura, queda **Por asignar**: el dueño lo ve en Inicio y lo asigna con un toque. Si se fue a la obra equivocada: **Cambiar obra**.
- Detecta **tickets repetidos** (misma foto, o mismo monto + fecha + tienda).
- Escanear desde la pestaña Gastos de una obra lo manda directo a esa obra.

### Activar la lectura automática (recomendado, servicio pagado)
Sin esto, el escaneo guarda la foto y usted escribe el monto. Con esto, la app lee tienda, fecha, total e impuesto sola.
1. Cree una cuenta en console.anthropic.com, agregue crédito en *Billing* (con $10 alcanzan para miles de tickets) y cree una *API key*.
2. En el servidor (Render/Railway → Environment) agregue `ANTHROPIC_API_KEY` con esa clave y reinicie.
3. En **Mi cuenta** debe decir "Lectura automática: Activada".
Costo aproximado: menos de 1 centavo por ticket (modelo claude-haiku-5-5). Las fotos solo se mandan para leerlas; no se guardan fuera de su servidor.

## Casos: problemas y preguntas con fotos (nuevo en v1.5)

Para cuando algo se atora y la decisión es de la empresa o del dueño de la casa.
- **El sub** (en su obra) toca **⚠️ Reportar problema**: explica qué encontró y manda fotos. Lo ve **solo la empresa**, nunca el cliente. Puede marcarlo *Urgente: el trabajo está detenido*.
- **El project manager / dueño** abre un caso desde la pestaña **Casos** de la obra (o en el menú Casos). Elige quién lo ve: *Interno*, *Interno + un sub*, o *Para el cliente*.
- **El cliente** en su portal toca **Hacer una pregunta** y manda fotos de lo que le preocupa.
- Dentro del caso, cada mensaje del dueño es **🔒 Interno** o **👁 Para el cliente**. Para el cliente puede elegir cuáles fotos del caso le comparte (se manda una copia; las internas siguen privadas) y marcar si necesita su respuesta o autorización.
- Reglas de privacidad: el cliente **nunca** ve mensajes internos, costos ni fotos internas. El sub **nunca** ve lo que se habla con el cliente ni casos de otros subs.
- **Cerrar con decisión:** queda escrito lo que se decidió (lo ve el sub, no el cliente) y, si quiere, un mensaje final al cliente. Se puede reabrir.
- Después de mandar, la app ofrece **WhatsApp / mensaje de texto** ya escrito en el idioma de cada persona. El número rojo del menú cuenta los casos con mensajes nuevos.
- Las fotos de un caso no se pueden borrar: son el historial (útil si hay un reclamo).

## Estimados e invoices de los subs (nuevo en v1.4)

**El sub** manda desde su app, en la pestaña **Invoices**, o desde la obra con **+ Estimado** / **+ Invoice**:
- **Estimado:** el trabajo, con renglones (descripción, cantidad, precio). El total lo calcula la app.
- **Invoice:** puede ser nuevo, o **"Convertir en invoice"** un estimado aceptado, por el total o por una parte (por ejemplo 50%).
- **Change order:** trabajo adicional sobre un estimado aceptado (**+ Change order**).
- Puede adjuntar la **foto o el PDF** de su propio documento.
- Al mandarlo, se le ofrece avisarle a usted por WhatsApp o texto.

**Usted (dueño)** lo ve en **Inicio → Estimados e invoices de subs** (con el número rojo en el menú) y en **Obra → Subcontratistas**:

| Documento | Al aceptarlo / aprobarlo |
|---|---|
| Estimado | Se suma a lo **acordado** con ese sub. Todavía **no es gasto**. |
| Change order del sub | Se suma a lo acordado y al **total del estimado**. Aparece en el PDF. |
| Invoice | Se registra como **gasto de la obra**: la **ganancia se recalcula sola**. |
| Invoice pagado | Solo se marca "pagado" (fecha y forma de pago). **No crea otro gasto**: nada se cuenta dos veces. |

### Regla de cambios: lo aceptado no se cambia sin autorización de un dueño
- Mientras **no se ha revisado**, el sub puede corregirlo o retirarlo.
- Si se **rechazó**, el sub lo corrige y lo vuelve a mandar.
- Si ya está **aceptado o aprobado**, el sub **no puede cambiarlo**. Solo puede **"Pedir permiso para corregir"**, explicando por qué. Usted **autoriza o niega**.
- Si autoriza, el sub lo corrige **una sola vez**. Esa corrección **le vuelve a llegar** para la aprobación final, y la contabilidad **no cambia hasta que usted la apruebe**. Si la rechaza, se queda la versión aprobada.
- **Usted puede corregir** cualquier número directamente (botón Corregir). El gasto y lo acordado se ajustan solos por la diferencia.
- **Más de $1,000 = los 2 dueños.** Si el documento pasa de $1,000, antes o después del cambio, hacen falta **los dos dueños** para tres cosas: dar permiso al sub, aprobar su corrección, y aprobar la corrección directa que haga un dueño (esa queda esperando al otro).
  - Cada dueño ve quién ya aprobó ("Falta 1 dueño"). Al aprobar, se le ofrece avisar al otro por WhatsApp o texto.
  - Nadie puede aprobar dos veces, y **un "no" de cualquiera de los dos basta** para detenerlo.
  - Si en la app hay **un solo dueño activo**, basta con uno, para no quedarse atorados.
  - El límite está en `lib/catalog.js` (`DUAL_APPROVAL_CENTS`).
  - Aceptar un estimado o invoice nuevo por primera vez sigue siendo de un solo dueño: no es un cambio.
- Un **invoice ya pagado no se cambia**: para una diferencia, el sub manda un invoice nuevo.
- Todo queda en el **Historial** de cada documento: quién, qué, cuándo y de cuánto a cuánto.

### PDF para imprimir o mandar
- Cada **estimado, invoice y change order** tiene su botón **📄 PDF**, en español o inglés según el idioma de quien lo abre. El PDF del estimado incluye sus **change orders**: los aprobados se suman al total, los pendientes aparecen marcados y no se suman.
- En cada obra, **📄 PDF para el cliente**:
  - si es prospecto o está cotizada, sale como **Estimado**, con líneas de firma;
  - si ya está en obra, sale como **Resumen de contrato**, con precio, change orders, pagos y saldo.
  - **Nunca muestra costos internos.**
- El cliente lo puede descargar desde su portal (**Descargar PDF de mi proyecto**).

## App en el teléfono (v1.3)

En el teléfono la app se ve y funciona como una app:
- **Barra de pestañas abajo**, con íconos: Inicio, Calendario, Obras, Gastos y Más para el dueño; Mis obras, Calendario y Mi cuenta para trabajadores y subs; Mi proyecto y Mi cuenta para clientes.
- Las ventanas **suben desde abajo**, con botones grandes para el dedo.
- Las obras se ven como **tarjetas**.
- Un **número rojo** marca los avisos pendientes.

**Instalarla, sin tienda de apps.** Hay que tenerla publicada en internet con HTTPS (ver más abajo).
- **Samsung / Android:** abra el enlace en Chrome o Samsung Internet y toque **"Instalar"** en el aviso que aparece. También puede ir a Mi cuenta → Instalar la app.
- **iPhone:** abra el enlace en **Safari**, toque **Compartir** y luego **"Agregar a inicio"**.

Queda con el ícono de Elevated Exteriors, se abre a pantalla completa, sin la barra del navegador, y abre más rápido porque guarda la "cáscara" en el teléfono. **Los datos de la empresa nunca se guardan en el teléfono:** siempre vienen del servidor. Si no hay internet, la app lo dice claramente en vez de fallar.

**Google Play y App Store:** esta misma app se puede empaquetar para las tiendas. Google Play cobra un pago único de $25; Apple cobra $99 al año, revisa cada app y pide que haga más que una página web. Lo recomendable es primero usar la versión instalable y, cuando esté probada, subirla a las tiendas.

## Calendario y cambios de fecha (v1.2)

**Calendario:** en el menú, **Calendario** muestra todas las tareas por día (en el teléfono, como lista por día). El dueño puede filtrar por persona; cada trabajador ve solo sus tareas. Una tarea puede durar varios días: use "Hasta" al editarla.

**Si algo se atrasa** (inspección, clima, material…):
1. Toque la tarea en el calendario, o el botón 📅 en la lista de tareas de la obra → **Reprogramar / avisar atraso**.
2. Ponga la nueva fecha. Si todavía no la sabe, déjela vacía y el sub propondrá cuándo puede regresar. Elija el motivo.
3. Marque lo que quiere que pase. Todo viene marcado de inicio:
   - mover **también las tareas siguientes** los mismos días;
   - mover la **fecha de fin** de la obra;
   - **avisar al sub** de la tarea y a los subs de las tareas que se muevan;
   - **informar al cliente**, con un mensaje opcional.
4. Al guardar se abre **"Avisar a las personas"**, con el mensaje ya escrito en el idioma de cada quien y botones de **WhatsApp, mensaje de texto o email**. El aviso también queda dentro de la app de cada persona.

**El sub responde** desde su teléfono: **"Confirmo"** o **"Propongo otra fecha"** (el día en que puede regresar, con una nota).

**Si el sub necesita cambiar una fecha por su cuenta:** toca ⏰ **Pedir cambio de fecha** en su tarea, pone el día en que puede regresar, el motivo y una nota. La solicitud llega a los dueños dentro de la app (número rojo en el menú y aviso en Inicio). Además, al sub se le abre un mensaje ya escrito para mandarlo por **WhatsApp o texto a los teléfonos de los dueños**. **El sub nunca cambia fechas directamente: el calendario solo cambia cuando un dueño aprueba.** Registre el teléfono de los dueños en Equipo y accesos para que les lleguen estos mensajes.

**Usted acepta** la fecha del sub en **Inicio → Calendario: avisos a subs → Aceptar fecha**. El calendario se ajusta solo y se avisa a quien corresponda. El número rojo en el menú indica cuántos avisos esperan su respuesta.

**El cliente se entera de todo cambio autorizado:** cambios de fecha, change orders aprobados, inicio y fin de la obra. Los ve en su portal en **"Novedades"**, en su idioma, y usted puede mandárselos por WhatsApp, texto o email. **El cliente nunca ve el motivo interno** ni la nota para el sub; solo el cambio y el mensaje que usted escriba para él. En **Obra → Datos y acceso → Novedades para el cliente** ve todo lo que se le ha informado y puede mandarle un mensaje.

> Los mensajes de WhatsApp y de texto se envían **desde su teléfono** con un toque, porque la app no manda mensajes sola. Para que lleguen automáticamente haría falta un servicio de mensajería (por ejemplo Twilio, con costo mensual) y tener la app publicada en internet. Registre el teléfono de cada sub en **Equipo y accesos**.

## Idioma: español / inglés

- Cada pantalla tiene el botón **ES | EN**, también la de entrar. Con un toque cambia toda la app.
- La elección se guarda en el usuario de cada persona. Si entra desde otro teléfono o computadora, la app se abre en su idioma.
- Al crear un usuario, el dueño elige su idioma inicial. También puede cambiarlo después en Equipo y accesos.
- Cambian de idioma: menús, botones, mensajes de error, categorías, estados y **las tareas de plantilla** (por ejemplo, "Inspección de pilares" ↔ "Pier inspection").
- **No se traduce** lo que alguien escribe a mano: descripción de la obra, notas, nombres de gastos ni tareas nuevas. Eso se muestra tal como se escribió.
- Las traducciones al inglés están en `public/i18n.js` (textos de pantalla) y en `lib/catalog.js` (categorías y tareas). Para cambiar una palabra, edite el texto en inglés y vuelva a abrir la app.

## Cómo funciona el dinero

- **Contrato** = precio cotizado + change orders **aprobados**.
- **Gastado** = todos los gastos de la obra, incluidos los pagos a subcontratistas.
- **Ganancia a la fecha** = contrato − gastado. Al inicio de la obra se ve alta porque todavía faltan gastos.
- **Por cobrar** = contrato − pagos del cliente.
- **Retrabajo** = gastos en la categoría "Retrabajo y arreglos": el dinero que se perdió en errores.
- **Pagos a subs**: en la pestaña Subcontratistas registre lo acordado; con "+ Pago" registra cada pago. Ese pago cuenta como gasto y baja lo que se le debe.
- **Garantía**: 1 año desde la fecha en que se marca la obra como Terminada.

## Plantillas de tareas

Al crear una obra se carga la lista de tareas de su tipo (patio cover, outdoor living, cocina exterior, chimenea, fire pit, muro de TV). La de **patio cover / outdoor living** sigue el orden de framing que ustedes definieron. Las demás son una **sugerencia**: revíselas en `lib/catalog.js` y ajústelas. En cada obra puede agregar, borrar y reordenar tareas.

## Respaldos

- Cada día la app guarda una copia en `datos\backups` (se quedan las últimas 14).
- En **Mi cuenta → Descargar respaldo** baja una copia para guardarla en otro lugar (USB, Google Drive).
- Todo vive en la carpeta **`datos`**: `elevated.db` (la información) y `files` (fotos y recibos). **Respaldar esa carpeta = respaldar todo.**

## Seguridad (proporcional a una empresa de 2 dueños)

- Contraseñas de 10+ caracteres, guardadas cifradas (scrypt).
- Entrada en 2 pasos opcional con Google Authenticator o Authy (Mi cuenta). Recomendado para los dueños.
- Después de 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
- Cada pantalla y cada dato se revisa en el servidor según el rol: un cliente no puede ver otra obra aunque cambie el enlace.
- Si alguien deja la empresa: Equipo y accesos → ✎ → "Sin acceso". Su sesión se cierra en ese momento.

### Qué está comprobado y qué falta
- **Comprobado con pruebas automáticas** (`node --no-warnings --test`, 50 grupos, y la vista de teléfono revisada en Samsung y iPhone simulados): cada rol ve solo lo suyo (un cliente no ve otra obra aunque cambie el enlace; un trabajador nunca recibe dinero desde el servidor); los cálculos de contrato, gastado, ganancia, saldo y lo que se debe a subs; fotos y recibos protegidos; entrada en 2 pasos; protección contra peticiones de otros sitios; texto malicioso que no se ejecuta; respaldo; calendario, avisos a subs y novedades al cliente (incluido que el cliente nunca vea el motivo interno).
- **No depende de paquetes de terceros.** Así no hay código ajeno con fallas desconocidas.
- **Pendiente:** no la ha revisado un experto en seguridad externo, y todavía no se ha usado con datos reales. Ningún programa puede garantizarse 100 % libre de errores.
- **Recomendado:** las primeras 2–4 semanas, lleve también su control actual en paralelo y compare los totales. Active BitLocker en la computadora donde corre la app y guarde respaldos fuera de ella.

## Para que trabajadores y clientes entren desde su teléfono

Así como viene, la app solo abre en la computadora donde corre. Para que la abran desde sus teléfonos, hay que publicarla en internet, con HTTPS. Opción sencilla: **Render** (incluye `Dockerfile`):
1. Suba esta carpeta a un repositorio privado de GitHub (el `.gitignore` ya deja fuera la carpeta `datos`).
2. En Render: New → Web Service → Docker. Agregue un **Disk** montado en `/data`.
3. Desde el Shell de Render cree el primer dueño: `node crear-dueno.js glaiber "Glaiber"`.

Podemos hacer ese paso juntos cuando estén listos.

## Para desarrolladores

- `server.js`: servidor HTTP (Node puro). `lib/api.js`: todas las rutas y los permisos. `lib/db.js`: tablas SQLite. `lib/auth.js`: contraseñas, sesiones y 2 pasos. `lib/catalog.js`: categorías y plantillas. `public/`: interfaz (HTML/CSS/JS sin compilación).
- Pruebas: `node --no-warnings --test` (permisos por rol, cálculos de dinero, archivos protegidos, 2 pasos, CSRF, respaldo, idioma, calendario, avisos y novedades al cliente, actualización de bases anteriores). Una prueba falla si algún texto nuevo no tiene su traducción al inglés.
- Regla para cualquier IA o programador que toque esto: **cada cambio debe ser una función que se use en la operación diaria**, con su prueba. Nada de "laboratorios", "ceremonias" ni versiones paralelas.
