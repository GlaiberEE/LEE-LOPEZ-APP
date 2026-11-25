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

## Nuevo en v2.17.1: la app avisa que hay versión nueva

- El número de versión se ve en el menú (abajo, junto al nombre), en la pantalla de entrar y en Ayuda.
- Cuando se publica una versión nueva en Render, cada teléfono o computadora que tenga la app abierta (o la vuelva a abrir) ve arriba: **"Hay una versión nueva de la app (2.17.2). Usted tiene la 2.17.1." → Actualizar ahora**. La app revisa al abrir, al volver a ella y cada 10 minutos. Nunca se recarga sola (la persona podría estar escribiendo).
- Después de actualizar sale una sola vez la lista de **Novedades**, en el idioma de cada quien. También está en Ayuda → Novedades, con "Buscar actualización".
- Para cada versión nueva, las novedades van en `lib/releases.js` (español e inglés). Una prueba automática no deja publicar una versión sin sus novedades.

## Nuevo en v2.17: tickets y gastos (Fase 2)

- **🧾 Registrar ticket** (en Gastos y en la pestaña Gastos de cada obra): tienda (con las frecuentes: Lowe's, Home Depot, ABC Supply, Leroy Jordan, Amazon), **número de ticket**, fecha, **cómo se pagó** (tarjeta de la compañía, C.O.D., cheque, Zelle, efectivo, dinero propio), **foto o PDF** (cámara, galería, Google Drive) y **subtotal**. El **impuesto de 8.25%** sale solo (se puede cambiar o quitar) y la app da el total.
- **➗ Dividir un ticket:** cada parte a una obra y su partida, a **gasto general de la empresa** (la herramienta va aquí), o **personal** (no cuenta como gasto, solo queda anotado). El impuesto se reparte solo, sin perder centavos.
- **Bloqueo de duplicados:** la misma tienda + el mismo número de ticket no entra dos veces (reconoce "LOWE'S #053997" = "Lowe's 53997"). Solo un dueño lo pasa, con motivo; queda en el historial. Sin número, avisa si hay otro con el mismo total, fecha y tienda. También aplica a gastos escritos a mano y a tickets escaneados (la lectura automática ahora saca el número y el subtotal).
- **Gastos → Empresa (gasto general):** herramienta, equipo, vehículos, gasolina, seguros, oficina, software, marketing… con totales por categoría. Solo los dueños.
- **Gastos → Tickets:** todos los tickets del periodo con a dónde fue cada parte, por forma de pago, y cuáles no tienen foto: para revisar cada viernes contra la tarjeta.
- **Para la contadora (CSV):** gastos de obra y de empresa del periodo, en inglés, con número de ticket, forma de pago, subtotal, impuesto y total.
- El PM puede registrar tickets de sus obras dentro de su límite; arriba, espera a un dueño. Un ticket pagado con dinero propio de un dueño lo autoriza el otro dueño.

## Nuevo en v2.32: opiniones de clientes (encuesta al terminar la obra)

- **Solo al final:** cuando la obra queda **Terminada**, la app crea la encuesta del cliente con su propio enlace (no necesita contraseña) y deja listo el texto en **Textos** para mandárselo. Si no contesta en 3 días, sale un recordatorio (solo uno). Si el cliente tiene portal, también la ve ahí.
- **Qué pregunta (2 minutos, en su idioma):** limpieza, puntualidad, comunicación, calidad del trabajo y la cuadrilla (1 a 5 estrellas); qué tan probable es que nos recomiende (0 a 10); qué podemos mejorar; qué le gustó más.
- **Opinión sincera:** el cliente ve que sus comentarios los leen solo los dueños. El PM, la oficina y los subs no ven las respuestas; al PM solo le llega el promedio de estrellas para su calificación.
- **Calificación baja** (alguna pregunta con 1–2 estrellas, promedio menor a 3.5, o recomendación de 6 o menos): aviso inmediato a los dueños y tarjeta en Inicio. Llámele y toque **Ya le llamé** con lo que se acordó.
- **Calificación muy alta:** al terminar, al cliente se le ofrece dejar la reseña de Google (si el link está en Ajustes de la empresa).
- **Opiniones de clientes** (menú de los dueños): contestadas, promedio, recomendación (NPS), por llamar; promedio por pregunta, por PM, por tipo de proyecto y por sub; todas las respuestas; las que no han contestado, con su enlace.
- Las obras que ya estaban terminadas antes de esta versión no reciben encuesta.

## Nuevo en v2.35: selecciones del cliente (lo que falta escoger)

- En la obra → **Materiales** → **Selecciones del cliente**. **"Armar las de esta obra"** pone lo que normalmente se escoge según las tareas (teja, ceiling, stain, piedra, cubierta, equipo, luces…). También se agregan a mano.
- Cada selección se liga a la **tarea que la necesita**. **Fecha límite** = fecha de la tarea − días para pedirlo (7 de entrada, se cambia), o una fecha fija. Si la tarea se mueve, la fecha se mueve.
- Dos formas de trabajar: **opciones** del catálogo de materiales (con foto) para que el cliente toque una, o el cliente **escoge por su cuenta** y se anota.
- El cliente **aprueba en su portal** (queda su nombre y la fecha). Si aprobó en persona, por texto o por correo, se marca "aprobado" diciendo cómo.
- **Recordatorios al cliente**: 3 días antes, el día y al día siguiente (aviso en su app y texto listo en **Textos** para mandar).
- **Avisos para ustedes**: si se atrasa, aviso a los dueños y al PM; sale en el **Resumen de hoy** y en **Mis pendientes**; la tarea queda marcada en rojo **"Detenida"**.
- Al aprobarse, el material entra a la **Ficha de materiales**. Los subs solo ven lo aprobado. Si el cliente cambia algo ya aprobado, les llega aviso por si cuesta un **change order**.

## Nuevo en v2.33: categorías y listas a la medida de la compañía

- **Más → Categorías y listas** (o Mi cuenta → Ajustes de la empresa). Cinco listas: **gastos de obra**, **gastos de la compañía**, **pago de tickets**, **pagos a subs** (Zelle, cheque, depósito directo… y las que agreguen, como Cash App; desde v2.34) y **trades**.
- Los dueños **agregan**, **cambian el nombre** (español e inglés) o **esconden**. Nada se borra: lo que ya tiene gastos conserva su nombre. Las que tienen 🔒 las necesita la app y solo se renombran.
- Gastos de la compañía (no de una obra): diésel en *Gasolina*, llanta de la traila en *Vehículos y trailers*, mantenimiento de camionetas en *Reparación y mantenimiento*, y ahora **Basura y landfill**. Si falta algo, se agrega aquí.
- Cada cambio queda en el historial. El PM, la oficina y los agentes no cambian las listas.

## Nuevo en v2.31: seguridad y dinero, y pantalla sencilla para los subs

**Una sola regla para todo gasto**
- Lo que registra un sub (gasto, ticket o reembolso) respeta el **cierre de periodo**, queda en el **historial** y aparece en Inicio como **Gastos de subs por revisar**. Ya cuenta en la obra; un dueño, el PM de la obra o la oficina toca **Está bien** o lo abre para corregirlo.
- Un ticket leído por la AI **nunca se guarda solo**: la app propone la obra y el monto, y una persona confirma.

**Dos dueños, sin huecos**
- Lo autoriza el otro dueño: **crear un dueño**, **desactivar** al otro dueño o quitarle su verificación, **change orders de $1,000 o más** (crearlo aprobado o aprobarlo), **apagar** la doble firma de pagos a subs y **quitar** la verificación obligatoria.
- Lo que pide un PM de $1,000 o más (change orders y cambios de dinero) también lo firman los dos dueños.
- Si el otro dueño está **desactivado**, la app **espera** en lugar de saltarse la regla. (Una compañía con un solo dueño sí trabaja sola.)
- Cada dueño cambia **su propia** contraseña.

**Sesiones y verificación**
- Al cambiar la contraseña se cierra la sesión en los demás teléfonos y computadoras.
- Dueños, PM, oficina y ventas entran por **7 días**; subs, trabajadores y clientes por 30.
- Con la entrada en 2 pasos activada, **Autorizar** pide el código de 6 dígitos. En **Mi cuenta → Seguridad de la compañía** se puede exigir para todos los dueños. Recomendado: que los dos activen su entrada en 2 pasos y luego enciendan el interruptor.

**Pantalla del sub, más clara**
- Inicio del sub con **botones grandes con iconos de línea** (v2.31.1): Foto del ticket, Foto del trabajo, Hay un problema, Mis pagos, Mi semana, Mandar invoice.
- **Mis obras ahora** solo enseña donde está trabajando; las que vienen y las terminadas quedan guardadas abajo.
- En la obra: **Cómo llegar**, los mismos botones y **Mis tareas** con botones grandes ▶ Empezar / ✓ Terminé. Lo de los demás y lo terminado se abre con un toque.

## Nuevo en v2.30: inventario de herramienta y equipo

- **Menú → Inventario** (dueños, PM, oficina y contadora). Cada cosa con etiqueta (H-0001), tipo, marca, modelo, serie, fecha y costo de compra, tienda, garantía, estado (bien / necesita reparación / no aparece), foto y ticket.
- **Dónde está:** bodega, una obra, en reparación o dada de baja. La herramienta no se presta a personas. "Mover" deja historial (quién y cuándo); "La vi" sirve para el conteo ("vista hace X días").
- **Ligado a los gastos de la compañía:** las compras de categoría Herramienta o Equipo aparecen en "Compras sin pasar al inventario" y se pasan con un toque (varias iguales = una etiqueta cada una).
- **Quién:** dueños y oficina la manejan (solo un dueño borra; mejor dar de baja con motivo). PM: sin costos, mueve entre la bodega y sus obras. Contadora: todo con costos, sin cambiar. Sub: ve qué herramienta hay en su obra.
- Aviso 30 días antes de que venza la garantía de una herramienta.

## Nuevo en v2.29: webhooks y cierre de mes (fase 8, parte 2)

- **Cierre de mes** (Menú → Cierre de mes; la contadora en Contabilidad): revisión (tickets sin foto, sin obra, invoices de subs sin aprobar, cambios por aprobar), **paquete del mes .zip** (gastos de obra y empresa, archivos para QuickBooks, pagos de clientes, invoices de subs y la foto de cada ticket) y **"Cerrar el mes"** con el cierre de periodo (reabrir necesita al otro dueño).
- **Conexiones (webhooks)** en Equipo: dirección https + eventos (`expense.created`, `receipt.created`, `inspection.result`, `change_order.created/updated`, `payment.received`, `case.opened`, `daily_report.created`, `month.closed`, `job.created/updated`, `task.done`, `digest`). Cuerpo JSON `{event, company, at, data}` firmado con `X-EE-Signature: sha256=HMAC(clave, cuerpo)`. 2 reintentos, bitácora, probar, pausar, clave nueva. No se permiten direcciones internas.
- Los agentes reciben el resumen de la mañana como evento `digest`.

## Nuevo en v2.28: resumen de la mañana y textos listos (fase 8, parte 1)

- **Resumen de la mañana** (6:30 AM, hora de Texas; los dueños la cambian en "Resumen de hoy"). A cada persona le llega un aviso con su día:
  - Dueños: trabajo de hoy, inspecciones (y las que no tienen resultado), cambios por aprobar, pagos a subs que tocan, cobros por hacer o vencidos, casos urgentes, papeles por vencer, tickets por asignar y su plan.
  - PM: lo de sus obras, sin dinero de la compañía. Vendedor: citas y seguimientos. Sub: sus tareas de hoy. Oficina: tickets y papeles.
  - Cada quien lo puede apagar. Los domingos no se manda. Los agentes lo leen con `GET /api/digest`.
- **Textos listos para mandar** (Textos, y aviso en Inicio): mañana en casa del cliente, inspección de mañana, recordatorio de cobro (sin monto), lo de mañana para cada sub (sin horario) y "pasó la inspección". En el idioma de cada persona, sin dinero. Nada se manda solo. Sin Twilio: "Abrir en Mensajes", "Copiar" y "Ya lo mandé".

## Nuevo en v2.27: documentos (fase 7, parte 2)

- **Menú → Documentos.** Papeles de la compañía (licencias, seguros, registro de contratista de cada ciudad, W-9 de la compañía) con número, ciudad, fecha de vencimiento y archivo. Aviso 30 días antes y el día que vence (dueños y oficina); en Inicio sale "Papeles por vencer". Los suben los dueños y Administración; el PM y la contadora los ven; solo un dueño los borra.
- **Plantillas** (dueños, en Documentos): contrato, change order y certificado de garantía, en inglés. Se llenan solas con los datos de la obra (`{{client_name}}`, `{{contract_total}}`, `{{payment_schedule}}`…). Se pueden cambiar y volver al texto de la app. **Que su abogado revise el texto.**
- **Pestaña "Contrato y garantías"** en cada obra: "Hacer contrato" (PDF listo para firmar), "Subir contrato", "Hacer change order en PDF". Un dueño lo marca "Firmado" (y sube la copia firmada): ya no se cambia ni se borra. Se comparte con el cliente con una casilla. Los subs nunca lo ven.
- **Garantías:** la de trabajo (12 meses desde que se terminó la obra) sale sola; las de fábrica se agregan con marca, modelo, número de serie, vencimiento y archivo. El cliente las ve en su portal; aviso a los dueños 30 días antes. "Certificado de garantía" en PDF cuando la obra ya se terminó.

## Nuevo en v2.26: puestos y permisos (fase 7, parte 1)

- **Puestos nuevos** (Equipo → "+ Usuario" → Rol):
  - **Administración (oficina):** escanea y registra tickets y gastos de la compañía. No ve precios, ganancias ni pagos de las obras; no borra ni cambia lo registrado; no puede registrar un reembolso a su nombre ni guardar un ticket repetido (eso lo hace un dueño).
  - **Contadora (solo ver):** página "Contabilidad" con las fechas y los archivos para Excel/QuickBooks (gastos de obra y empresa, pagos de clientes, invoices de subs, reporte 1099) y la ganancia por tipo. En Gastos ve cada gasto y ticket con su foto. No puede cambiar nada.
- **Permisos por persona** (🔸, al editar a la persona): Encargado de cuadrilla (trabajador/sub: escribe el reporte del día de sus obras; queda interno y también recibe el aviso de las 6:30 PM), "Ve todas las obras" (PM), Ventas (dueño y PM), "Ve los gastos de las obras" (Administración), "Ve el reparto de ganancia" (Contadora).
- **Tabla "Puestos y permisos"** abajo de la lista del equipo.
- Seguridad: la oficina y la contadora solo pueden abrir las rutas de su lista; todo lo demás regresa "Esto no es parte de su puesto". Solo los dueños aprueban pagos y agregan usuarios.

## Nuevo en v2.25: historial diario de cada obra (fase 6)

- **Pestaña "Historial diario"** en cada obra (dueños y PM de la obra). Muestra lo que pasó cada día, junto solo:
  - tareas empezadas y terminadas (y quién) y fechas movidas;
  - inspecciones con su resultado y motivo;
  - fotos, rough-in confirmado con foto, change orders (sin precio) y casos;
  - tickets (sin monto), avisos de cambio de fecha y novedades al cliente;
  - el plan del día de la gente en esa obra y el reporte del día (clima, cuadrilla, notas).
- **En inglés:** el día se guarda en inglés (registro de la compañía) y también en español. Lo que escribe la gente se traduce con la AI de traducciones (ANTHROPIC_API_KEY o XAI_API_KEY); el original siempre queda. Sin clave, se guarda como se escribió.
- **Aviso 6:30 PM:** si una obra trabajó hoy (tenía tareas o pasó algo) y nadie escribió el reporte del día, le llega un aviso al PM de la obra; si no tiene PM, a los dueños. En Inicio sale "Falta el reporte del día".
- **Cierre 10 PM:** el día se congela solo (o antes con "Cerrar el día"). Ya no cambia aunque después se borre o agregue algo. Lo que falte entra como **nota tardía** con nombre, fecha y hora. Cada día cerrado guarda una huella (hash) para comprobar que no se tocó.
- **PDF:** del día o de toda la obra, en inglés (o en español con "PDF en español"). Nunca lleva montos de dinero.
- Subs y clientes no lo ven.

## Nuevo en v2.24: plan de mañana

- **Menú → Mi plan** (dueños, PM y vendedores; el sub lo ve en su Inicio). Pestañas **Hoy** y **Mañana**. En Inicio sale el plan de hoy como lista para palomear.
- **Aviso a las 5 PM** a dueños, PM y vendedores para armar el plan de mañana.
- **La app sugiere** lo que ya sabe para ese día: tareas que tocan, inspecciones, citas, seguimientos y lo atrasado. "+" o "Agregar todo". También se escribe lo propio, con hora (opcional) y obra.
- **En la noche**, lo que no se terminó pasa solo al siguiente día de trabajo (el original queda como "movido").
- **Quién arma el plan de quién:** los dueños, el de cualquiera; el PM, el de los subs de sus obras; vendedor y sub, solo el suyo.
- **Lo que pone el jefe** sale "lo pidió …": quien lo recibe no lo borra ni lo cambia; lo marca hecho o "No se pudo" con motivo, y al jefe le llega el aviso.
- **Subs sin horario:** a un sub no se le pone hora, solo qué se necesita y en qué obra (contratista independiente, 1099).
- **Plan del equipo:** cuánto lleva hecho cada persona y "Armar" para abrir su plan.

## Nuevo en v2.23.1

- **Calendario para contestar:** cuando al sub le preguntan "¿Puede empezar…?", ve el mes con sus **obras activas** (cada obra con su color, solo sus propias tareas; nada de dinero) y el día que se le pide marcado en verde. Si ese día ya tiene trabajo en otra obra, la app se lo dice.
  - "✅ Sí puedo el …" contesta que sí.
  - Si no puede, toca en el calendario el día desde el que sí puede y "Puedo desde el …". Puede pasar al mes siguiente con ›.
  - El mismo calendario lo usa el dueño o el PM con 📞 cuando el sub contesta por teléfono.
  - Los trabajos que todavía esperan en la fila no salen como obras activas.

## Nuevo en v2.23: fila de espera de trabajos vendidos

- **Menú → Fila de espera** (dueños y PM). Cuando se aprueba un estimado o se firma la propuesta, el trabajo entra a la fila con esa fecha; los más viejos van primero. Las obras activas que todavía no arrancan (ninguna tarea de trabajo empezada) también salen. Lo que ya arrancó, no.
- **Fecha propuesta:** para cada sub del trabajo la app ve cuándo se libera (el día después de su última tarea pendiente en las obras que ya arrancaron) y propone el arranque cuando los **subs clave** están libres. Se puede escribir otra fecha ("Que la app la proponga" la regresa).
- **⭐ Clave:** por omisión son los subs de las primeras 3 etapas del trabajo (pilares, concreto, framing…); ustedes marcan o desmarcan. El **% de listo** cuenta solo a los clave: con el framer de dos clave, 50%.
- **Preguntar a los subs:** a todos los subs con usuario les llega "¿Puede empezar el …?" con la fecha que les toca según el schedule (no la misma para todos). Contestan desde su teléfono en Mis pendientes: sí, o no y desde qué fecha sí pueden. Si contestan por teléfono, el dueño o PM lo captura con 📞.
- **Espera permitida:** los que no son clave pueden esperar hasta **7 días** (Reglas de la fila); si tardan más, sale ⚠️ y el trabajo no queda "Listo".
- **Estados:** Listo para arrancar (100% de los clave), Se puede arrancar (50% o más y ningún clave dijo que no), Esperando respuestas, Sin preguntar.
- **Arrancar:** un dueño o el PM toca "Arrancar el …". La app recorre las tareas que faltan a esa fecha, mueve la primera tarea de quien dijo que no a cuando sí puede, avisa a los subs y el trabajo sale de la fila. Nada arranca solo.

## Nuevo en v2.22: Fase 5 — resultado de inspecciones y rough-in antes de cerrar

- **Resultado de cada inspección** (obra → Permisos, o Inicio → Mis pendientes): "✅ Pasó" o "❌ No pasó", con fecha, inspector y foto opcional.
  - **Pasó:** la tarea queda hecha en el schedule y se avisa a los subs y al cliente lo que sigue.
  - **No pasó:** hay que escribir el motivo (hay botones rápidos: código nuevo, falta material, etc.). La app guarda el resultado, crea la **reinspección** (intento 2, con la fecha si ya la sabe), mueve la tarea de la inspección a esa fecha y crea **"Corregir para reinspección: …"** justo antes, al crew del trade que toca. Avisa a los dueños, al PM y a quien corrige; al cliente no.
  - Una inspección que ya tiene resultado no se cambia: se usa su reinspección. En Permisos se ve el historial (no pasó el…, intento 2…).
- **Sin resultado:** si pasa la fecha de la inspección y nadie puso el resultado, sale en Inicio ("¿Pasó la inspección?") y a partir de las 7 am del día siguiente llega un aviso a los dueños y al PM, una sola vez.
- **Rough-in antes de cerrar** (obra → Tareas, arriba): la app arma la lista según los trades de la obra (contactos y switches, cajas de luz y conduit, cables de A/V, línea de gas y prueba, plomería) y se pueden agregar más.
  - Cada renglón se confirma **con foto** (obligatoria). Lo confirma el sub de ese trade desde su teléfono (le sale en Mis pendientes), el PM o un dueño. Un dueño o PM puede marcar "No aplica" con motivo.
  - Mientras falte algo, o falte pasar la inspección de rough que va antes, la app **no deja empezar ni marcar hecha** una tarea de cerrar (cielo, forrar, drywall, T&G, aislamiento). Explica qué falta.
  - Un dueño puede dejarla pasar escribiendo por qué; queda en el historial. Los subs y el PM no pueden saltarlo.
- **Ojo al subir a Render:** las obras activas que tengan tareas de cerrar y trades de rough van a tener su lista; hasta confirmarla, esas tareas quedan frenadas.

## Nuevo en v2.21.1

- **Agregar un sub a una obra:** el primer campo, "Escoger un sub ya registrado", lista los subs de otras obras y los usuarios de subs. Al escoger uno se rellenan el nombre, qué hace, sus trades, su usuario y sus notas; solo falta escribir lo acordado en esta obra. Si solo escoge el usuario, también se llena lo que esté vacío. La lista no muestra montos.

## Nuevo en v2.21: Fase 4 — change orders con código y estado, y cobros al cliente

- **Código de cada change order:** categoría + número corrido de la obra: GAS-01, PERMIT-02, GRAN-03… (categorías: general, gas, eléctrico, A/V, plomería, permiso, concreto, estructura, techo, piedra, granito, pintura, iluminación, paisajismo y crédito). Se puede escribir otro código; no se repite en la obra. Los change orders que ya existían quedaron como CO-01, CO-02…
- **Estado:** pendiente (esperando al cliente) → aprobado (suma al contrato) → facturado → **cobrado**. "Cobrado" sale solo cuando los pagos lo cubren. Rechazado no cuenta.
- **"Hecho"** marca el trabajo del CO aparte del cobro (como el granito pagado por adelantado que queda "cobrado" hasta que Rob diga que está listo). Lo puede marcar el PM. Si el trabajo está hecho y el CO no se ha facturado, sale en Inicio → Cobros.
- **Facturar un CO:** cada uno con su invoice (PDF en español e inglés y enlace para el cliente). Facturado ya no se cambia de monto ni se borra; se anula el invoice primero.
- **Pagos del cliente → "Aplicar a":** el contrato (se aplica a las etapas en orden) o un change order. Lo que sobra del contrato se aplica a los change orders.
- **Cobros por etapa** (depósito, avance y final): ahora también en las obras cuyo contrato viene de un **estimado aprobado** (Planos), no solo de la propuesta firmada.
- **Dinero → Cobros:** por obra, contrato + change orders, cobrado, por cobrar, change orders sin cobrar, los que esperan al cliente y lo vencido. Para el cierre del viernes.
- **El cliente** ve cada change order con su código y si está pendiente, aprobado, por pagar o pagado, con su invoice.
- Cambio de regla: los change orders aprobados **ya no se suman a la última etapa**; se cobran aparte.

## Nuevo en v2.20: Fase 3 (pagos a subs), planos y estimado → invoice, aviso de inspección pasada

- **Plan de pago de cada sub** (pestaña Subcontratistas, debajo de cada sub): **50/50** (mitad al empezar su primera tarea, mitad al terminar todas), **por avance** (% de sus tareas hechas, o a mano) o **un solo pago al final**. Para trabajos de menos de **$3,500** la app sugiere el pago al final (el monto se cambia en Mi cuenta). La app muestra "Toca pagar $X", lo que espera autorización y si le falta el **W-9**. En Inicio sale "Toca pagar a subs".
- **Cada pago a un sub lo autorizan los dos dueños:** uno toca "Pedir autorización del pago" y el otro lo aprueba en Inicio → Cambios por autorizar. Si lo pide un PM, dan su visto bueno los dos dueños. Al sub le llega el aviso de su pago. Se puede apagar en Mi cuenta → Pagos a subs y avisos (para compañías con un solo dueño, ya se aplica directo).
- **Pestaña Planos** en cada obra: planos (PDF hasta 25 MB o fotos) con "Lo ven los subs" / "Lo ve el cliente", el **estimado** con número y monto, y el **scope del trabajo sin precios** (la app no deja guardar montos ahí; "Copiar de lo vendido" lo arma con las partidas sin precios).
- **Estimado → invoice:** cuando el cliente aprueba, toque "Aprobado → invoice". Queda el invoice (INV-número del estimado) con el mismo archivo y monto; si la obra era prospecto o cotizada, pasa a **En obra** con ese contrato y su calendario de cobros. Un estimado aprobado o un invoice ya no se cambia ni se borra. La propuesta firmada en línea también deja su invoice.
- **Al crear una obra** la app pide los planos y el estimado (se pueden subir después). Si faltan, la pestaña Planos lo avisa.
- **Los subs** ven en su obra "📐 Planos y scope del trabajo". Nunca ven el estimado, el invoice ni montos. Cuando se suben planos nuevos, les llega un aviso.
- **Inspección pasada:** al aprobarla en Permisos o marcarla hecha en Tareas, la app avisa a los subs de la obra y al cliente "✅ Pasó la inspección… Sigue: …", y al sub de la siguiente tarea "Ya puede seguir" con su fecha. El cliente lo ve en Novedades. Se avisa una sola vez. Se apaga en Mi cuenta.

## Nuevo en v2.19: agregar inspecciones nuevas a la lista

- **Menú → Inspecciones de la ciudad** (el vendedor la abre desde Mi cuenta): las que trae la app y las de la compañía.
- **"+ Nueva inspección":** nombre en español (inglés opcional), etapa (antes de colar, rough, finales u otras) y, si se sabe, el trade que normalmente va antes. Desde ese momento sale en la pregunta "¿Qué inspecciones pidió la ciudad?" de todas las obras, con su lugar sugerido entre los trades. Si la obra no tiene ese trade, la app la pone donde van las de su misma etapa.
- **Desde la obra:** al escribir una con "+ Otra inspección", la palomita "📌 Agregarla a la lista para las próximas obras" la guarda en la lista.
- **Quién:** pueden agregar y cambiar dueños, project managers y vendedores (también los agentes de esos tipos). Quitar: el dueño o quien la agregó; las obras que ya la tienen no cambian. Subs, trabajadores y clientes no ven la lista. Cada compañía tiene la suya.
- No se repiten: si ya existe (de la app o de la compañía) con el mismo nombre, avisa.

## Nuevo en v2.18: inspecciones de la ciudad en el schedule

- **La app pregunta.** Cuando un permiso pasa a **Aprobado** (obra → Permisos), se abre "¿Qué inspecciones pidió la ciudad?". Si se cierra sin contestar, queda un pendiente en Inicio y un aviso en el permiso hasta que se capturen.
- **Lista por etapa:** antes de colar (pilares, forms, bajo tierra, losa), rough (framing, eléctrico, plomería, gas con prueba de presión, mecánica, mampostería, aislamiento) y finales (eléctrico, plomería, gas/medidor, Oncor, final de la ciudad), más "Otra" con nombre propio.
- **Entre cada trade:** cada inspección trae sugerido "Va después de" según el trade (por ejemplo, rough eléctrico después de "Eléctrico rough", pilares entre excavar y colar). Se puede cambiar, o ponerla al principio. La fecha es la que dio la ciudad o, si no, el día siguiente a la tarea anterior.
- **Sin duplicar:** si la plantilla ya traía esa inspección, se usa la misma tarea y se mueve a su lugar. Las de la plantilla que la ciudad no pidió se quitan quitando la palomita (si no tienen avance).
- **Ligadas al permiso:** cada inspección queda como tarea y como renglón en Permisos. Cambiar la fecha en Permisos mueve la tarea; marcarla Aprobada la pone Hecha. Las inspecciones no se asignan a ningún crew.
- También: botón **🏛️ Inspecciones de la ciudad** en la pestaña Tareas. PM con permiso de la obra puede usarlo.

## Nuevo en v2.16: plantillas por trade (estudio de mercado) y crews con varios trades

- **Plantillas sugeridas nuevas**, armadas por trade con días típicos y las inspecciones donde las piden las ciudades de DFW (estudio con guías de permisos de Anna, Grapevine, Dallas y Round Rock, y el orden de trades de baños y cocinas). Patio cover: 20 tareas de 8 trades; outdoor living: 30 de 15; cocina exterior: 19; chimenea: 18; baño: 17; cocina interior: 17; remodelación: 15; muro de TV: 11; fire pit: 9.
- **Cada tarea lleva su trade** (la misma lista que fotos y materiales, ahora con demolición, A/V, azulejo, gabinetes, pisos, vidrio y equipos). Las inspecciones no llevan trade.
- **Un crew o sub puede tener varios trades.** Se marcan en Equipo (usuario) y, si cambia, en cada obra (Subcontratistas).
- **Asignación sola:** al poner una plantilla, importar el SCHEDULE o agregar una tarea, se asigna al crew de la obra que hace ese trade. Al agregar un crew a la obra, se le asignan sus tareas sin asignar. Si dos crews hacen el mismo trade, queda sin asignar para escoger a mano.
- **👷 Asignar por trade** (pestaña Tareas): cada trade con su crew; un crew puede quedarse con varios de un jalón. No toca tareas hechas y, si el crew no estaba en la obra, lo agrega (sin monto) para que la vea.
- Las fotos del crew toman el trade de su tarea.

## Nuevo en v2.15: plantillas de tareas editables e importar el SCHEDULE (Fase 1)

- **Ya no se meten tareas solas.** Antes, cada obra de patio cover traía 16 tareas fijas. Ahora, al crear la obra, en "Tareas de la obra" se escoge: una plantilla de la compañía (la marcada con ★ sale escogida para ese tipo), la sugerida de la app, o **En blanco**.
- **Obras → 📋 Plantillas:** una o varias plantillas por tipo de obra, editables (tareas, días, oficio, si es inspección), con "Pegar varias" para meter una lista de un jalón. Incluye la remodelación interior de JKL Homes. Cada compañía tiene las suyas.
- **Pestaña Tareas → 📥 Importar SCHEDULE:** se copia la tab SCHEDULE de la hoja de la obra (con encabezados TASK NAME, STATUS, START PLANNED…) y se pega, o se sube el .xlsx. Vista previa; luego **reemplazar** o **agregar**. Respeta estado, fechas y TRADE ID (se liga a la partida). No repite tareas que ya están.
- **🧹 Quitar tareas que no se usan:** marca solas las que ponía la app. Nunca borra tareas hechas, en progreso, con fotos, con avisos al sub o con un cobro ligado. "Reemplazar" del plan con AI sigue la misma regla (antes podía borrar tareas pendientes con fotos).
- **Sin margen falso:** una obra sin ningún costo cargado ya no presume 100% de ganancia; dice "sin costos cargados".
- "Mano de obra (horas)" solo aparece como categoría si la compañía tiene gente por hora.
- Para Eli (agentes): nuevas acciones en el manual del agente para ver plantillas, ponerlas e importar el SCHEDULE.

## Nuevo en v2.14: fotos y materiales clasificados por etapa y trade, y fotos de la galería o Google Drive

- Al subir fotos ("+ Fotos" en la obra, 📷 en una tarea, o el sub desde su teléfono) salen dos botones: **📷 Tomar foto** (cámara) y **🖼️ Galería o archivos** (fotos que ya tiene). En Android el selector muestra Galería, Google Fotos y Google Drive; en iPhone, Fotos y Archivos (Google Drive aparece en Archivos si tiene la app). Se pueden subir varias a la vez.
- Cada foto lleva **Etapa** (la tarea de la obra) y **Trade** (planos, excavación, concreto, carpintería, techo, electricidad, plomería, gas, piedra, cubierta, pintura, drywall, paisajismo, limpieza, otro). La app los sugiere según la tarea en progreso y el oficio del sub; se pueden cambiar.
- Pestaña Fotos: filtros por etapa y por trade, y **✎ Clasificar** para corregir etapa, trade o comentario de una foto ya subida (un sub solo las suyas).
- Al agregar un material a la obra también se elige **Etapa** y **Trade** (sugerido por el tipo de material), y se ve en la ficha.
- La foto de cerca de un material nuevo ya no obliga a usar la cámara: también se puede escoger de la galería o Drive.

## Nuevo en v2.13.1: resumen de la obra para imprimir, y documentos sin quedarse atorado

- En cada obra, el botón **"🖨 Resumen / imprimir"** (antes "PDF para el cliente") abre el resumen dentro de la app, con **← Volver a la obra**, **🖨 Imprimir** y **📄 PDF**.
- Dos versiones (solo dueños): **Para el cliente** (contrato, change orders, pagos, saldo y avance; sin costos) e **Interno (con costos)** (agrega gastos por tipo, ganancia, margen y lo que se debe a cada sub). Al imprimir sale limpio, sin menús ni botones.
- **Arreglo:** en la app instalada, los PDF (resumen, invoices, estados de cuenta, propuestas) y archivos se abrían en una ventana sin botón de regresar. Ahora se abre un cuadro con **Imprimir o compartir** (menú del teléfono: Imprimir, WhatsApp, correo, Archivos), **Guardar** y **Cerrar**, y usted sigue en la misma pantalla.

## Nuevo en v2.13: traducción automática español ↔ inglés

- Cada quien escribe en su idioma y cada quien lee en el suyo: si Salomón escribe un caso en español y el PM (Jack) usa la app en inglés, Jack lo lee en inglés; lo que Jack conteste, Salomón lo lee en español.
- Debajo de cada texto traducido sale "🌐 Traducido del español · Ver original"; el original siempre se guarda y nunca se cambia.
- Se traduce: casos (título y mensajes), lo que escribe un sub al avisar un atraso y lo que contesta, notas del día del PM, novedades y reportes diarios que ve el cliente, change orders que ve el cliente, textos que llegan, y "Mis pendientes".
- **Textos (SMS):** con la casilla "Si la persona habla otro idioma, mandárselo traducido" (viene marcada), el texto sale en el idioma de quien lo recibe y en la conversación queda lo que usted escribió. Los mensajes de acceso y los que la app arma ya van en el idioma correcto y no se traducen. A un cliente sin usuario en la app no se le traduce (la app no sabe su idioma).
- **Qué necesita:** la misma clave de AI que la lectura de tickets (ANTHROPIC_API_KEY o XAI_API_KEY en Render). En Mi cuenta sale "🌐 Traducción automática: Activada / No configurada". Sin clave, todo funciona igual, sin traducir.
- Cada texto se traduce una sola vez y se guarda; volver a leerlo no cuesta. Si la AI tarda, el mensaje se guarda igual y la traducción aparece al volver a abrir.
- Nombres, números, montos, fechas, direcciones, medidas y códigos de obra no se cambian.

## Nuevo en v2.12.1 y v2.12.2: un dueño también puede ser el encargado de una obra

- En **Editar obra** (y al crear una obra), "Project manager a cargo" ahora ofrece también a los dueños, marcados "(dueño)".
- El dueño que es encargado de una obra recibe lo mismo que un PM: los casos que abren los subs o el cliente quedan a su cargo, le llegan los avisos y los recordatorios, y en "Mis pendientes" ve las tareas atrasadas de esa obra. No entra en las calificaciones de PM.
- Compartir un caso con el cliente lo puede hacer un dueño o el PM de la obra. Un sub nunca puede.
- Los videos de dueños, project managers y subs ya muestran "Mis pendientes" y los casos con responsable, fecha y varios subs (en español e inglés).

## Nuevo en v2.12: pendientes y comunicación en los casos

- **Aviso al PM:** cuando un sub abre un caso o contesta en una obra del PM, al PM le llega la notificación (antes solo a los dueños). Los avisos ahora le llegan a todos los que participan: dueños, PM de la obra, responsable y subs del caso, menos a quien escribió.
- **Responsable y fecha límite:** al abrir un caso (o después, con "📌 Responsable y fecha") se elige quién lo tiene que resolver y para cuándo. Si un sub o el cliente abre el caso, queda a cargo del PM de la obra. En la lista de casos se ve el responsable y la fecha (en rojo si ya venció).
- **Recordatorios:** si un caso abierto pasa 24 horas sin respuesta (4 horas si es urgente), le llega un recordatorio a quien le toca contestar: a los subs si lo último lo escribió la empresa, o al responsable si lo último lo escribió un sub. Si después de otro tanto sigue igual, se avisa a los dueños. Si se pasa la fecha límite, se avisa al responsable y a los dueños. Solo de 7 a.m. a 8 p.m. y una vez por cada vez.
- **Varios subs en un caso:** al abrirlo se pueden marcar varios subs de la obra, o agregarlos/quitarlos después con "👥 Subs". Todos ven y contestan lo interno; nunca lo que se habla con el cliente.
- **Mis pendientes:** tarjeta arriba en el Inicio de dueños y PMs, y en Mis obras de los subs: casos a su cargo, los que esperan su respuesta, mensajes nuevos y (PM y subs) tareas atrasadas. Con un toque abre el caso o la obra.

## Nuevo en v2.11: gastos separados por tipo

- En **Gastos** y en la pestaña **Gastos** de cada obra hay 4 botones arriba: **Todo**, **🧱 Materiales**, **👷 Subs y trabajadores** (pagos a subs y horas de trabajadores) y **📋 Otros gastos** (permisos, renta de equipo, basura, retrabajo, otro). Cada botón enseña su total y cuántos gastos son.
- Al tocar uno, la lista enseña solo esos gastos. En Subs y trabajadores sale el total por persona (⏱ marca a los que se pagan por hora); en Materiales, el total por tienda.
- "Descargar para Excel" baja solo lo que está viendo.
- En el teléfono la lista de gastos ahora se ve como tarjetas (antes se cortaba el monto).
- Los videos de dueños y de project managers ya muestran los botones nuevos.

## Nuevo en v2.10: videos en el idioma de cada persona

- Los 4 videos existen en **español y en inglés**, con las pantallas de la app en ese idioma. Cada persona ve automáticamente los de su idioma (el que eligió en ES | EN o en Mi cuenta). En la pantalla de entrada sale según el idioma elegido ahí.
- Dentro de cada video hay un botón "Ver en inglés" / "Ver en español", por ejemplo para mandarle a alguien el otro idioma.
- Los videos están en `public/tutoriales/es/` y `public/tutoriales/en/` (unos 19 MB en total).

## Nuevo en v2.9: videos tutoriales dentro de la app

- **Ayuda → Videos** (arriba de las preguntas): 4 tutoriales hechos con la app de verdad, sin sonido (los pasos van escritos en pantalla):
  - Cómo instalar y entrar (Android, iPhone y computadora), 2 min, para todos.
  - Para dueños y administradores, 5 min.
  - Para project managers, 2 min.
  - Para subs y trabajadores, 2 min.
- Cada quien ve los suyos; los dueños ven los cuatro y pueden mandar cualquiera por WhatsApp o copiar su enlace.
- En la pantalla de entrada hay un enlace "🎬 Video: cómo instalar y entrar", para quien todavía no tiene usuario.
- Los videos están en `public/tutoriales/` (unos 10 MB en total). No se guardan en el teléfono: se ven por internet.

## Nuevo en v2.8: personas nuevas sin usuario

- **Pantalla de entrada:** abajo dice "¿Es su primera vez?" con el botón **No tengo usuario: pedir acceso**. La persona pone nombre, teléfono y quién es (cliente, trabajador/sub, oficina). A los dueños les llega un aviso y sale en Inicio → "Piden acceso a la app" con el botón **Crear usuario** ya lleno. Si el teléfono ya es de alguien con usuario, se trata como "olvidé mi contraseña".
- **Crear usuario ya no pide contraseña:** la app inventa una temporal que vale 7 días y enseña el mensaje listo (enlace, usuario y contraseña) para mandarlo por WhatsApp, SMS o, si Twilio está puesto, por texto desde la app. Al entrar la primera vez, la persona tiene que poner su propia contraseña; nadie más la sabe.

## Nuevo en v2.7: papeles de subs, publicidad y entrega de obra

- **Dinero → Subs: papeles y 1099:** W-9 y certificado de seguro de cada sub (foto o PDF) con fecha de vencimiento; aviso en Inicio 30 días antes y al vencer. Un lien waiver por cada pago al sub (formas oficiales de Texas, Property Code 53.284; la app no las redacta). Suma del año por sub y reporte 1099-NEC en CSV para el contador (mínimo $2,000 desde 2026, $600 antes; se puede cambiar por año; corporaciones no aplican).
- **Dinero → Publicidad:** anote el gasto mensual por canal; la app lo cruza con prospectos, estimados y ventas y enseña costo por prospecto, costo por cliente ganado, % de cierre y retorno.
- **Entrega de la obra** (pestaña Tareas): lista de pendientes de la revisión final; con todo hecho, se manda un enlace y el cliente firma la entrega con el dedo. La obra pasa a Terminada, empieza la garantía y sale la petición de reseña.

## Nuevo en v2.6: propuesta al cliente con firma y cobros por etapa

En cada obra (o en Ventas → "Armar propuesta"), pestaña **Propuesta y cobros** (solo dueños):
- Partidas con precio y costo estimado; la app enseña el margen estimado y avisa si baja de la alerta.
- Descripción, condiciones, "válida hasta" y calendario de pagos (etapas en %, que se cumplen al firmar, al terminar una tarea o cuando el dueño lo marca).
- **Mandar al cliente:** enlace (`/propuesta.html?t=…`) por texto, WhatsApp o correo. El cliente ve la propuesta en español o inglés, baja el PDF y firma con el dedo, sin cuenta. Nunca ve costos.
- Al firmar: la obra pasa a "En obra", se fija el contrato y llega un aviso. Si se cambia después de mandarla, la app lo marca.
- **Cobros:** cada etapa pasa a "Toca cobrar" cuando se cumple (aviso). "Facturar" crea el invoice (INV-año-número) en PDF y lo manda con el mismo enlace. Los pagos registrados se aplican solos, en orden; los change orders aprobados van en la última etapa. Vencidos y por cobrar salen en Inicio. El cliente ve su calendario de pagos en su portal.

## Nuevo en v2.5: menú más simple y Módulos

- Menú del dueño en 10 opciones: Inicio, Calendario, Obras, Ventas (si la tiene), Gastos, Dinero, Textos, Casos, Materiales, Equipo. Abajo y más chico: Historial, Mi cuenta, Ayuda.
- **Inicio** tiene dos vistas: Resumen y Hoy en las obras (lo que antes era "Hoy").
- **Dinero** junta Cuentas, Reportes y Proyecciones en pestañas.
- En cada obra, Partidas es la vista de costos; Presupuesto por categoría queda en un enlace abajo de Partidas.
- **Mi cuenta → Módulos:** prender o apagar, por empresa, Horas y nómina, Project managers, Proyecciones, Agentes de AI e Importar. Apagar solo quita el menú; la información se queda.

## Nuevo en v2.4.1: calendario por día, semana y mes

En Calendario, arriba: **Día · Semana · Mes**. Las flechas avanzan o regresan un día, una semana o un mes. Tocar el número de un día abre ese día completo (tarea, cliente, dirección, quién y estado). Cada persona ve la última vista que eligió; en el teléfono empieza en Semana.

## Nuevo en v2.4: trabajadores por hora y nómina

Menú → **Horas y nómina** (solo dueños):
- **Forma de pago por trabajador:** "Por hora" (con su pago por hora) o "Como sub" (precio por trabajo, en Subcontratistas). Se elige al crear el usuario o en la pestaña Trabajadores y pago.
- **Anotar horas a mano** para quien no marca en el teléfono (día, entrada, salida, comida sin pago).
- **Tiempo extra:** lo que pase de 40 h por semana se paga a 1.5× (configurable). El extra se suma como gasto de mano de obra en las obras donde se trabajaron esas horas.
- **Nómina de la semana:** horas, extra y total por persona; "Marcar pagado" (Zelle, cheque, efectivo…). La semana pagada queda cerrada para cambios hasta quitar el pago.
- **Reporte** por trabajador o por obra en cualquier rango de fechas.
- **En cada obra** (pestaña Subcontratistas): horas y costo de cada trabajador por hora.
- La app no calcula impuestos de nómina (retenciones, W-2); eso lo maneja su contador o servicio de nómina.

## Nuevo en v2.3.2: importar directo de Google Drive

En Obras → Importar → "📁 Elegir de Google Drive" se ven las carpetas y libros (Google Sheets o .xlsx) y se marcan los que se quieren importar; ya no hay que descargarlos. Los que ya se importaron aparecen marcados.
- Conexión: una cuenta de servicio de Google Cloud (solo lectura). En Render → Environment: `GOOGLE_SERVICE_ACCOUNT_JSON` = el contenido del archivo .json de su llave. Opcional: `GOOGLE_DRIVE_FOLDER_ID` = la carpeta con la que abre (se puede pegar la dirección completa de la carpeta).
- En Drive, compartir la carpeta de los libros con el correo de la cuenta de servicio (Mi cuenta → Google Drive lo muestra) como Lector.

## Nuevo en v2.3.1: aviso de versión nueva

Cuando se publica una versión, el teléfono de cada persona la baja solo y le aparece arriba "Hay una versión nueva de la app — Actualizar". Con un toque recarga; si está escribiendo algo, puede terminar primero. La app nunca se recarga sola. La huella de versión se calcula sola al arrancar el servidor (no hay que acordarse de cambiar nada).

## Nuevo en v2.3: textos, Grok y escaneo

**Mensajes de texto (Textos).** Dueños y PMs mandan y reciben textos desde el número de la empresa. Las respuestas llegan a la app con aviso.
- Cada texto empieza con el nombre de la empresa, y el primero a cada número dice cómo dejar de recibirlos (STOP). Así lo piden las compañías de teléfono.
- Un PM solo textea a la gente de sus obras. Subs, trabajadores y clientes no usan esta pantalla.
- En los avisos de cambio de fecha y novedades aparece "💬 Texto desde la app".
- Activar: cuenta de Twilio con un número y registro A2P 10DLC. En Render → Environment: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. En Twilio, en el número, "A message comes in" → `https://<su-app>/sms/twilio/ee` (HTTP POST). JKL Homes usa su propio número: `TWILIO_FROM_JKL` y `/sms/twilio/jkl`.

**Grok conectado a la app (MCP).** Al crear la llave de un agente aparece la "dirección para Grok" (`https://<su-app>/mcp/<llave>`). En grok.com/connectors → New Connector → Custom, péguela. Grok ve las herramientas: obras, tareas, gastos, reportes, casos, tickets, textos, ventas. Usa las mismas reglas del agente: solo lectura si la llave es de lectura, lo que mueve dinero espera a un dueño, todo en el Historial.

**Escaneo.** Los tickets se leen con Claude (`ANTHROPIC_API_KEY`) o con Grok (`XAI_API_KEY`; Grok lee fotos, no PDF). Además de la obra, el gasto queda en la partida que corresponde cuando es clara. Sin ninguna clave, el escaneo guarda la foto y queda "por asignar" para llenar el monto.

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
- **Desde v2.31 la AI solo propone:** la app sugiere la obra y llena el monto, pero el gasto se guarda hasta que una persona toca **Guardar gasto** (así pasa por los límites del PM, el cierre de periodo y el historial). Si no está segura, queda **Por asignar**: el dueño lo ve en Inicio y lo asigna con un toque. Si se fue a la obra equivocada: **Cambiar obra**.
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
