#!/bin/sh
# Arranca como root solo para dar permisos a la carpeta de datos (disco de la nube),
# y después corre la app como el usuario "node", sin permisos de administrador.
mkdir -p "$DATA_DIR" && chown -R node:node "$DATA_DIR" 2>/dev/null
exec su node -s /bin/sh -c 'exec node --no-warnings server.js'
