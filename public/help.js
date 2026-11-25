'use strict';
/* Ayuda de la app: cómo se opera, según quién la usa (dueño, project manager, vendedor, sub/trabajador o cliente).
   Cada tema: para quién (roles), en qué pantallas aparece como "Sobre esta pantalla", título y pasos en español e inglés.
   Para agregar o cambiar un tema, edite esta lista. */
const HELP = [
  // ---------- para todos ----------
  { id: 'app', roles: ['owner', 'pm', 'sales', 'worker', 'client'], icon: '📱', screens: ['#/cuenta'],
    es: ['Instalar la app y recibir avisos', [
      'Abra la dirección de la app en el teléfono.',
      'iPhone: en Safari toque Compartir (□↑) → "Agregar a inicio". Android: en Chrome toque ⋮ → "Instalar app".',
      'Abra la app desde el ícono y entre con su usuario y contraseña.',
      'En Mi cuenta toque "Activar notificaciones" para que le lleguen los avisos al teléfono.',
      'Cambie el idioma con el botón ES | EN cuando quiera.']],
    en: ['Install the app and get notifications', [
      'Open the app address on your phone.',
      'iPhone: in Safari tap Share (□↑) → "Add to Home Screen". Android: in Chrome tap ⋮ → "Install app".',
      'Open the app from the icon and sign in with your username and password.',
      'In My account tap "Turn on notifications" so alerts reach your phone.',
      'Switch language anytime with the ES | EN button.']] },
  { id: 'password', roles: ['owner', 'pm', 'sales', 'worker', 'client'], icon: '🔑', screens: ['#/cuenta'],
    es: ['Contraseña y seguridad', [
      'Cambie su contraseña en Mi cuenta (mínimo 10 caracteres).',
      '¿Primera vez y no tiene usuario? En la pantalla de entrada toque "No tengo usuario: pedir acceso". Los dueños lo crean y le llega por texto o WhatsApp.',
      'Si la olvida: en la pantalla de entrada toque "¿Olvidó su usuario o contraseña?". Le llega por WhatsApp una contraseña temporal de 24 horas y al entrar pone una nueva.',
      'Recomendado para dueños y PMs: "Entrada en 2 pasos" en Mi cuenta, con Google Authenticator.',
      'Nunca comparta su contraseña: cada persona tiene la suya y todo queda registrado con su nombre.']],
    en: ['Password and security', [
      'Change your password in My account (at least 10 characters).',
      'First time and no user? On the sign-in screen tap "I don\'t have a user: request access". The owners create it and you get it by text or WhatsApp.',
      'If you forget it: on the sign-in screen tap "Forgot your username or password?". You get a 24-hour temporary password by WhatsApp and set a new one when you sign in.',
      'Recommended for owners and PMs: "2-step sign-in" in My account, with Google Authenticator.',
      'Never share your password: each person has their own and everything is logged with their name.']] },

  // ---------- dueños ----------
  { id: 'start', roles: ['owner'], icon: '🚀', screens: ['#/', '#/equipo'],
    es: ['Primeros pasos', [
      'Equipo y accesos → "+ Usuario": cree a su socio (Dueño), PMs, vendedores, subs y clientes. Ponga teléfono, oficio e idioma.',
      'Usted no inventa contraseñas: al tocar "Crear y mandar acceso", la app hace una temporal (vale 7 días) y le enseña el mensaje para mandarlo por texto o WhatsApp con el enlace y el usuario. La persona pone su propia contraseña al entrar.',
      'Si alguien nuevo toca "No tengo usuario: pedir acceso" en la pantalla de entrada, le sale en Inicio con el botón "Crear usuario" ya lleno con su nombre y teléfono.',
      'Inicio le muestra lo pendiente: autorizaciones, margen bajo, prospectos, tickets por asignar, presupuestos al límite.',
      'Inicio → Hoy en las obras le muestra cada obra: qué paso va ahora, cuál sigue y qué sub sigue.']],
    en: ['Getting started', [
      'Team and access → "+ User": create your partner (Owner), PMs, salespeople, subs and clients. Add phone, trade and language.',
      'You don\'t make up passwords: when you tap "Create and send access", the app makes a temporary one (valid 7 days) and shows the message to send by text or WhatsApp with the link and username. The person sets their own password when they log in.',
      'If someone new taps "I don\'t have a user: request access" on the login screen, it shows on Home with a "Create user" button already filled with their name and phone.',
      'Home shows what is pending: approvals, low margin, leads, receipts to assign, budgets at the limit.',
      'Home → Today on jobs shows each job: current step, next step and which sub is next.']] },
  { id: 'job', roles: ['owner', 'pm'], icon: '🏗️', screens: ['#/obras', '#/obra', '#/plantillas'],
    es: ['Crear una obra, plantillas y SCHEDULE', [
      'Obras → "+ Nueva obra": cliente, dirección, tipo, contrato y fechas. En "Tareas de la obra" escoja la plantilla (la ★ sale escogida) o "En blanco". La app ya no pone tareas sola.',
      'Obras → "📋 Plantillas": una plantilla por tipo de obra (incluida la remodelación interior de JKL). Agregue, quite y ordene tareas, con días, oficio y si es inspección. "Pegar varias" agrega una lista de un jalón.',
      'Pestaña Tareas → "📥 Importar SCHEDULE": copie la tab SCHEDULE de la hoja de la obra (con los encabezados) y péguela, o suba el .xlsx. Revise la vista previa y escoja reemplazar o agregar.',
      '"🧹 Quitar tareas que no se usan" quita las que la app ponía sola. Lo que ya tiene fotos, avisos, avance o un cobro ligado nunca se borra.',
      'Cada tarea tiene su trade (carpintería, techo, eléctrico…). En Equipo marque los trades de cada crew: puede ser más de uno. Al poner una plantilla o agregar el crew a la obra, la app le asigna sola las tareas de sus trades.',
      '"👷 Asignar por trade": escoja quién hace cada trade de la obra; un mismo crew puede quedarse con varios de un jalón. Las tareas hechas no cambian.',
      'Pestaña Planos: suba los planos (PDF o fotos) y el scope sin precios; los subs de la obra los ven en su app. Al crear la obra, la app pide los planos y el estimado.',
      'Estimado: súbalo con su número y monto. Cuando el cliente lo aprueba, toque "Aprobado → invoice": queda el invoice con el mismo monto y, si la obra no tenía contrato, ese es el contrato.',
      'Cuando pasa una inspección (aprobada en Permisos o marcada hecha en Tareas), la app avisa a los subs y al cliente lo que sigue, y al sub que le toca: "Ya puede seguir".',
      'Resultado de la inspección (pestaña Permisos o Inicio): "✅ Pasó" o "❌ No pasó" con el motivo del inspector. Si no pasó, la app crea la reinspección (intento 2) y una tarea "Corregir para reinspección" justo antes, al crew de ese trade, y avisa a los dueños y al PM. Si pasa la fecha y no hay resultado, sale en Inicio y llega un aviso después de 24 horas.',
      'Rough-in antes de cerrar (pestaña Tareas): contactos, cajas de luz, A/V, gas y plomería se confirman con foto. Hasta que esté todo y pase la inspección de rough, la app no deja empezar ni marcar hecho "cielo", "forrar" o "drywall". Un dueño puede dejarlo pasar escribiendo por qué (queda en el historial).',
      'Inspecciones de la ciudad: al marcar el permiso como Aprobado (pestaña Permisos), la app pregunta qué inspecciones pidió la ciudad. Palomee las del permiso; cada una trae sugerido "Va después de" (entre los trades) y una fecha si ya la sabe. Toque "Poner en el schedule". También está el botón "🏛️ Inspecciones de la ciudad" en Tareas, y un pendiente en Inicio mientras falten.',
      '"Plantilla o AI": la AI lee el estimado y propone tareas, días y qué sub hace cada una. Ajuste y toque "Guardar en el calendario".',
      'Cada obra tiene un código (EE-0001): dígalo como "Job name" al pagar en Home Depot o Lowe\'s para que el ticket se archive solo.']],
    en: ['Create a job, templates and SCHEDULE', [
      'Jobs → "+ New job": client, address, type, contract and dates. Under "Job tasks" pick the template (the ★ one is preselected) or "Blank". The app no longer adds tasks on its own.',
      'Jobs → "📋 Templates": one template per job type (including JKL interior remodel). Add, remove and reorder tasks, with days, trade and whether it is an inspection. "Paste several" adds a whole list at once.',
      'Tasks tab → "📥 Import SCHEDULE": copy the SCHEDULE tab from the job sheet (with its headers) and paste it, or upload the .xlsx. Check the preview and choose replace or add.',
      '"🧹 Remove unused tasks" removes the ones the app used to add. Anything with photos, notices, progress or a linked payment stage is never deleted.',
      'Each task has its trade (framing, roofing, electrical…). In Team, check each crew\'s trades: it can be more than one. When you apply a template or add the crew to the job, the app assigns them the tasks of their trades.',
      '"👷 Assign by trade": pick who does each trade on the job; one crew can take several at once. Done tasks don\'t change.',
      'Plans tab: upload the plans (PDF or photos) and the scope with no prices; the job\'s subs see them in their app. When creating the job, the app asks for plans and the estimate.',
      'Estimate: upload it with its number and amount. When the client approves it, tap "Approved → invoice": the invoice is created with the same amount and, if the job had no contract, that is the contract.',
      'When an inspection passes (approved in Permits or marked done in Tasks), the app tells subs and the client what is next, and the sub whose turn it is: "You can go ahead".',
      'Inspection result (Permits tab or Home): "✅ Passed" or "❌ Failed" with the inspector\'s reason. If it failed, the app creates the reinspection (attempt 2) and a "Fix for reinspection" task right before it, for that trade\'s crew, and notifies the owners and the PM. If the date passes with no result, it shows on Home and a reminder arrives after 24 hours.',
      'Rough-in before closing (Tasks tab): outlets, light boxes, A/V, gas and plumbing are confirmed with a photo. Until everything is done and the rough inspection passes, the app won\'t let you start or finish "ceiling", "wrap" or "drywall". An owner can let it through by writing why (it stays in the history).',
      'City inspections: when you mark the permit Approved (Permits tab), the app asks which inspections the city required. Check them; each one suggests "Goes after" (between trades) and a date if you know it. Tap "Put in the schedule". There is also a "🏛️ City inspections" button in Tasks, and a to-do on Home until they are set.',
      '"Template or AI": the AI reads the estimate and proposes tasks, days and which sub does each. Adjust and tap "Save to calendar".',
      'Each job has a code (EE-0001): give it as "Job name" when paying at Home Depot or Lowe\'s so the receipt files itself.']] },
  { id: 'today', roles: ['owner', 'pm'], icon: '📋', screens: ['#/hoy'],
    es: ['Tablero de Hoy y avisar al siguiente sub', [
      'Cada obra muestra: Ahora, Sigue y Después, con el sub y su estado (sin avisar, avisado, confirmó).',
      'Toque "📣 Avisar": al sub le llega la notificación y se abre WhatsApp con el mensaje ya escrito en su idioma.',
      'El sub confirma desde su app. Si cambia la fecha, tiene que volver a confirmar.',
      'Arriba ve lo pendiente de la empresa: autorizaciones, inspecciones, invoices por revisar, casos y tickets.']],
    en: ['Today board and notifying the next sub', [
      'Each job shows: Now, Next and After, with the sub and their status (not notified, notified, confirmed).',
      'Tap "📣 Notify": the sub gets a notification and WhatsApp opens with the message already written in their language.',
      'The sub confirms from their app. If the date changes, they must confirm again.',
      'At the top you see company to-dos: approvals, inspections, invoices to review, cases and receipts.']] },
  { id: 'lines', roles: ['owner', 'pm'], icon: '🧾', screens: ['#/obra'],
    es: ['Partidas y margen de cada obra', [
      'Pestaña Partidas: agregue lo que se vendió (PC-01 Patio cover, ELECT-01…) con lo vendido.',
      'Costo = lo gastado en esa partida + lo que todavía falta pagarle a sus subs. Así el margen es real desde el primer día.',
      'Abajo, "Sin partida": elija la partida de cada gasto o sub. Los pagos a un sub caen solos en su partida.',
      'En rojo: partidas con margen menor a 35% o en negativo. "Pase directo" = se le cobra al cliente lo que cueste de verdad.']],
    en: ['Line items and job margin', [
      'Line items tab: add what was sold (PC-01 Patio cover, ELECT-01…) with the sold amount.',
      'Cost = spent on that item + what is still owed to its subs. So the margin is real from day one.',
      'Below, "No line item": pick the line item for each expense or sub. Sub payments land on their line item automatically.',
      'In red: items below 35% margin or negative. "Pass-through" = the client is billed the actual cost.']] },
  { id: 'split', roles: ['owner'], icon: '🤝', screens: ['#/reportes', '#/obra'],
    es: ['Reparto de ganancia y alerta de margen', [
      'Cada obra muestra cuánto le toca a cada quien (normal: Jack 35%, Glaiber 35%, empresa 30%).',
      'Para una obra especial: "Cambiar en esta obra".',
      'Para cambiar el reparto normal o la alerta de margen: Dinero → Reportes → "Reparto normal y alerta de margen". Al otro dueño le llega un aviso.',
      'Dinero → Reportes → Reparto de ganancias: total del año por persona, real (obras terminadas) y proyectado (activas).']],
    en: ['Profit split and margin alert', [
      'Each job shows each person\'s share (standard: Jack 35%, Glaiber 35%, company 30%).',
      'For a special job: "Change for this job".',
      'To change the standard split or margin alert: Money → Reports → "Standard split and margin alert". The other owner gets a notice.',
      'Money → Reports → Profit split: year total per person, actual (completed jobs) and projected (active).']] },
  { id: 'expenses', roles: ['owner', 'pm', 'worker'], icon: '🧾', screens: ['#/gastos', '#/obra'],
    es: ['Gastos y escanear tickets', [
      'Botón verde "Escanear": tome foto del ticket (o varios) o suba un PDF.',
      'La app lee tienda, fecha, total e impuesto y lo pone en la obra correcta (por el código de obra, la dirección o el cliente) y en su partida cuando es clara.',
      'Si escanea desde adentro de una obra, se archiva en esa obra.',
      'Dueño: si los tickets no se leen solos, falta la clave de lectura (Mi cuenta → Lectura automática de tickets).',
      'Si no está segura, queda "Por asignar" en Inicio: elija la obra con un toque.',
      'También puede escribir el gasto a mano en la pestaña Gastos de la obra.',
      'Dueño o PM: en Gastos (y en la pestaña Gastos de cada obra) los botones Todo, Materiales, Subs y trabajadores, y Otros separan los gastos, cada uno con su total. En Subs y trabajadores sale cuánto lleva cada persona; en Materiales, cada tienda. "Descargar para Excel" baja solo lo que está viendo.',
      '"🧾 Registrar ticket" (en Gastos o en la pestaña Gastos de la obra): tienda, número de ticket, fecha, cómo se pagó, foto y subtotal. El impuesto (8.25%) sale solo; se puede cambiar o poner "Sin impuesto".',
      '"➗ Dividir el ticket": una parte a cada obra o partida, otra a "Gasto general de la empresa" (la herramienta va ahí) y lo personal aparte (no cuenta como gasto). Los renglones deben sumar el subtotal.',
      'La misma tienda con el mismo número de ticket no entra dos veces. Solo un dueño lo puede pasar, escribiendo el motivo (queda en el historial). Sin número, la app avisa si hay otro con el mismo total, fecha y tienda.',
      'Un ticket escaneado que quedó "Por asignar" se registra con "➗ Con número / dividir".',
      'Dueños: Gastos → "Empresa (gasto general)" para herramienta, gasolina, seguros, oficina…; "Tickets" para revisar la semana contra la tarjeta; "Para la contadora (CSV)" baja obras y empresa del periodo, en inglés. "⚙ Impuesto" cambia el porcentaje.',
      'PM: los gastos arriba de su límite quedan esperando la autorización de un dueño.']],
    en: ['Expenses and scanning receipts', [
      'Green "Scan" button: take a photo of the receipt (or several) or upload a PDF.',
      'The app reads store, date, total and tax and files it to the right job (by job code, address or client) and its line item when clear.',
      'If you scan from inside a job, it is filed to that job.',
      'Owner: if receipts are not read automatically, the reading key is missing (My account → Automatic receipt reading).',
      'If unsure, it stays "To assign" on Home: pick the job with one tap.',
      'You can also type the expense in the job\'s Expenses tab.',
      'Owner or PM: in Expenses (and in each job\'s Expenses tab) the All, Materials, Subs and workers, and Other buttons split the expenses, each with its total. Subs and workers shows how much each person has; Materials, each store. "Download for Excel" downloads just what you are viewing.',
      '"🧾 Record ticket" (in Expenses or the job\'s Expenses tab): store, ticket number, date, payment method, photo and subtotal. The tax (8.25%) is calculated for you; you can change it or choose "No tax".',
      '"➗ Split the ticket": one part to each job or line item, another to "Company overhead" (tools go there) and personal items separately (not an expense). The lines must add up to the subtotal.',
      'The same store with the same ticket number cannot be entered twice. Only an owner can override it, writing the reason (it stays in the history). Without a number, the app warns if there is another with the same total, date and store.',
      'A scanned ticket left "To assign" is recorded with "➗ With number / split".',
      'Owners: Expenses → "Company (overhead)" for tools, fuel, insurance, office…; "Tickets" to check the week against the card; "For the accountant (CSV)" downloads jobs and company for the period, in English. "⚙ Tax" changes the percentage.',
      'PM: expenses above your limit wait for an owner\'s approval.']] },
  { id: 'subs', roles: ['owner', 'pm'], icon: '👷', screens: ['#/obra', '#/cuentas'],
    es: ['Subs: estimados, invoices y pagos', [
      'Pestaña Subcontratistas de la obra: agregue al sub con lo acordado.',
      'El sub manda su estimado o invoice desde su app. Usted lo revisa en Inicio: aceptar el estimado lo suma a lo acordado; aprobar el invoice lo vuelve gasto.',
      '"Registrar pago": parcial o completo, con método (Zelle, cheque, depósito), fecha y número de confirmación.',
      'Plan de pago de cada sub (debajo de su renglón): 50/50, por avance o un solo pago al final (la app sugiere un solo pago si es menos de $3,500). La app dice cuánto toca pagar según sus tareas.',
      'Cada pago a un sub lo autorizan los dos dueños: uno toca "Pedir autorización del pago" y el otro lo aprueba en Inicio. Si lo pide un PM, firman los dos dueños. Se cambia en Mi cuenta → Pagos a subs y avisos.',
      'Dinero → Cuentas → estado de cuenta de cada sub: lo pagado y lo que se le debe (PDF para mandarle).']],
    en: ['Subs: estimates, invoices and payments', [
      'Job Subcontractors tab: add the sub with the agreed amount.',
      'The sub sends their estimate or invoice from their app. Review it on Home: accepting the estimate adds to the agreed amount; approving the invoice makes it an expense.',
      '"Record payment": partial or full, with method (Zelle, check, deposit), date and confirmation number.',
      'Each sub\'s payment plan (under their row): 50/50, by progress or one payment at the end (the app suggests one payment under $3,500). The app shows what is due based on their tasks.',
      'Every sub payment is approved by both owners: one taps "Request payment approval" and the other approves it on Home. If a PM requests it, both owners sign. Change it in My account → Sub payments and notices.',
      'Money → Accounts → each sub\'s statement: paid and owed (PDF to send them).']] },
  { id: 'client', roles: ['owner', 'pm'], icon: '💵', screens: ['#/obra', '#/cuentas'],
    es: ['Cobrar al cliente', [
      'Botón "PDF para el cliente": estimado o contrato con change orders y pagos.',
      'El cliente firma desde su portal; queda la firma en el PDF.',
      'Change orders: cada uno con su código por categoría y número de la obra (GAS-01, PERMIT-02…). Pendiente → aprobado (suma al contrato) → facturado → cobrado. "Hecho" marca el trabajo aparte: un CO puede estar cobrado y el trabajo todavía no.',
      'Cobros: depósito, pagos por avance y final (pestaña Propuesta y cobros), cada uno con su invoice. Los change orders se cobran aparte con "Facturar". Si el trabajo de un CO ya está hecho y no se ha facturado, sale en Inicio → Cobros.',
      'Pestaña Pagos del cliente: registre cada pago; en "Aplicar a" escoja el contrato o un change order. Lo que va al contrato se aplica a las etapas en orden.',
      'Dinero → Cobros: de todas las obras, cobrado contra por cobrar, change orders sin cobrar, los que esperan al cliente y lo vencido. Dinero → Cuentas → estado de cuenta del cliente.']],
    en: ['Billing the client', [
      '"Client PDF" button: estimate or contract with change orders and payments.',
      'The client signs from their portal; the signature appears on the PDF.',
      'Change orders: each with a code by category and job number (GAS-01, PERMIT-02…). Pending → approved (added to contract) → invoiced → collected. "Done" tracks the work separately: a CO can be collected before the work is done.',
      'Billing: deposit, progress and final payments (Proposal and billing tab), each with its invoice. Change orders are billed separately with "Invoice". If a CO\'s work is done and not invoiced, it shows on Home → Billing.',
      'Client payments tab: record each payment; under "Apply to" choose the contract or a change order. Contract payments apply to the stages in order.',
      'Money → Billing: for every job, collected vs. outstanding, change orders not collected, those waiting on the client and anything overdue. Money → Accounts → client statement.']] },
  { id: 'calendar', roles: ['owner', 'pm'], icon: '📅', screens: ['#/calendario'],
    es: ['Calendario y cambios de fecha', [
      'Arriba elija Día, Semana o Mes; las flechas avanzan o regresan. Toque un número de día para verlo completo. La app recuerda la última vista.',
      'Toque una tarea → "Reprogramar" y ponga la nueva fecha (o déjela vacía para que el sub proponga cuándo puede).',
      'Escriba el motivo: al sub le llega el aviso y responde si puede; al cliente se le avisa sin el motivo interno.',
      'Marque "Mover también las tareas siguientes" para recorrer todo el plan los mismos días.']],
    en: ['Calendar and date changes', [
      'At the top choose Day, Week or Month; the arrows move forward or back. Tap a day number to see it in full. The app remembers your last view.',
      'Tap a task → "Reschedule" and enter the new date (or leave it empty so the sub proposes when they can).',
      'Write the reason: the sub gets a notice and replies if they can; the client is notified without the internal reason.',
      'Check "Also move the following tasks" to shift the whole plan by the same days.']] },
  { id: 'summary', roles: ['owner', 'pm'], icon: '🖨', screens: ['#/obra'],
    es: ['Imprimir el resumen de una obra', [
      'En la obra toque "🖨 Resumen / imprimir". Arriba tiene "← Volver a la obra" para regresar.',
      'Dueño o PM: "Para el cliente" no lleva costos; "Interno (con costos)" agrega gastos, ganancia y lo que se debe a cada sub (no se lo mande al cliente).',
      '"🖨 Imprimir" lo manda a la impresora o lo guarda como PDF. "📄 PDF" da el PDF formal para mandarlo por WhatsApp o correo.',
      'En la app instalada, cualquier PDF o archivo se abre en un cuadro con "Imprimir o compartir", "Guardar" y "Cerrar", sin salirse de la app.']],
    en: ['Print a job summary', [
      'In the job tap "🖨 Summary / print". At the top, "← Back to the job" takes you back.',
      'Owner or PM: "For the client" has no costs; "Internal (with costs)" adds expenses, profit and what each sub is owed (don\'t send it to the client).',
      '"🖨 Print" sends it to the printer or saves it as PDF. "📄 PDF" gives the formal PDF to send by WhatsApp or email.',
      'In the installed app, any PDF or file opens in a box with "Print or share", "Save" and "Close", without leaving the app.']] },
  { id: 'translate', roles: ['owner', 'pm', 'worker', 'client'], icon: '🌐', screens: ['#/casos', '#/obra', '#/', '#/textos'],
    es: ['Traducción automática (español ↔ inglés)', [
      'Escriba en su idioma. Si la otra persona usa la app en el otro idioma, lo lee traducido solo.',
      'Debajo de un mensaje traducido dice "🌐 Traducido del inglés · Ver original". Tóquelo para ver lo que la persona escribió de verdad.',
      'Se traduce lo que escribe la gente en casos, avisos de atraso, notas del día, novedades y reportes al cliente, change orders que ve el cliente y textos.',
      'Dueño o PM: en Textos, la casilla "Si la persona habla otro idioma, mandárselo traducido" manda el texto en el idioma de quien lo recibe y guarda lo que usted escribió.',
      'Dueño o PM: el idioma de cada persona es el que eligió en ES | EN (o en Equipo y accesos). La traducción usa la misma clave que la lectura de tickets.']],
    en: ['Automatic translation (Spanish ↔ English)', [
      'Write in your language. If the other person uses the app in the other language, they read it translated automatically.',
      'Under a translated message it says "🌐 Translated from Spanish · See original". Tap it to see what the person actually wrote.',
      'It translates what people write in cases, delay notices, daily notes, client updates and reports, change orders the client sees, and texts.',
      'Owner or PM: in Texts, the "If the person speaks another language, send it translated" box sends the text in the recipient\'s language and keeps what you wrote.',
      'Owner or PM: each person\'s language is the one they chose with ES | EN (or in Team and access). Translation uses the same key as receipt reading.']] },
  { id: 'cases', roles: ['owner', 'pm', 'worker', 'client'], icon: '⚠️', screens: ['#/casos', '#/obra', '#/'],
    es: ['Casos: problemas y preguntas con fotos', [
      'Sub: en su obra toque "⚠️ Hay un problema", explique y mande fotos. Solo lo ve la empresa.',
      'Cliente: en su portal toque "Hacer una pregunta".',
      'Dueño o PM: responda dentro del caso. Cada mensaje es 🔒 Interno o 👁 Para el cliente.',
      'Dueño o PM: al abrir un caso elija los subs que participan (pueden ser varios), el responsable y la fecha límite. En un caso abierto: botones "📌 Responsable y fecha" y "👥 Subs".',
      'Dueño o PM: si un sub o el cliente abre un caso, queda a cargo del encargado de la obra (un PM o un dueño, en Editar obra → "Project manager a cargo"). Al responsable le llega el aviso.',
      'Dueño o PM: si nadie contesta en 24 horas (4 si es urgente), la app le recuerda a quien le toca contestar; si sigue sin respuesta otro tanto, avisa a los dueños. Si se pasa la fecha límite, avisa al responsable y a los dueños. Los avisos solo salen de 7 a.m. a 8 p.m.',
      'Sub: si lo agregan a un caso le llega un aviso; puede leer y contestar lo interno. En "Mis pendientes" (arriba en Mis obras) ve lo que espera su respuesta.',
      'Dueño o PM: "Mis pendientes" arriba en Inicio junta los casos a su cargo, los que esperan su respuesta, los mensajes nuevos y (PM) las tareas atrasadas.',
      'Al cerrar, escriba la decisión. Las fotos de un caso no se borran: son el historial.']],
    en: ['Cases: problems and questions with photos', [
      'Sub: in your job tap "⚠️ There is a problem", explain and send photos. Only the company sees it.',
      'Client: in your portal tap "Ask a question".',
      'Owner or PM: reply inside the case. Each message is 🔒 Internal or 👁 For the client.',
      'Owner or PM: when opening a case, pick the subs who take part (can be several), the person in charge and the due date. In an open case: "📌 Owner and due date" and "👥 Subs" buttons.',
      'Owner or PM: if a sub or the client opens a case, the job\'s manager is put in charge (a PM or an owner, in Edit job → "Project manager in charge"). The person in charge gets the alert.',
      'Owner or PM: if nobody answers in 24 hours (4 if urgent), the app reminds whoever has to answer; if it is still unanswered after the same time, it alerts the owners. If the due date passes, it alerts the person in charge and the owners. Alerts only go out 7 a.m. to 8 p.m.',
      'Sub: if you are added to a case you get an alert; you can read and answer the internal part. "My to-dos" (top of My jobs) shows what is waiting for your answer.',
      'Owner or PM: "My to-dos" at the top of Home gathers cases in your charge, cases waiting for your answer, new messages and (PM) late tasks.',
      'When closing, write the decision. Case photos are never deleted: they are the record.']] },
  { id: 'daily', roles: ['owner', 'pm', 'worker'], icon: '📸', screens: ['#/obra'],
    es: ['Fotos, reporte diario y permisos', [
      'Suba fotos en la obra (o en cada tarea) con "+ Fotos" o 📷. Elija "📷 Tomar foto" para usar la cámara, o "🖼️ Galería o archivos" para escoger fotos que ya tiene: en Android salen Galería, Google Fotos y Google Drive; en iPhone, Fotos y Archivos (ahí aparece Google Drive si tiene la app). Puede escoger varias a la vez.',
      'Cada foto lleva su etapa (la tarea) y su trade (concreto, techo, electricidad…). La app los sugiere solos según la tarea en progreso y quién la hace; usted los puede cambiar.',
      'En la pestaña Fotos filtre por etapa o por trade. "✎ Clasificar" en una foto cambia su etapa, trade o comentario (un sub solo las suyas).',
      'Las fotos finales entran solas a la galería al terminar la obra.',
      'Pestaña Reporte diario: qué se hizo hoy, con fotos; al cliente le llega la novedad.',
      'Pestaña Permisos: número de permiso e inspecciones con fecha; la app avisa las que vienen.']],
    en: ['Photos, daily report and permits', [
      'Upload photos on the job (or on each task) with "+ Photos" or 📷. Choose "📷 Take photo" to use the camera, or "🖼️ Gallery or files" to pick photos you already have: on Android you get Gallery, Google Photos and Google Drive; on iPhone, Photos and Files (Google Drive shows up there if you have the app). You can pick several at once.',
      'Each photo has its stage (the task) and its trade (concrete, roofing, electrical…). The app suggests them from the task in progress and who does it; you can change them.',
      'In the Photos tab filter by stage or by trade. "✎ Classify" on a photo changes its stage, trade or comment (a sub only their own).',
      'Final photos go to the gallery automatically when the job is completed.',
      'Daily report tab: what was done today, with photos; the client gets the update.',
      'Permits tab: permit number and dated inspections; the app reminds you of upcoming ones.']] },
  { id: 'inventory', roles: ['owner', 'pm', 'admin', 'accountant'], icon: '🧰', screens: ['#/inventario'],
    es: ['Inventario de herramienta y equipo', [
      'Menú → Inventario. Cada herramienta o equipo lleva su etiqueta (H-0001), dónde está (bodega, una obra o en reparación), su estado, lo que costó y su garantía.',
      'La herramienta no se presta a personas: se queda en la bodega o en una obra. Con "Mover" la cambia de lugar y queda en el historial quién la movió y cuándo. "La vi" confirma que sigue donde dice.',
      'Lo que se compra de herramienta o equipo como gasto de la compañía aparece arriba en "Compras sin pasar al inventario": tóquele "Pasar al inventario" y se llena solo con el costo, la tienda y la fecha. Si compró varias iguales, ponga cuántas y cada una lleva su etiqueta.',
      'Si se rompe, márquela "Necesita reparación" o muévala a reparación; si ya no sirve, dela de baja con el motivo (queda el historial). La app avisa 30 días antes de que venza una garantía.',
      'Dueños y oficina la manejan. El PM la ve sin costos y la mueve entre la bodega y sus obras. La contadora ve todo con costos. El sub ve qué herramienta hay en su obra.']],
    en: ['Tool and equipment inventory', [
      'Menu → Inventory. Each tool or piece of equipment has its tag (H-0001), where it is (yard, a job or in repair), its condition, what it cost and its warranty.',
      'Tools are not lent to people: they stay at the yard or at a job. "Move" changes the location and the history keeps who moved it and when. "Seen" confirms it is where it says.',
      'Tools or equipment bought as a company expense show up at the top under "Tool purchases not yet in the inventory": tap "Add to inventory" and it fills in the cost, store and date. If you bought several of the same, enter how many and each one gets its own tag.',
      'If it breaks, mark it "Needs repair" or move it to repair; if it no longer works, retire it with the reason (the history is kept). The app alerts 30 days before a warranty expires.',
      'Owners and the office admin manage it. The PM sees it without costs and moves it between the yard and their jobs. The accountant sees everything with costs. The sub sees which tools are at their job.']] },
  { id: 'monthclose', roles: ['owner', 'accountant'], icon: '📦', screens: ['#/cierre', '#/'],
    es: ['Cierre de mes', [
      'Menú → Cierre de mes (la contadora lo tiene en Contabilidad). Escoja el mes: la app revisa tickets sin foto, tickets sin obra, invoices de subs sin aprobar y cambios esperando aprobación.',
      '"Paquete del mes (.zip)": todos los archivos para Excel y QuickBooks de ese mes y la foto de cada ticket, listo para mandarlo a la contadora.',
      '"Cerrar el mes" (un dueño): desde ese momento nadie agrega, cambia ni borra gastos, pagos o tickets de ese mes ni de antes. Para reabrirlo hace falta el otro dueño.']],
    en: ['Month close', [
      'Menu → Month close (the accountant has it in Accounting). Choose the month: the app checks receipts without a photo, receipts without a job, sub invoices not approved and changes waiting for approval.',
      '"Month package (.zip)": all the Excel and QuickBooks files for that month and the photo of every receipt, ready to send to the accountant.',
      '"Close the month" (an owner): from then on nobody adds, changes or deletes expenses, payments or receipts in that month or before. Reopening it needs the other owner.']] },
  { id: 'webhooks', roles: ['owner'], icon: '🔌', screens: ['#/equipo'],
    es: ['Conexiones con otros sistemas (webhooks)', [
      'En Equipo, abajo: "+ Conexión". Ponga la dirección https que le dé el otro sistema (su agente Grok, Zapier, Make, Google Sheets…) y escoja qué avisos manda: gasto registrado, ticket, resultado de inspección, change order, pago del cliente, caso abierto, reporte del día, mes cerrado, obra nueva o tarea terminada.',
      'Al crearla, la app enseña una clave secreta una sola vez: guárdela en el otro sistema. Cada aviso trae el encabezado X-EE-Signature para comprobar que viene de la app.',
      '"Probar" manda un aviso de prueba. Si falla, se reintenta 2 veces y se marca "Falló". Puede pausarla, hacer una clave nueva o borrarla.',
      'Los agentes (Eli) reciben también el resumen de la mañana por aquí. Solo se permiten direcciones https públicas.']],
    en: ['Connections to other systems (webhooks)', [
      'In Team, at the bottom: "+ Connection". Enter the https address the other system gives you (your Grok agent, Zapier, Make, Google Sheets…) and choose which notices it sends: expense recorded, receipt, inspection result, change order, client payment, case opened, daily report, month closed, new job or task finished.',
      'When created, the app shows a secret key only once: save it in the other system. Every notice carries the X-EE-Signature header to verify it comes from the app.',
      '"Test" sends a test notice. If it fails, it retries twice and is marked "Failed". You can pause it, make a new key or delete it.',
      'Agents (Eli) also receive the morning summary through here. Only public https addresses are allowed.']] },
  { id: 'digest', roles: ['owner', 'pm', 'sales', 'worker', 'admin'], icon: '☀️', screens: ['#/resumen'],
    es: ['Resumen de la mañana', [
      'Cada mañana a las 6:30 le llega un aviso con su día. Al tocarlo abre "Resumen de hoy" (también está en el menú).',
      'Dueños: trabajo de hoy en cada obra, inspecciones (y las que no tienen resultado), lo que espera su aprobación, pagos a subs que tocan, cobros, casos urgentes, papeles por vencer y tickets por asignar.',
      'PM: lo mismo de sus obras, sin el dinero de la compañía. Vendedor: sus citas y seguimientos. Sub: sus tareas de hoy. Oficina: tickets y papeles.',
      'Abajo puede apagar su aviso. Los dueños cambian la hora para todos y pueden ver el resumen de cualquier persona del equipo. Los domingos no se manda.']],
    en: ['Morning summary', [
      'Every morning at 6:30 you get an alert with your day. Tapping it opens "Today\'s summary" (also in the menu).',
      'Owners: today\'s work on each job, inspections (and the ones without a result), what is waiting for approval, sub payments due, billing, urgent cases, expiring documents and receipts to assign.',
      'PM: the same for their jobs, without company money. Salesperson: their appointments and follow-ups. Sub: their tasks for today. Office admin: receipts and documents.',
      'At the bottom you can turn your alert off. Owners change the time for everyone and can see any team member\'s summary. It is not sent on Sundays.']] },
  { id: 'drafts', roles: ['owner', 'pm'], icon: '✉️', screens: ['#/textos'],
    es: ['Textos listos para mandar', [
      'La app deja listos los textos de siempre: al cliente "mañana trabajamos en su casa", el recordatorio de la inspección de mañana y el recordatorio de cobro; al sub lo suyo de mañana (sin horario) y "pasó la inspección, ya puede seguir".',
      'Salen en el idioma de cada persona y nunca llevan dinero. Nada se manda solo: usted los revisa, los cambia si quiere y toca Mandar.',
      'Si los textos de la empresa (Twilio) todavía no están conectados, toque "Abrir en Mensajes" o "Copiar" para mandarlo desde su teléfono, y luego "Ya lo mandé". "No mandar" lo quita.',
      'Están en Textos, y en Inicio sale cuántos hay listos.']],
    en: ['Texts ready to send', [
      'The app prepares the usual texts: to the client "tomorrow we work at your home", tomorrow\'s inspection reminder and the payment reminder; to the sub their work for tomorrow (no times) and "the inspection passed, you can continue".',
      'They come in each person\'s language and never include money. Nothing is sent on its own: you review them, edit them if you want and tap Send.',
      'If company texting (Twilio) is not connected yet, tap "Open in Messages" or "Copy" to send it from your phone, then "I sent it". "Don\'t send" removes it.',
      'They are in Texts, and Home shows how many are ready.']] },
  { id: 'companydocs', roles: ['owner', 'pm', 'admin', 'accountant'], icon: '📁', screens: ['#/documentos'],
    es: ['Papeles de la compañía y plantillas', [
      'Menú → Documentos. Suba licencias, seguros, el registro de contratista de cada ciudad y el W-9 de la compañía, con su fecha de vencimiento.',
      'La app avisa 30 días antes de que venza y el día que vence (a los dueños y a la oficina). En Inicio sale "Papeles por vencer". Al renovarlo, ponga la fecha nueva y suba el archivo nuevo.',
      'Los suben los dueños y Administración; el PM y la contadora los ven (el PM los necesita para sacar permisos). Solo un dueño los borra.',
      'Plantillas (dueños): contrato, change order y certificado de garantía. Se llenan solas con los datos de la obra. Con "Cambiar texto" ponga su propio texto; los datos van entre llaves dobles, por ejemplo {{client_name}}. Pida a su abogado que revise el texto.']],
    en: ['Company documents and templates', [
      'Menu → Documents. Upload licenses, insurance, the contractor registration for each city and the company W-9, with their expiration date.',
      'The app alerts 30 days before it expires and on the day it expires (to the owners and the office admin). Home shows "Documents expiring". When you renew, enter the new date and upload the new file.',
      'Owners and the office admin upload them; the PM and the accountant can see them (the PM needs them to pull permits). Only an owner can delete them.',
      'Templates (owners): contract, change order and warranty certificate. They fill in with the job information. With "Change text" use your own wording; data goes between double braces, for example {{client_name}}. Have your attorney review the text.']] },
  { id: 'jobcontract', roles: ['owner', 'pm'], icon: '✍️', screens: ['#/obra/'],
    es: ['Contrato y garantías de la obra', [
      'Pestaña "Contrato y garantías" de cada obra. "Hacer contrato" lo llena solo con el cliente, la dirección, el precio, los pagos y las fechas, y sale en PDF listo para firmar. También puede subir el contrato que ya tiene.',
      'Cuando esté firmado, un dueño le toca "Firmado" y sube la copia firmada: desde ahí ya no se cambia ni se borra. Con "Lo ve el cliente" aparece en su portal. Los subs nunca lo ven (lleva precio).',
      '"Hacer change order en PDF": escoja el change order y sale listo para firmar, con el total nuevo.',
      'Garantías: la de trabajo (12 meses desde que se terminó la obra) sale sola. Agregue las de fábrica de lo que se instaló (marca, modelo, número de serie, hasta cuándo y la foto o el PDF). El cliente las ve en su portal y le avisamos 30 días antes de que venzan. "Certificado de garantía" sale en PDF cuando la obra ya se terminó.']],
    en: ['Job contract and warranties', [
      '"Contract and warranties" tab on each job. "Make contract" fills it in with the client, address, price, payments and dates, as a PDF ready to sign. You can also upload the contract you already have.',
      'When it is signed, an owner taps "Signed" and uploads the signed copy: from then on it cannot be changed or deleted. With "Client sees it" it shows in their portal. Subs never see it (it has the price).',
      '"Make change order PDF": choose the change order and it comes out ready to sign, with the new total.',
      'Warranties: the workmanship warranty (12 months from completion) is automatic. Add manufacturer warranties for what was installed (brand, model, serial number, end date and the photo or PDF). The client sees them in their portal and we alert you 30 days before they expire. "Warranty certificate" comes out as a PDF once the job is completed.']] },
  { id: 'roles', roles: ['owner'], icon: '🧩', screens: ['#/equipo'],
    es: ['Puestos y permisos', [
      'En Equipo → "+ Usuario" escoja el puesto. Abajo de la lista, la tabla "Puestos y permisos" dice qué puede hacer cada uno.',
      'Administración (oficina): escanea y registra tickets y gastos de la compañía. No ve precios, ganancias ni pagos de las obras. No borra ni cambia lo ya registrado, ni puede registrar un reembolso a su nombre: eso lo hace un dueño.',
      'Contadora (solo ver): ve y baja gastos, tickets, ganancia por tipo, pagos de clientes, invoices de subs y el reporte 1099. No puede cambiar nada.',
      'Permisos por persona (🔸): al editar a alguien se prenden extras que le tocan a su puesto. Trabajador/sub: "Encargado de cuadrilla" (escribe el reporte del día de sus obras). PM: "Ve todas las obras" y Ventas. Administración: "Ve los gastos de las obras". Contadora: "Ve el reparto de ganancia".',
      'Solo los dueños aprueban pagos y cambios de dinero, y solo los dueños agregan usuarios.']],
    en: ['Positions and permissions', [
      'In Team → "+ User" choose the position. Below the list, the "Positions and permissions" table shows what each one can do.',
      'Office admin: scans and records receipts and company expenses. Does not see job prices, profit or payments. Cannot delete or change what is already recorded, or record a reimbursement in their own name: an owner does that.',
      'Accountant (view only): sees and downloads expenses, receipts, profit by type, client payments, sub invoices and the 1099 report. Cannot change anything.',
      'Per-person permissions (🔸): when editing someone, turn on extras that fit their position. Worker/sub: "Crew lead" (writes the daily report for their jobs). PM: "Sees all jobs" and Sales. Office admin: "Sees job expenses". Accountant: "Sees the profit split".',
      'Only owners approve payments and money changes, and only owners add users.']] },
  { id: 'office', roles: ['admin', 'accountant'], icon: '🏢', screens: ['#/', '#/gastos'],
    es: ['Su puesto: oficina o contadora', [
      'Administración: en Inicio, "Escanear tickets" o "Registrar ticket". Lo que no es de una obra va como gasto de la empresa (Gastos → Empresa). Si algo quedó mal, pídale a un dueño que lo corrija.',
      'Contadora: en Contabilidad escoja las fechas y baje los archivos para Excel o QuickBooks. En Gastos ve cada gasto y cada ticket con su foto.']],
    en: ['Your position: office or accountant', [
      'Office admin: on Home, "Scan receipts" or "Record receipt". Anything that is not for a job goes as a company expense (Expenses → Company). If something is wrong, ask an owner to fix it.',
      'Accountant: in Accounting choose the dates and download the files for Excel or QuickBooks. In Expenses you see every expense and every receipt with its photo.']] },
  { id: 'crewlead', roles: ['worker'], icon: '📒', screens: ['#/obra/'],
    es: ['Encargado de cuadrilla: reporte del día', [
      'Si el dueño le prendió "Encargado de cuadrilla", en cada obra le sale el botón "📒 Reporte del día". Escriba qué se hizo, quiénes trabajaron, el clima y agregue fotos.',
      'Lo ven los dueños y el project manager, y queda en el historial de la obra. Al cliente no se le manda.',
      'Si a las 6:30 PM no hay reporte, le llega un aviso.']],
    en: ['Crew lead: daily report', [
      'If the owner turned on "Crew lead" for you, each job shows the "📒 Daily report" button. Write what was done, who worked, the weather and add photos.',
      'The owners and the project manager see it, and it stays in the job\'s daily log. It is not sent to the client.',
      'If there is no report by 6:30 PM, you get an alert.']] },
  { id: 'history', roles: ['owner', 'pm'], icon: '📒', screens: ['#/obra/'],
    es: ['Historial diario de la obra', [
      'Pestaña "Historial diario" de cada obra: lo que pasó cada día, junto solo. Tareas empezadas y terminadas, fechas movidas, inspecciones con su resultado, fotos, rough-in confirmado, change orders, casos, tickets, avisos al cliente, el plan del día y el reporte del día.',
      'Se guarda en inglés: es el registro de la compañía. Usted lo lee en su idioma. Lo que escribe la gente se traduce y el original siempre queda. Nunca lleva montos de dinero.',
      'A las 6:30 PM, si una obra trabajó y nadie escribió el reporte del día, le llega un aviso al PM de la obra (o a los dueños si no tiene PM). En Inicio sale "Falta el reporte del día".',
      'A las 10 PM el día se cierra solo y queda congelado: ya no cambia. También lo puede cerrar antes con "Cerrar el día". Lo que falte después va como "nota tardía", con nombre, fecha y hora.',
      '"PDF del día" o "PDF de toda la obra", en inglés; con "PDF en español" sale en español. Sirve para el cliente, el seguro o un reclamo.',
      'Lo ven los dueños y el PM de la obra. Los subs y el cliente no (el cliente tiene su reporte diario aparte).']],
    en: ['Job daily log', [
      '"Daily log" tab on each job: what happened each day, gathered on its own. Tasks started and finished, rescheduled dates, inspections with their result, photos, confirmed rough-in, change orders, cases, receipts, client updates, the daily plan and the daily report.',
      'It is stored in English: it is the company record. You read it in your language. What people write is translated and the original is always kept. It never includes money amounts.',
      'At 6:30 PM, if a job had work and nobody wrote the daily report, the job PM (or the owners if there is no PM) gets an alert. Home shows "Daily report missing".',
      'At 10 PM the day closes on its own and is frozen: it no longer changes. You can also close it earlier with "Close the day". Anything missing afterwards goes in as a "late entry", with name, date and time.',
      '"Day PDF" or "Whole job PDF", in English; "PDF in Spanish" gives it in Spanish. Useful for the client, insurance or a claim.',
      'Owners and the job PM can see it. Subs and the client cannot (the client has their own daily report).']] },
  { id: 'dayplan', roles: ['owner', 'pm', 'sales', 'worker'], icon: '📋', screens: ['#/plan?d=manana'],
    es: ['Plan de mañana: qué va a hacer cada quien', [
      'Cada tarde (a las 5 PM llega un aviso) arme el plan de mañana en "Mi plan" → Mañana. En Inicio sale el plan de hoy como lista para palomear.',
      'La app sugiere lo que ya sabe: tareas que tocan, inspecciones, citas, seguimientos y lo atrasado. Toque + o "Agregar todo". También escriba lo suyo, con hora si quiere y la obra.',
      'Lo que no se termina se pasa solo al siguiente día de trabajo en la noche; no se pierde nada.',
      'Los dueños le pueden armar el plan a cualquiera; el PM, a los subs de sus obras; el vendedor y el sub, solo el suyo. Lo que pone el jefe sale "lo pidió …" y quien lo recibe no lo puede borrar ni cambiar: lo marca hecho o "No se pudo" con el motivo, y al jefe le llega el aviso.',
      'Para subs no se pone horario: solo qué se necesita y en qué obra (son contratistas independientes).',
      'Abajo, "Plan del equipo": cuánto lleva hecho cada persona y "Armar" para abrir su plan.']],
    en: ['Tomorrow\'s plan: what each person will do', [
      'Every afternoon (a reminder arrives at 5 PM) build tomorrow\'s plan in "My plan" → Tomorrow. Home shows today\'s plan as a checklist.',
      'The app suggests what it already knows: tasks due, inspections, appointments, follow-ups and overdue items. Tap + or "Add all". You can also type your own, with a time if you want and the job.',
      'What isn\'t finished moves on its own to the next workday at night; nothing gets lost.',
      'Owners can build anyone\'s plan; a PM, the plans of subs on their jobs; sales and subs, only their own. Items added by a boss show "requested by …" and the person can\'t delete or edit them: they mark them done or "Couldn\'t" with the reason, and the boss is notified.',
      'For subs there is no time: only what is needed and on which job (they are independent contractors).',
      'Below, "Team plan": how much each person has done and "Build" to open their plan.']] },
  { id: 'queue', roles: ['owner', 'pm'], icon: '⏳', screens: ['#/fila'],
    es: ['Fila de espera: cuándo arrancar lo vendido', [
      'Cuando se aprueba un estimado (o se firma la propuesta), el trabajo entra a la fila con esa fecha. Los más viejos van primero.',
      'Para cada trabajo la app ve cuándo se libera cada sub (el día después de su última tarea en las obras que ya arrancaron) y propone la fecha de arranque. Puede poner otra fecha.',
      '⭐ Clave: marque los subs fundamentales para empezar (por omisión, los de las primeras etapas: pilares, framing…). El % de listo cuenta solo a los clave.',
      '"Preguntar a los subs": a todos les llega "¿Puede empezar el …?" y contestan sí o no (con la fecha en que sí pueden). Si le contestan por teléfono, toque 📞.',
      'Los que no son clave pueden esperar hasta 7 días (se cambia en "Reglas de la fila"); si tardan más, sale ⚠️.',
      '"Arrancar": la app recorre el schedule a esa fecha, mueve la primera tarea de quien dijo que no a cuando sí puede y les avisa a los subs. Nada arranca solo.']],
    en: ['Waiting line: when to start what was sold', [
      'When an estimate is approved (or the proposal is signed), the job joins the line with that date. Oldest first.',
      'For each job the app sees when each sub frees up (the day after their last task on jobs already started) and proposes the start date. You can set another date.',
      '⭐ Key: mark the subs essential to start (by default, the first stages: piers, framing…). The % ready counts only key subs.',
      '"Ask the subs": everyone gets "Can you start on …?" and answers yes or no (with the date they can). If they answer by phone, tap 📞.',
      'Non-key subs can wait up to 7 days (change it in "Line rules"); longer shows ⚠️.',
      '"Start": the app moves the schedule to that date, moves the first task of whoever said no to when they can, and notifies the subs. Nothing starts on its own.']] },
  { id: 'insp-list', roles: ['owner', 'pm', 'sales'], icon: '🏛️', screens: ['#/inspecciones'],
    es: ['Inspecciones de la ciudad: agregar nuevas', [
      'Menú → "Inspecciones de la ciudad" (el vendedor la encuentra en Mi cuenta): ahí está la lista de las que trae la app y las de la compañía.',
      '"+ Nueva inspección": escriba el nombre (en inglés es opcional), la etapa (antes de colar, rough, finales u otras) y, si sabe, después de qué trade va normalmente. Desde ese momento sale en la pregunta de cada obra, en su lugar entre los trades.',
      'También al poner una inspección con "+ Otra inspección" en una obra: deje la palomita "📌 Agregarla a la lista" y la próxima vez ya sale sola.',
      'Pueden agregar dueños, project managers y vendedores. Quitar una de la lista: el dueño o quien la agregó; las obras que ya la tienen no cambian.']],
    en: ['City inspections: adding new ones', [
      'Menu → "City inspections" (sales finds it under My account): the list of built-in inspections and the company ones.',
      '"+ New inspection": enter the name (English is optional), the stage (pre-pour, rough, finals or others) and, if you know it, which trade it usually follows. From then on it shows up in each job\'s question, in its place between trades.',
      'Also when adding one with "+ Other inspection" on a job: leave "📌 Add it to the list" checked and next time it shows up on its own.',
      'Owners, project managers and sales can add them. Removing one from the list: the owner or whoever added it; jobs that already have it do not change.']] },
  { id: 'materials', roles: ['owner', 'pm', 'sales', 'client'], icon: '🎨', screens: ['#/materiales', '#/obra'],
    es: ['Materiales, colores y galería', [
      'Materiales: busque por nombre, color o marca; cada material tiene foto de cerca y fotos de trabajos terminados.',
      'En cada obra, pestaña Materiales: qué material y color va en cada parte (ceiling, fascia, stain, cubierta…), con su etapa y trade. El cliente la ve en su portal.',
      'Toque ★ en una foto para ponerla o quitarla de la galería. La galería nunca muestra nombre ni dirección de clientes.']],
    en: ['Materials, colors and gallery', [
      'Materials: search by name, color or brand; each material has a close-up and photos of finished jobs.',
      'On each job, Materials tab: which material and color goes where (ceiling, fascia, stain, countertop…), with its stage and trade. The client sees it in their portal.',
      'Tap ★ on a photo to add or remove it from the gallery. The gallery never shows client names or addresses.']] },
  { id: 'selections', roles: ['owner', 'pm'], icon: '🎨', screens: ['#/obra'],
    es: ['Selecciones del cliente', [
      'En la obra → Materiales → Selecciones del cliente. "Armar las de esta obra" pone lo que normalmente se escoge en ese tipo de proyecto (teja, stain, piedra, cubierta, luces…).',
      'Cada una se liga a la tarea que la necesita. Fecha límite = fecha de esa tarea menos los días para pedirlo (7 de entrada). Si la tarea se mueve, la fecha se mueve.',
      'Dos formas: "+ Opción" (del catálogo, con foto) para que el cliente toque una; o "Anotar lo que escogió" si él escogió por su cuenta.',
      'El cliente aprueba en su portal (queda su nombre y la fecha). Si lo aprobó en persona o por texto, toque "Marcar aprobado" y diga cómo.',
      'Recordatorios al cliente 3 días antes, el día y al día siguiente (aviso en su app y texto listo en Textos). Si se atrasa: aviso a los dueños y al PM, sale en el Resumen de hoy y en Mis pendientes, y la tarea se marca en rojo "Detenida".',
      'Al aprobarse, el material entra a la Ficha de materiales (los subs solo ven lo aprobado). Si el cliente cambia algo ya aprobado, les llega aviso: revisen si cuesta un change order.']],
    en: ['Client selections', [
      'On the job → Materials → Client selections. "Set up this job\'s selections" adds what is usually chosen for that type of project (shingles, stain, stone, countertop, lights…).',
      'Each one is tied to the task that needs it. Deadline = that task\'s date minus the days to order it (7 by default). If the task moves, the deadline moves.',
      'Two ways: "+ Option" (from the catalog, with photo) so the client taps one; or "Record their choice" if they chose on their own.',
      'The client approves in their portal (their name and date are recorded). If they approved in person or by text, tap "Mark approved" and say how.',
      'Reminders to the client 3 days before, on the day and the day after (app alert and a ready text in Texts). If it runs late: alert to owners and the PM, it shows in Today\'s summary and My to-dos, and the task is marked red "On hold".',
      'Once approved, the material goes to the Materials sheet (subs only see approved items). If the client changes something already approved, you get an alert: check whether it needs a change order.']] },
  { id: 'lists', roles: ['owner'], icon: '🏷️', screens: ['#/listas'],
    es: ['Categorías y listas', [
      'Más → Categorías y listas (o Mi cuenta → Ajustes de la empresa).',
      'Cinco listas: gastos de obra, gastos de la compañía (diésel, llantas de la traila, landfill, mantenimiento de camionetas…), pago de tickets, pagos a subs (Zelle, cheque, Cash App…) y trades.',
      '+ Agregar: nombre en español y en inglés. Cambiar nombre: también en los dos idiomas.',
      'Esconder: deja de salir para escoger, pero lo que ya se registró conserva su nombre. Las que tienen 🔒 las necesita la app: solo se renombran.',
      'Solo los dueños cambian las listas; cada cambio queda en el historial.']],
    en: ['Categories and lists', [
      'More → Categories and lists (or My account → Company settings).',
      'Five lists: job expenses, company expenses (diesel, trailer tires, landfill, truck maintenance…), receipt payments, payments to subs (Zelle, check, Cash App…) and trades.',
      '+ Add: name in Spanish and English. Rename: also in both languages.',
      'Hide: it stops showing up as a choice, but what was already recorded keeps its name. Items with 🔒 are needed by the app: they can only be renamed.',
      'Only owners change the lists; every change is recorded in the history.']] },
  { id: 'approvals', roles: ['owner'], icon: '🛡️', screens: ['#/historial', '#/'],
    es: ['Autorizaciones, historial y seguridad', [
      'Cambios de $1,000 o más necesitan a los dos dueños; un "no" lo detiene. Si el otro dueño está desactivado, la app espera: no se salta la regla.',
      'También los dos dueños: crear un dueño nuevo, desactivar al otro dueño o quitarle su verificación, change orders de $1,000 o más y apagar una protección.',
      'Cada dueño cambia su propia contraseña. Al cambiarla, se cierra su sesión en los demás teléfonos y computadoras.',
      'Mi cuenta → Seguridad de la compañía: puede exigir el código de 6 dígitos para autorizar dinero. Con la entrada en 2 pasos activada, Autorizar siempre pide el código.',
      'Gastos de subs por revisar (Inicio): lo que registra un sub ya cuenta en la obra; toque "Está bien" o ábralo para corregirlo. Un ticket leído por la AI nunca se guarda solo.',
      'Lo que pide un PM o un agente 🤖 con dinero queda en Inicio para que lo autorice un dueño.',
      'Lo aceptado (estimados, contratos) no se cambia sin autorización y siempre con motivo.',
      'Historial: quién cambió qué, cuándo y por qué. Puede cerrar un periodo para que ya no se modifique.']],
    en: ['Approvals, history and security', [
      'Changes of $1,000 or more need both owners; one "no" stops it. If the other owner is deactivated, the app waits: the rule is not skipped.',
      'Also both owners: creating a new owner, deactivating the other owner or removing their verification, change orders of $1,000 or more, and turning off a protection.',
      'Each owner changes their own password. Changing it signs you out on your other phones and computers.',
      'My account → Company security: you can require the 6-digit code to approve money. With 2-step sign-in on, Approve always asks for the code.',
      'Sub expenses to review (Home): what a sub records already counts on the job; tap "Looks good" or open it to fix it. A receipt read by the AI is never saved on its own.',
      'Money requests from a PM or an agent 🤖 wait on Home for an owner to approve.',
      'Accepted items (estimates, contracts) can\'t change without approval and always with a reason.',
      'History: who changed what, when and why. You can lock a period so it can no longer be edited.']] },
  { id: 'opinions', roles: ['owner'], icon: '⭐', screens: ['#/opiniones'],
    es: ['Opiniones de clientes', [
      'Al terminar una obra, el cliente recibe una encuesta corta: limpieza, puntualidad, comunicación, calidad y la cuadrilla (estrellas), si nos recomendaría (0 a 10), qué mejorar y qué le gustó.',
      'Solo al final, nunca al empezar. El texto con el enlace queda listo en Textos; si no contesta en 3 días, sale un recordatorio (solo uno).',
      'Las respuestas las ven solo los dueños. Al PM solo le llega el promedio de estrellas para su calificación, sin comentarios.',
      'Si alguien califica bajo, les llega un aviso y sale en Inicio: llámele y toque "Ya le llamé" con lo que se acordó.',
      'Opiniones de clientes: promedio por pregunta, por PM, por tipo de proyecto y por sub. Si califica muy bien, al cliente se le ofrece la reseña de Google.']],
    en: ['Client feedback', [
      'When a job is finished, the client gets a short survey: cleanliness, punctuality, communication, quality and the crew (stars), whether they would recommend us (0 to 10), what to improve and what they liked.',
      'Only at the end, never at the start. The text with the link is ready in Texts; if they don\'t answer in 3 days, a reminder goes out (just one).',
      'Only the owners see the answers. The PM only gets the star average for their score, without comments.',
      'If someone rates low, you get an alert and it shows on Home: call them and tap "I called them" with what was agreed.',
      'Client feedback: average per question, per PM, per project type and per sub. If they rate very high, the client is offered the Google review.']] },
  { id: 'pms', roles: ['owner'], icon: '⭐', screens: ['#/pm', '#/equipo'],
    es: ['Project managers y su calificación', [
      'Cree al PM en Equipo y accesos, con su límite por gasto y al mes. Asígnele obras en "Editar obra".',
      'Project managers: reporte del día de cada PM (lo que hizo y su nota) y calificación del mes de 1 a 5.',
      'Toque "Evaluar este mes" para poner su calificación de dueño. El PM no ve su calificación.']],
    en: ['Project managers and their rating', [
      'Create the PM in Team and access, with their per-expense and monthly limits. Assign jobs in "Edit job".',
      'Project managers: each PM\'s daily report (what they did and their note) and monthly rating from 1 to 5.',
      'Tap "Review this month" to add your owner rating. The PM doesn\'t see their rating.']] },
  { id: 'reports', roles: ['owner'], icon: '📈', screens: ['#/reportes', '#/proyecciones', '#/cuentas'],
    es: ['Reportes, proyecciones y cuentas', [
      'Reportes: ganancia por tipo de proyecto, de dónde vienen los clientes, margen por oficio y reparto.',
      'Exportar CSV para el contador o QuickBooks.',
      'Proyecciones: ventas y ganancia de los próximos meses con estadística. Importe su historial para que sea confiable.',
      'Dinero → Cuentas: lo que les deben los clientes y lo que deben a subs.']],
    en: ['Reports, forecasts and accounts', [
      'Reports: profit by project type, where clients come from, margin by trade and profit split.',
      'Export CSV for the accountant or QuickBooks.',
      'Forecasts: next months\' sales and profit using statistics. Import your history to make it reliable.',
      'Money → Accounts: what clients owe you and what you owe subs.']] },
  { id: 'companies', roles: ['owner'], icon: '🏢', screens: ['#/', '#/equipo'],
    es: ['Dos empresas: Elevated Exteriors y JKL Homes', [
      'Toque el botón 🏢 arriba del menú para cambiar de empresa.',
      'La primera vez en JKL toque "Activar": se copian los dueños con el mismo usuario y contraseña.',
      'Cada empresa tiene su propia información; nada se mezcla. Los usuarios se crean en cada empresa.',
      'Formulario de cotización de JKL para su página web: /cotizar.html?co=jkl']],
    en: ['Two companies: Elevated Exteriors and JKL Homes', [
      'Tap the 🏢 button at the top of the menu to switch company.',
      'The first time in JKL tap "Activate": owners are copied with the same username and password.',
      'Each company has its own information; nothing mixes. Users are created in each company.',
      'JKL quote form for your website: /cotizar.html?co=jkl']] },
  { id: 'import', roles: ['owner'], icon: '📥', screens: ['#/obras'],
    es: ['Importar sus libros de Excel', [
      'Obras → "📥 Importar de Excel" → "📁 Elegir de Google Drive": entre a la carpeta y marque uno o varios libros.',
      'Sin Drive conectado: en Google Sheets, Archivo → Descargar → Microsoft Excel (.xlsx), y "Subir de mi computadora".',
      'Revise el resumen y los avisos. Marque los subs que ya están pagados completos.',
      'Toque "Importar esta obra". La misma obra no se importa dos veces.']],
    en: ['Import your Excel books', [
      'Jobs → "📥 Import from Excel" → "📁 Choose from Google Drive": open the folder and check one or several workbooks.',
      'Without Drive connected: in Google Sheets, File → Download → Microsoft Excel (.xlsx), then "Upload from my computer".',
      'Review the summary and warnings. Check the subs already paid in full.',
      'Tap "Import this job". The same job is never imported twice.']] },
  { id: 'agents', roles: ['owner'], icon: '🤖', screens: ['#/equipo', '#/agentes'],
    es: ['Agentes de AI (Grok y otros)', [
      'Equipo y accesos → 🤖 Agentes → "+ Agente": Operador de obras o Vendedor.',
      'Cree una llave (empiece con solo lectura) y cópiela: se muestra una sola vez.',
      'Grok: al crear la llave, copie la "dirección para Grok". En grok.com/connectors → New Connector → Custom, péguela.',
      'Otros bots: "Instrucciones para el bot" y la llave como encabezado Authorization: Bearer.',
      'Lo que mueve dinero queda esperando a un dueño. Quite la llave o apague al agente cuando quiera.']],
    en: ['AI agents (Grok and others)', [
      'Team and access → 🤖 Agents → "+ Agent": Job operator or Salesperson.',
      'Create a key (start read-only) and copy it: it is shown only once.',
      'Grok: when you create the key, copy the "address for Grok". In grok.com/connectors → New Connector → Custom, paste it.',
      'Other bots: "Instructions for the bot" and the key as the Authorization: Bearer header.',
      'Anything that moves money waits for an owner. Revoke the key or turn the agent off anytime.']] },
  { id: 'proposal', roles: ['owner'], icon: '📝', screens: ['#/obra', '#/ventas'],
    es: ['Propuesta al cliente y cobros por etapa', [
      'En la obra (o desde Ventas → "Armar propuesta"): pestaña "Propuesta y cobros".',
      'Agregue cada partida con su precio y su costo estimado. La app le enseña el margen antes de mandar; el cliente nunca ve los costos.',
      'Escriba la descripción, las condiciones y hasta cuándo vale. Arme el calendario de pagos: cada etapa es un % y se cumple al firmar, al terminar una tarea o cuando usted la marque.',
      '"Mandar al cliente": se manda un enlace por texto, WhatsApp o correo. El cliente la ve en su teléfono, baja el PDF y firma con el dedo. No necesita cuenta.',
      'Al firmar, la obra pasa a "En obra" y le llega un aviso. Cuando una etapa se cumple, le avisa "toca cobrar".',
      '"Facturar" saca el invoice en PDF y lo manda con el mismo enlace. Los pagos que registre se aplican solos a las etapas; lo vencido sale en Inicio.']],
    en: ['Client proposal and billing by stage', [
      'In the job (or from Sales → "Build proposal"): "Proposal and billing" tab.',
      'Add each line item with its price and estimated cost. The app shows the margin before sending; the client never sees costs.',
      'Write the description, terms and valid-until date. Build the payment schedule: each stage is a % and is reached at signing, when a task is done, or when you mark it.',
      '"Send to client": a link goes out by text, WhatsApp or email. The client views it on their phone, downloads the PDF and signs with a finger. No account needed.',
      'When signed, the job becomes "In progress" and you get a notice. When a stage is reached, you get "time to bill".',
      '"Invoice" creates the PDF invoice and sends it with the same link. Payments you record are applied to the stages automatically; overdue shows on Home.']] },
  { id: 'papers', roles: ['owner'], icon: '📁', screens: ['#/dinero', '#/papeles'],
    es: ['Papeles de los subs: W-9, seguro, lien waivers y 1099', [
      'Dinero → "Subs: papeles y 1099". Ahí sale cada sub con lo que le falta.',
      '"Abrir" en un sub: suba su W-9 (foto o PDF), diga qué tipo de empresa es, y suba su certificado de seguro con la fecha en que vence.',
      'La app le avisa en Inicio 30 días antes de que venza el seguro, y cuando ya venció.',
      'Lien waivers: por cada pago que le hizo al sub, suba el waiver firmado. Use las formas oficiales de Texas tal cual (hay enlace abajo de la tabla); la app no las redacta.',
      '1099: la app suma lo pagado a cada sub en el año y marca a quién hay que mandarle 1099-NEC (no aplica a corporaciones). "Reporte 1099 (CSV)" baja la lista para su contador. Para 2026 el mínimo es $2,000; confírmelo con su contador.']],
    en: ['Sub paperwork: W-9, insurance, lien waivers and 1099', [
      'Money → "Subs: paperwork and 1099". Each sub shows what is missing.',
      '"Open" on a sub: upload their W-9 (photo or PDF), set the entity type, and upload their insurance certificate with its expiration date.',
      'Home warns you 30 days before insurance expires, and once it has expired.',
      'Lien waivers: for each payment to the sub, upload the signed waiver. Use the official Texas forms as-is (link below the table); the app does not draft them.',
      '1099: the app totals what each sub was paid in the year and flags who needs a 1099-NEC (corporations are exempt). "1099 report (CSV)" downloads the list for your accountant. For 2026 the threshold is $2,000; confirm with your accountant.']] },
  { id: 'marketing', roles: ['owner'], icon: '📣', screens: ['#/dinero', '#/publicidad'],
    es: ['Publicidad: cuánto cuesta cada cliente ganado', [
      'Dinero → "Publicidad".',
      '"+ Gasto en publicidad": anote cada mes cuánto gastó en cada canal (Google, Facebook/Instagram, página web, etc.).',
      'La app lo cruza con los prospectos, estimados y ventas de ese canal, según el "cómo nos conoció" de cada prospecto en Ventas.',
      'Mire "costo por venta" y "retorno": 3× quiere decir que cada $1 trajo $3 en ventas. Así sabe dónde poner el dinero.']],
    en: ['Marketing: cost per client won', [
      'Money → "Marketing".',
      '"+ Marketing spend": each month, record what you spent on each channel (Google, Facebook/Instagram, website, etc.).',
      'The app matches it with leads, estimates and sales from that channel, using each lead\'s "how did you hear about us" in Sales.',
      'Watch "cost per sale" and "return": 3× means each $1 brought $3 in sales. That tells you where to put the money.']] },
  { id: 'closeout', roles: ['owner', 'pm'], icon: '🏁', screens: ['#/obra'],
    es: ['Entrega de la obra firmada por el cliente', [
      'En la obra, pestaña Tareas → tarjeta "Entrega de la obra".',
      'Anote los pendientes de la última revisión (retoques, limpieza) y márquelos cuando estén hechos.',
      'Con todo hecho, "Pedir firma de entrega" manda un enlace al cliente. Él revisa la lista y firma con el dedo.',
      'Al firmar, la obra pasa a "Terminada", empieza la garantía y la app le pide la reseña al cliente.']],
    en: ['Job handover signed by the client', [
      'In the job, Tasks tab → "Job handover" card.',
      'List the items from the final walkthrough (touch-ups, cleanup) and check them off when done.',
      'When everything is done, "Request handover signature" sends the client a link. They review the list and sign with a finger.',
      'Once signed, the job becomes "Finished", the warranty starts and the app asks the client for a review.']] },
  { id: 'hourly', roles: ['owner'], icon: '⏱️', screens: ['#/horas', '#/obra', '#/equipo'],
    es: ['Trabajadores por hora y nómina', [
      'Equipo y accesos → al crear un Trabajador, elija "Por hora" y su pago por hora. Los subs con precio por trabajo van "Como sub".',
      'El trabajador marca entrada y salida en su teléfono. Si no lo hizo: Horas y nómina → "+ Anotar horas".',
      'Las horas se suman solas como gasto de mano de obra en la obra. Lo que pase de 40 h en la semana se paga a 1.5× (se puede cambiar en Nómina → Cambiar).',
      'Nómina de la semana: cuánto se le debe a cada uno. "Marcar pagado" con la forma de pago; esa semana queda cerrada.',
      'Reporte: cuánto se ha gastado por trabajador o por obra, en las fechas que elija.',
      'En cada obra, pestaña Subcontratistas → "Trabajadores por hora": horas y costo de cada persona en esa obra.']],
    en: ['Hourly workers and payroll', [
      'Team and access → when creating a Worker, choose "Hourly" and their hourly pay. Subs paid per job go "As a sub".',
      'The worker clocks in and out on their phone. If they didn\'t: Hours and payroll → "+ Log hours".',
      'Hours are added automatically as labor cost on the job. Anything over 40 h a week is paid at 1.5× (change it in Payroll → Change).',
      'Weekly payroll: what each person is owed. "Mark paid" with the payment method; that week is closed.',
      'Report: how much was spent per worker or per job, for the dates you choose.',
      'On each job, Subcontractors tab → "Hourly workers": hours and cost of each person on that job.']] },
  { id: 'texts', roles: ['owner', 'pm'], icon: '💬', screens: ['#/textos', '#/obra'],
    es: ['Mensajes de texto con subs y clientes', [
      'Menú → Textos. "+ Texto nuevo", elija a la persona y escriba. Sale del número de la empresa.',
      'Las respuestas llegan a Textos y le avisa la app. Toque la conversación para contestar.',
      'En los avisos de cambio de fecha y novedades aparece "💬 Texto desde la app".',
      'PM: solo puede textear a la gente de sus obras.',
      'Nunca ponga precios ni costos internos en un texto.',
      'Dueño: para activarlos, vea Mi cuenta → Mensajes de texto.']],
    en: ['Text messages with subs and clients', [
      'Menu → Texts. "+ New text", pick the person and write. It goes out from the company number.',
      'Replies arrive in Texts and the app notifies you. Tap the conversation to answer.',
      'Date-change and update notices show "💬 Text from the app".',
      'PM: you can only text people on your jobs.',
      'Never put prices or internal costs in a text.',
      'Owner: to turn them on, see My account → Text messages.']] },
  { id: 'backup', roles: ['owner'], icon: '💾', screens: ['#/cuenta'],
    es: ['Respaldos', [
      'La app guarda una copia cada día (las últimas 14).',
      'Mi cuenta → "Descargar respaldo": guárdelo en Google Drive o una USB cada semana.']],
    en: ['Backups', [
      'The app saves a copy every day (last 14).',
      'My account → "Download backup": save it to Google Drive or a USB every week.']] },

  // ---------- project manager ----------
  { id: 'pmday', roles: ['pm'], icon: '📝', screens: ['#/'],
    es: ['Su día como project manager', [
      'Revise Inicio → Hoy en las obras: qué sigue en cada obra y avise al siguiente sub.',
      'Registre gastos, fotos, reportes diarios y casos de sus obras.',
      'Pagos a subs, cambios de precio y gastos arriba de su límite quedan como solicitud que autoriza un dueño.',
      'Al final del día escriba su nota en Inicio (qué hizo, problemas, qué sigue). Los dueños la ven en su reporte.']],
    en: ['Your day as project manager', [
      'Check Home → Today on jobs: what\'s next on each job and notify the next sub.',
      'Record expenses, photos, daily reports and cases for your jobs.',
      'Sub payments, price changes and expenses over your limit become requests an owner approves.',
      'At the end of the day write your note on Home (what you did, problems, what\'s next). Owners see it in their report.']] },

  // ---------- ventas ----------
  { id: 'sales', roles: ['sales', 'owner', 'pm'], tool: 'ventas', icon: '💼', screens: ['#/ventas', '#/'],
    es: ['Ventas: su día, citas y estimados', [
      'Mi día: citas de hoy, a quién toca llamar (en rojo si ya se pasó) y clientes nuevos.',
      '"+ Cliente nuevo": nombre, teléfono, dirección, qué quiere y, si ya quedaron, la cita.',
      'En cada cliente: Llamé, Mensaje, Cita, "Envié estimado" (pide el monto y pone la llamada a 3 días).',
      '"Ganado" pasa el cliente a obra activa y avisa a los dueños. "Perdido" pide el motivo.',
      'La app le avisa 1 hora antes de cada cita y cada mañana con su día.']],
    en: ['Sales: your day, appointments and estimates', [
      'My day: today\'s appointments, who to call (red if overdue) and new clients.',
      '"+ New client": name, phone, address, what they want and, if set, the appointment.',
      'On each client: Called, Message, Appointment, "Sent estimate" (asks the amount and sets the call in 3 days).',
      '"Won" turns the client into an active job and notifies owners. "Lost" asks for the reason.',
      'The app reminds you 1 hour before each appointment and every morning with your day.']] },

  // ---------- subs y trabajadores ----------
  { id: 'worker', roles: ['worker'], icon: '🔨', screens: ['#/'],
    es: ['Sus obras y tareas', [
      'Su pantalla tiene botones grandes con iconos: Foto del ticket, Foto del trabajo, Hay un problema, Mis pagos, Mi semana y Mandar invoice.',
      'Mis obras ahora: solo donde está trabajando. Las que vienen y las terminadas están guardadas abajo.',
      'En la obra: Cómo llegar, los mismos botones grandes y Mis tareas con ▶ Empezar y ✓ Terminé.',
      'Foto del ticket: la app lo lee; revise el monto y la obra y toque Guardar. Lo que usted registra lo revisa la oficina.',
      'Toque "Confirmo que voy" en cada tarea nueva. Si le cambian la fecha, le llega un aviso: responda si puede.',
      'Marque las tareas como hechas y suba fotos del avance.',
      'En cada obra: 📐 Planos y scope del trabajo (qué se va a hacer). Toque Ver para abrir los planos.',
      'Cuando pasa una inspección le llega un aviso; si la siguiente tarea es suya: "Ya puede seguir".',
      'Rough-in: antes de que cierren, confirme con foto lo de su trade (contactos, luces, cables, gas). Le sale en Mis pendientes y en la obra.',
      'Si le preguntan "¿Puede empezar este trabajo el …?", ábralo en Mis pendientes: verá un calendario con sus obras activas. Toque "Sí puedo" o toque el día desde el que sí puede.',
      'Reloj: marque entrada y salida en la obra (usa el GPS solo en ese momento).']],
    en: ['Your jobs and tasks', [
      'Your screen has big buttons with icons: Ticket photo, Photo of the work, There is a problem, My payments, My week and Send invoice.',
      'My jobs now: only where you are working. Upcoming and finished jobs are tucked away below.',
      'On the job: Directions, the same big buttons, and My tasks with ▶ Start and ✓ Done.',
      'Ticket photo: the app reads it; check the amount and the job and tap Save. What you record is reviewed by the office.',
      'Tap "I confirm I\'ll be there" on each new task. If the date changes you get a notice: reply if you can.',
      'Mark tasks done and upload progress photos.',
      'On each job: 📐 Plans and scope of work (what will be done). Tap View to open the plans.',
      'When an inspection passes you get a notice; if the next task is yours: "You can go ahead".',
      'Rough-in: before they close, confirm your trade\'s items with a photo (outlets, lights, wiring, gas). It shows in your to-dos and on the job.',
      'If asked "Can you start this job on …?", open it in your to-dos: you will see a calendar with your active jobs. Tap "Yes, I can" or tap the day you can start from.',
      'Clock: clock in and out at the job (GPS is used only at that moment).']] },
  { id: 'workermoney', roles: ['worker'], icon: '💲', screens: ['#/docs', '#/mis-pagos'],
    es: ['Estimados, invoices y sus pagos', [
      'Estimados e invoices: "+ Estimado" o "+ Invoice" con renglones; puede adjuntar la foto o PDF de su documento.',
      'Un estimado aceptado se puede "Convertir en invoice" por el total o una parte.',
      'Mis pagos: lo que le han pagado (método y fecha) y lo que le deben.',
      'Compras para la obra: use "Escanear" con el código de la obra en el ticket.']],
    en: ['Estimates, invoices and your payments', [
      'Estimates and invoices: "+ Estimate" or "+ Invoice" with line items; attach a photo or PDF of your document.',
      'An accepted estimate can be "Converted to invoice" for the total or a part.',
      'My payments: what you\'ve been paid (method and date) and what you\'re owed.',
      'Purchases for the job: use "Scan" with the job code on the receipt.']] },

  // ---------- clientes ----------
  { id: 'clientportal', roles: ['client'], icon: '🏡', screens: ['#/'],
    es: ['Su proyecto', [
      'Mi proyecto: avance, próximas fechas, fotos y novedades del día.',
      'Pagos: el total, lo que ha pagado y el saldo; puede descargar su estado de cuenta.',
      'Firme el estimado o contrato desde aquí cuando se lo pidan.',
      '"Hacer una pregunta" para mandar dudas o fotos. Al terminar la obra le llega una encuesta corta (2 minutos): su opinión sincera nos ayuda a mejorar y sus comentarios los leen solo los dueños.',
      'Materiales de su proyecto: qué material y color va en cada parte, con fotos de otros trabajos.',
      'Lo que falta escoger: arriba le salen las selecciones con su fecha límite (por ejemplo, el color del stain). Toque la opción que quiere, o escriba lo que quiere y toque "Apruebo". Escoger a tiempo evita atrasos.']],
    en: ['Your project', [
      'My project: progress, upcoming dates, photos and daily updates.',
      'Payments: total, what you\'ve paid and the balance; download your statement.',
      'Sign the estimate or contract here when asked.',
      '"Ask a question" to send questions or photos. When the job is finished you get a short survey (2 minutes): your honest feedback helps us improve and your comments are read only by the owners.',
      'Your project\'s materials: which material and color goes where, with photos from other jobs.',
      'What you still need to choose: your selections show at the top with their deadline (for example, the stain color). Tap the option you want, or write what you want and tap "I approve". Choosing on time avoids delays.']] },
];

