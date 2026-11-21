'use strict';
// Crea una cuenta de dueño desde la línea de comandos (útil en el servidor en internet).
// Uso: node crear-dueno.js <usuario> "<Nombre>"     (le pedirá la contraseña)
const path = require('node:path');
const readline = require('node:readline');
const { open } = require('./lib/db');
const A = require('./lib/auth');
const [username, name] = process.argv.slice(2);
if (!username || !name) { console.log('Uso: node crear-dueno.js <usuario> "<Nombre>"'); process.exit(1); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Contraseña (mínimo 10 caracteres): ', pw => {
  rl.close();
  if (!A.validPassword(pw)) { console.log('Contraseña muy corta.'); process.exit(1); }
  const db = open(path.resolve(process.env.DATA_DIR || path.join(__dirname, 'datos')));
  db.prepare("INSERT INTO users(name,username,pass_hash,role) VALUES(?,?,?,'owner')").run(name, username.toLowerCase(), A.hashPassword(pw));
  console.log('Dueño creado:', username);
});
