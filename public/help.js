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
      'Si la olvida: en la pantalla de entrada toque "¿Olvidó su usuario o contraseña?". Le llega por WhatsApp una contraseña temporal de 24 horas y al entrar pone una nueva.',
      'Recomendado para dueños y PMs: "Entrada en 2 pasos" en Mi cuenta, con Google Authenticator.',
      'Nunca comparta su contraseña: cada persona tiene la suya y todo queda registrado con su nombre.']],
    en: ['Password and security', [
      'Change your password in My account (at least 10 characters).',
      'If you forget it: on the sign-in screen tap "Forgot your username or password?". You get a 24-hour temporary password by WhatsApp and set a new one when you sign in.',
      'Recommended for owners and PMs: "2-step sign-in" in My account, with Google Authenticator.',
      'Never share your password: each person has their own and everything is logged with their name.']] },

  // ---------- dueños ----------
  { id: 'start', roles: ['owner'], icon: '🚀', screens: ['#/', '#/equipo'],
    es: ['Primeros pasos', [
      'Equipo y accesos → "+ Usuario": cree a su socio (Dueño), PMs, vendedores, subs y clientes. Ponga teléfono, oficio e idioma.',
      'Para mandarle su acceso a alguien: ✎ → "🔑 Contraseña temporal" → WhatsApp (lleva el enlace, el usuario y la contraseña).',
      'Inicio le muestra lo pendiente: autorizaciones, margen bajo, prospectos, tickets por asignar, presupuestos al límite.',
      'Hoy le muestra cada obra: qué paso va ahora, cuál sigue y qué sub sigue.']],
    en: ['Getting started', [
      'Team and access → "+ User": create your partner (Owner), PMs, salespeople, subs and clients. Add phone, trade and language.',
      'To send someone their access: ✎ → "🔑 Temporary password" → WhatsApp (includes link, username and password).',
      'Home shows what is pending: approvals, low margin, leads, receipts to assign, budgets at the limit.',
      'Today shows each job: current step, next step and which sub is next.']] },
  { id: 'job', roles: ['owner', 'pm'], icon: '🏗️', screens: ['#/obras', '#/obra'],
    es: ['Crear una obra y su plan de trabajo', [
      'Obras → "+ Nueva obra": cliente, dirección, tipo, contrato y fechas.',
      'Pestaña Tareas → "🤖 Plan de trabajo con AI": suba el estimado o invoice (PDF o foto) y la app propone tareas, días y qué sub hace cada una.',
      'Ajuste nombres, días, orden y quién lo hace; las fechas se recalculan solas. Toque "Guardar en el calendario".',
      'Guarde el plan como plantilla para que la próxima obra parecida salga más rápido.',
      'Cada obra tiene un código (EE-0001): dígalo como "Job name" al pagar en Home Depot o Lowe\'s para que el ticket se archive solo.']],
    en: ['Create a job and its work plan', [
      'Jobs → "+ New job": client, address, type, contract and dates.',
      'Tasks tab → "🤖 AI work plan": upload the estimate or invoice (PDF or photo) and the app proposes tasks, days and which sub does each.',
      'Adjust names, days, order and who does it; dates recalculate automatically. Tap "Save to calendar".',
      'Save the plan as a template so the next similar job is faster.',
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
      'Para cambiar el reparto normal o la alerta de margen: Reportes → "Reparto normal y alerta de margen". Al otro dueño le llega un aviso.',
      'Reportes → Reparto de ganancias: total del año por persona, real (obras terminadas) y proyectado (activas).']],
    en: ['Profit split and margin alert', [
      'Each job shows each person\'s share (standard: Jack 35%, Glaiber 35%, company 30%).',
      'For a special job: "Change for this job".',
      'To change the standard split or margin alert: Reports → "Standard split and margin alert". The other owner gets a notice.',
      'Reports → Profit split: year total per person, actual (completed jobs) and projected (active).']] },
  { id: 'expenses', roles: ['owner', 'pm', 'worker'], icon: '🧾', screens: ['#/gastos', '#/obra'],
    es: ['Gastos y escanear tickets', [
      'Botón verde "Escanear": tome foto del ticket (o varios) o suba un PDF.',
      'La app lee tienda, fecha, total e impuesto y lo pone en la obra correcta (por el código de obra, la dirección o el cliente).',
      'Si no está segura, queda "Por asignar" en Inicio: elija la obra con un toque.',
      'También puede escribir el gasto a mano en la pestaña Gastos de la obra.',
      'PM: los gastos arriba de su límite quedan esperando la autorización de un dueño.']],
    en: ['Expenses and scanning receipts', [
      'Green "Scan" button: take a photo of the receipt (or several) or upload a PDF.',
      'The app reads store, date, total and tax and files it to the right job (by job code, address or client).',
      'If unsure, it stays "To assign" on Home: pick the job with one tap.',
      'You can also type the expense in the job\'s Expenses tab.',
      'PM: expenses above your limit wait for an owner\'s approval.']] },
  { id: 'subs', roles: ['owner', 'pm'], icon: '👷', screens: ['#/obra', '#/cuentas'],
    es: ['Subs: estimados, invoices y pagos', [
      'Pestaña Subcontratistas de la obra: agregue al sub con lo acordado.',
      'El sub manda su estimado o invoice desde su app. Usted lo revisa en Inicio: aceptar el estimado lo suma a lo acordado; aprobar el invoice lo vuelve gasto.',
      '"Registrar pago": parcial o completo, con método (Zelle, cheque, depósito), fecha y número de confirmación.',
      'Cuentas → estado de cuenta de cada sub: lo pagado y lo que se le debe (PDF para mandarle).']],
    en: ['Subs: estimates, invoices and payments', [
      'Job Subcontractors tab: add the sub with the agreed amount.',
      'The sub sends their estimate or invoice from their app. Review it on Home: accepting the estimate adds to the agreed amount; approving the invoice makes it an expense.',
      '"Record payment": partial or full, with method (Zelle, check, deposit), date and confirmation number.',
      'Accounts → each sub\'s statement: paid and owed (PDF to send them).']] },
  { id: 'client', roles: ['owner', 'pm'], icon: '💵', screens: ['#/obra', '#/cuentas'],
    es: ['Cobrar al cliente', [
      'Botón "PDF para el cliente": estimado o contrato con change orders y pagos.',
      'El cliente firma desde su portal; queda la firma en el PDF.',
      'Change orders: se suman al contrato cuando se aprueban.',
      'Pestaña Pagos del cliente: registre cada pago. Cuentas → estado de cuenta: pagado y lo que debe.']],
    en: ['Billing the client', [
      '"Client PDF" button: estimate or contract with change orders and payments.',
      'The client signs from their portal; the signature appears on the PDF.',
      'Change orders: added to the contract when approved.',
      'Client payments tab: record each payment. Accounts → statement: paid and balance.']] },
  { id: 'calendar', roles: ['owner', 'pm'], icon: '📅', screens: ['#/calendario'],
    es: ['Calendario y cambios de fecha', [
      'Toque una tarea → "Reprogramar" y ponga la nueva fecha (o déjela vacía para que el sub proponga cuándo puede).',
      'Escriba el motivo: al sub le llega el aviso y responde si puede; al cliente se le avisa sin el motivo interno.',
      'Marque "Mover también las tareas siguientes" para recorrer todo el plan los mismos días.']],
    en: ['Calendar and date changes', [
      'Drag a task to another day or use "Change date".',
      'Write the reason: the sub gets a notice and replies if they can; the client is notified without the internal reason.',
      'Tasks that depend on another one move with it.']] },
  { id: 'cases', roles: ['owner', 'pm', 'worker', 'client'], icon: '⚠️', screens: ['#/casos', '#/obra', '#/'],
    es: ['Casos: problemas y preguntas con fotos', [
      'Sub: en su obra toque "⚠️ Reportar problema", explique y mande fotos. Solo lo ve la empresa.',
      'Cliente: en su portal toque "Hacer una pregunta".',
      'Dueño o PM: responda dentro del caso. Cada mensaje es 🔒 Interno o 👁 Para el cliente.',
      'Al cerrar, escriba la decisión. Las fotos de un caso no se borran: son el historial.']],
    en: ['Cases: problems and questions with photos', [
      'Sub: in your job tap "⚠️ Report a problem", explain and send photos. Only the company sees it.',
      'Client: in your portal tap "Ask a question".',
      'Owner or PM: reply inside the case. Each message is 🔒 Internal or 👁 For the client.',
      'When closing, write the decision. Case photos are never deleted: they are the record.']] },
  { id: 'daily', roles: ['owner', 'pm', 'worker'], icon: '📸', screens: ['#/obra'],
    es: ['Fotos, reporte diario y permisos', [
      'Suba fotos en la obra (o en cada tarea). Las fotos finales entran solas a la galería al terminar la obra.',
      'Pestaña Reporte diario: qué se hizo hoy, con fotos; al cliente le llega la novedad.',
      'Pestaña Permisos: número de permiso e inspecciones con fecha; la app avisa las que vienen.']],
    en: ['Photos, daily report and permits', [
      'Upload photos on the job (or on each task). Final photos go to the gallery automatically when the job is completed.',
      'Daily report tab: what was done today, with photos; the client gets the update.',
      'Permits tab: permit number and dated inspections; the app reminds you of upcoming ones.']] },
  { id: 'materials', roles: ['owner', 'pm', 'sales', 'client'], icon: '🎨', screens: ['#/materiales', '#/obra'],
    es: ['Materiales, colores y galería', [
      'Materiales: busque por nombre, color o marca; cada material tiene foto de cerca y fotos de trabajos terminados.',
      'En cada obra, pestaña Materiales: qué material y color va en cada parte (ceiling, fascia, stain, cubierta…). El cliente la ve en su portal.',
      'Toque ★ en una foto para ponerla o quitarla de la galería. La galería nunca muestra nombre ni dirección de clientes.']],
    en: ['Materials, colors and gallery', [
      'Materials: search by name, color or brand; each material has a close-up and photos of finished jobs.',
      'On each job, Materials tab: which material and color goes where (ceiling, fascia, stain, countertop…). The client sees it in their portal.',
      'Tap ★ on a photo to add or remove it from the gallery. The gallery never shows client names or addresses.']] },
  { id: 'approvals', roles: ['owner'], icon: '🛡️', screens: ['#/historial', '#/'],
    es: ['Autorizaciones, historial y seguridad', [
      'Cambios de $1,000 o más necesitan a los dos dueños; un "no" lo detiene. Si solo hay un dueño activo, basta uno.',
      'Lo que pide un PM o un agente 🤖 con dinero queda en Inicio para que lo autorice un dueño.',
      'Lo aceptado (estimados, contratos) no se cambia sin autorización y siempre con motivo.',
      'Historial: quién cambió qué, cuándo y por qué. Puede cerrar un periodo para que ya no se modifique.']],
    en: ['Approvals, history and security', [
      'Changes of $1,000 or more need both owners; one "no" stops it. If only one owner is active, one is enough.',
      'Money requests from a PM or an agent 🤖 wait on Home for an owner to approve.',
      'Accepted items (estimates, contracts) can\'t change without approval and always with a reason.',
      'History: who changed what, when and why. You can lock a period so it can no longer be edited.']] },
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
      'Cuentas: lo que les deben los clientes y lo que deben a subs.']],
    en: ['Reports, forecasts and accounts', [
      'Reports: profit by project type, where clients come from, margin by trade and profit split.',
      'Export CSV for the accountant or QuickBooks.',
      'Forecasts: next months\' sales and profit using statistics. Import your history to make it reliable.',
      'Accounts: what clients owe you and what you owe subs.']] },
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
      'En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx).',
      'Obras → "📥 Importar de Excel" y elija uno o varios archivos.',
      'Revise el resumen y los avisos. Marque los subs que ya están pagados completos.',
      'Toque "Importar esta obra". La misma obra no se importa dos veces.']],
    en: ['Import your Excel books', [
      'In Google Sheets: File → Download → Microsoft Excel (.xlsx).',
      'Jobs → "📥 Import from Excel" and pick one or several files.',
      'Review the summary and warnings. Check the subs already paid in full.',
      'Tap "Import this job". The same job is never imported twice.']] },
  { id: 'agents', roles: ['owner'], icon: '🤖', screens: ['#/equipo', '#/agentes'],
    es: ['Agentes de AI (Grok y otros)', [
      'Equipo y accesos → 🤖 Agentes → "+ Agente": Operador de obras o Vendedor.',
      'Cree una llave (empiece con solo lectura) y cópiela: se muestra una sola vez.',
      '"Instrucciones para el bot": copie el texto en Grok y ponga la llave como encabezado Authorization: Bearer.',
      'Lo que mueve dinero queda esperando a un dueño. Quite la llave o apague al agente cuando quiera.']],
    en: ['AI agents (Grok and others)', [
      'Team and access → 🤖 Agents → "+ Agent": Job operator or Salesperson.',
      'Create a key (start read-only) and copy it: it is shown only once.',
      '"Instructions for the bot": paste the text into Grok and set the key as the Authorization: Bearer header.',
      'Anything that moves money waits for an owner. Revoke the key or turn the agent off anytime.']] },
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
      'Revise Hoy: qué sigue en cada obra y avise al siguiente sub.',
      'Registre gastos, fotos, reportes diarios y casos de sus obras.',
      'Pagos a subs, cambios de precio y gastos arriba de su límite quedan como solicitud que autoriza un dueño.',
      'Al final del día escriba su nota en Inicio (qué hizo, problemas, qué sigue). Los dueños la ven en su reporte.']],
    en: ['Your day as project manager', [
      'Check Today: what\'s next on each job and notify the next sub.',
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
      'Mis obras: las obras donde tiene trabajo y sus próximas tareas.',
      'Toque "Confirmo que voy" en cada tarea nueva. Si le cambian la fecha, le llega un aviso: responda si puede.',
      'Marque las tareas como hechas y suba fotos del avance.',
      'Reloj: marque entrada y salida en la obra (usa el GPS solo en ese momento).']],
    en: ['Your jobs and tasks', [
      'My jobs: jobs where you have work and your next tasks.',
      'Tap "I confirm I\'ll be there" on each new task. If the date changes you get a notice: reply if you can.',
      'Mark tasks done and upload progress photos.',
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
      '"Hacer una pregunta" para mandar dudas o fotos. Al terminar, califique su proyecto con estrellas.',
      'Materiales de su proyecto: qué material y color va en cada parte, con fotos de otros trabajos.']],
    en: ['Your project', [
      'My project: progress, upcoming dates, photos and daily updates.',
      'Payments: total, what you\'ve paid and the balance; download your statement.',
      'Sign the estimate or contract here when asked.',
      '"Ask a question" to send questions or photos. At the end, rate your project with stars.',
      'Your project\'s materials: which material and color goes where, with photos from other jobs.']] },
];