// Ayuda de quien está usando la app: por su papel y herramientas.
function helpFor(me) {
  if (!me) return [];
  const tools = me.tools || [];
  return HELP.filter(h => h.roles.includes(me.role) && (!h.tool || me.role === 'sales' || tools.includes(h.tool)));
}
const HELP_ROLE = { owner: ['Dueño', 'Owner'], pm: ['Project manager', 'Project manager'], sales: ['Vendedor', 'Salesperson'], worker: ['Sub / trabajador', 'Sub / worker'], client: ['Cliente', 'Client'] };
const hx = (es, en) => (LANG === 'en' ? en : es);

// ===== Videos de ayuda: cada persona los ve en su idioma (español o inglés) =====
const VIDEOS = [
  { id: 'instalar', min: '2 min', es: 'Cómo instalar y entrar', en: 'How to install and sign in', roles: ['owner', 'pm', 'sales', 'worker', 'client'] },
  { id: 'duenos', min: '5 min', es: 'Para dueños y administradores', en: 'For owners and admins', roles: ['owner'] },
  { id: 'pm', min: '2 min', es: 'Para project managers', en: 'For project managers', roles: ['owner', 'pm'] },
  { id: 'subs', min: '2 min', es: 'Para subs y trabajadores', en: 'For subs and workers', roles: ['owner', 'worker'] },
];
const vlang = () => (LANG === 'en' ? 'en' : 'es');
const vsrc = (id, lg, ext) => `/tutoriales/${lg}/${id}.${ext}`;
function videoDialog(v, lg = vlang()) {
  const d = document.createElement('dialog'); d.className = 'vdlg';
  const share = ME && ME.role === 'owner', other = lg === 'en' ? 'es' : 'en';
  const url = location.origin + vsrc(v.id, lg, 'mp4');
  d.innerHTML = `<div class="row between"><b>🎬 ${esc(v[lg])}</b><button class="sm link" data-x aria-label="${hx('Cerrar', 'Close')}">✕</button></div>
    <video controls autoplay playsinline preload="metadata" poster="${vsrc(v.id, lg, 'jpg')}" src="${vsrc(v.id, lg, 'mp4')}"></video>
    <p class="small muted">${hx('Sin sonido: lea los pasos en pantalla. Puede pausar y regresar. En el teléfono, voltéelo o toque pantalla completa para leer mejor.', 'No sound: read the steps on screen. You can pause and go back. On a phone, turn it sideways or tap full screen to read better.')}</p>
    <p class="row wrap"><button class="btn sm" data-other>${other === 'en' ? hx('Ver en inglés', 'Watch in English') : hx('Ver en español', 'Watch in Spanish')}</button>
    ${share ? `<a class="btn sm" href="https://wa.me/?text=${encodeURIComponent((lg === 'en' ? 'How to use the app: ' : 'Video de cómo usar la app: ') + url)}" target="_blank" rel="noopener">${hx('Mandar por WhatsApp', 'Send by WhatsApp')}</a>
      <button class="btn sm" data-copy>${hx('Copiar enlace del video', 'Copy video link')}</button>` : ''}</p>`;
  document.body.appendChild(d); d.showModal();
  const close = () => { const vid = $('video', d); if (vid) vid.pause(); d.close(); d.remove(); };
  $('[data-x]', d).onclick = close; d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  $('[data-other]', d).onclick = () => { close(); videoDialog(v, other); };
  const c = $('[data-copy]', d); if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(url); toast(hx('Enlace copiado', 'Link copied')); } catch { /* */ } };
}
function videosCard(role) {
  const list = VIDEOS.filter(v => v.roles.includes(role)), lg = vlang();
  return `<div class="card"><h2 style="margin-top:0">🎬 ${hx('Videos', 'Videos')}</h2><p class="small muted">${hx('Tutoriales paso a paso con la app de verdad.', 'Step-by-step tutorials with the real app.')}</p>
    <div class="vgrid">${list.map(v => `<button type="button" class="vtile" data-video="${v.id}"><img src="${vsrc(v.id, lg, 'jpg')}" alt="" loading="lazy"><span class="vplay">▶</span>
      <b>${esc(v[lg])}</b><span class="small muted">${v.min}</span></button>`).join('')}</div></div>`;
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-video]'); if (!b) return; e.preventDefault(); const v = VIDEOS.find(x => x.id === b.dataset.video); if (v) videoDialog(v); });

async function viewHelp(app, from) {
  // Primero lo que es solo para su papel; los pasos que son para otro papel no se muestran.
  const all = helpFor(ME).map((h, i) => ({ h, i })).sort((a, b) => (ME.role !== 'owner' ? a.h.roles.length - b.h.roles.length : 0) || a.i - b.i).map(x => x.h);
  const PFX = [[/^(Sub|Sub \/ trabajador):/i, ['worker']], [/^(Cliente|Client):/i, ['client']], [/^(Dueño o PM|Owner or PM):/i, ['owner', 'pm']], [/^PM:/, ['pm']]];
  const mine = s => { const p = PFX.find(([re]) => re.test(s)); return !p || p[1].includes(ME.role); };
  const L2 = h => { const [title, steps] = h[LANG === 'en' ? 'en' : 'es']; return [title, steps.filter(mine)]; };
  const base = !from ? '' : from === 'inicio' ? '#/' : '#/' + String(from).split('/')[0];
  const here = base ? all.filter(h => h.screens.some(s => s === base || (s !== '#/' && base.startsWith(s)))) : [];
  const card = (h, open) => `<details class="card help" ${open ? 'open' : ''} data-s="${esc((L2(h)[0] + ' ' + L2(h)[1].join(' ')).toLowerCase())}">
    <summary><span class="hic">${h.icon}</span><b>${esc(L2(h)[0])}</b></summary><ol>${L2(h)[1].map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>`;
  const role = HELP_ROLE[ME.role] || ['', ''];
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">❓ ${hx('Ayuda', 'Help')}</h1><span class="badge b-en_progreso">${esc(hx(role[0], role[1]))}</span></div>
    <p class="muted small">${hx('Cómo se usa la app para su papel. Toque un tema para ver los pasos.', 'How to use the app for your role. Tap a topic to see the steps.')}</p>
    ${videosCard(ME.role)}
    <h2 class="help-h">💬 ${hx('Preguntas', 'Questions')}</h2>
    <div class="field"><input id="hq" type="search" placeholder="${hx('Buscar: tickets, pagos, contraseña, fotos…', 'Search: receipts, payments, password, photos…')}" aria-label="${hx('Buscar', 'Search')}"></div>
    ${here.length ? `<h2 class="help-h">📍 ${hx('Sobre la pantalla donde estaba', 'About the screen you were on')}</h2>${here.map((h, i) => card(h, i < 2)).join('')}<h2 class="help-h">${hx('Todos los temas', 'All topics')}</h2>` : ''}
    <div id="hl">${all.filter(h => !here.includes(h)).map(h => card(h, false)).join('')}</div>
    <p id="hnone" class="empty" hidden>${hx('No encontramos ese tema. Pregúntele a los dueños de la empresa.', 'No topic found. Ask the company owners.')}</p>
    <div class="card" id="whatsnew"><h2 style="margin-top:0">✨ ${hx('Novedades', 'What\'s new')}</h2><div class="small muted">${hx('Cargando…', 'Loading…')}</div></div>
    <p class="small muted" style="text-align:center">${hx('Versión de la app', 'App version')}: <b>${esc(window.APP_VERSION || '—')}</b> · <a href="#" id="chkupd">${hx('Buscar actualización', 'Check for update')}</a></p>
    <div class="card small muted">${ME.role === 'owner' ? hx('La guía completa con todos los detalles está en el archivo LEEME.md que viene con la app.', 'The full guide with all details is in the LEEME.md file that comes with the app.')
      : hx('¿Sigue con dudas? Escríbale a su contacto en la empresa.', 'Still have questions? Message your contact at the company.')}</div>`;
  $('#hq', app).oninput = e => {
    const q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let n = 0;
    $$('details.help', app).forEach(d => { const ok = !q || d.dataset.s.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); d.hidden = !ok; if (ok) n++; if (q && ok) d.open = true; });
    $('#hnone', app).hidden = n > 0;
  };
  // Novedades de las últimas versiones, y buscar actualización a mano.
  api('GET', '/api/release-notes').then(list => { const box = $('#whatsnew', app); if (!box) return;
    box.innerHTML = `<h2 style="margin-top:0">✨ ${hx('Novedades', 'What\'s new')}</h2>${list.slice(0, 4).map(r => `<details ${r.version === window.APP_VERSION ? 'open' : ''}><summary><b>${esc(r.version)}</b> <span class="small muted">${esc(r.date || '')}</span></summary><ul class="small">${(LANG === 'en' ? r.en : r.es).map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`).join('')}`; }).catch(() => {});
  $('#chkupd', app).onclick = async e => { e.preventDefault(); await checkVersion(); if (!$('#updbar')) toast(hx('Ya tiene la versión más nueva.', 'You already have the latest version.')); };
}