// Ayuda de quien está usando la app: por su papel y herramientas.
function helpFor(me) {
  if (!me) return [];
  const tools = me.tools || [];
  return HELP.filter(h => h.roles.includes(me.role) && (!h.tool || me.role === 'sales' || tools.includes(h.tool)));
}
const HELP_ROLE = { owner: ['Dueño', 'Owner'], pm: ['Project manager', 'Project manager'], sales: ['Vendedor', 'Salesperson'], worker: ['Sub / trabajador', 'Sub / worker'], client: ['Cliente', 'Client'] };
const hx = (es, en) => (LANG === 'en' ? en : es);

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
    <div class="field"><input id="hq" type="search" placeholder="${hx('Buscar: tickets, pagos, contraseña, fotos…', 'Search: receipts, payments, password, photos…')}" aria-label="${hx('Buscar', 'Search')}"></div>
    ${here.length ? `<h2 class="help-h">📍 ${hx('Sobre la pantalla donde estaba', 'About the screen you were on')}</h2>${here.map((h, i) => card(h, i < 2)).join('')}<h2 class="help-h">${hx('Todos los temas', 'All topics')}</h2>` : ''}
    <div id="hl">${all.filter(h => !here.includes(h)).map(h => card(h, false)).join('')}</div>
    <p id="hnone" class="empty" hidden>${hx('No encontramos ese tema. Pregúntele a los dueños de la empresa.', 'No topic found. Ask the company owners.')}</p>
    <div class="card small muted">${ME.role === 'owner' ? hx('La guía completa con todos los detalles está en el archivo LEEME.md que viene con la app.', 'The full guide with all details is in the LEEME.md file that comes with the app.')
      : hx('¿Sigue con dudas? Escríbale a su contacto en la empresa.', 'Still have questions? Message your contact at the company.')}</div>`;
  $('#hq', app).oninput = e => {
    const q = e.target.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let n = 0;
    $$('details.help', app).forEach(d => { const ok = !q || d.dataset.s.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q); d.hidden = !ok; if (ok) n++; if (q && ok) d.open = true; });
    $('#hnone', app).hidden = n > 0;
  };
}
