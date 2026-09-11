# Base de Datos Flotilla V2.0

## Arquitectura
- Frontend: `index.html` en GitHub/Netlify.
- Backend: Apps Script Web App (`Code.gs`).
- Datos: Google Sheet `Base de datos flotilla`.
- Secretos: únicamente Script Properties de Apps Script.

## Seguridad
- Login por PIN.
- Después de 2 PIN incorrectos se exige PIN + token temporal.
- Token de 6 dígitos, un solo uso, 10 minutos.
- Enter en PIN o token ejecuta Ingresar.
- La sesión del frontend usa `sessionStorage`; al cerrar el navegador se pierde.
- El backend valida todas las acciones protegidas.

## Script Properties requeridas
En Apps Script > Project Settings > Script properties:
- `PIN_SALT`: texto aleatorio largo.
- `PIN_HASH`: SHA-256 hexadecimal de `PIN_SALT:PIN`.
- `AUTH_EMAIL`: correo autorizado para recibir tokens.

Para generar `PIN_HASH` sin guardar el PIN en el repositorio, ejecutar temporalmente en Apps Script:
`Logger.log(makePinHash_('TU_SALT_LARGO','TU_PIN'));`
Copiar el resultado a `PIN_HASH` y no dejar el PIN escrito en el código.

## Despliegue de Apps Script
1. Crear proyecto de Apps Script.
2. Pegar `Code.gs`.
3. Configurar las Script Properties.
4. Deploy > New deployment > Web app.
5. Execute as: Me.
6. Copiar la URL `/exec`.
7. Reemplazar en el frontend `REPLACE_WITH_APPS_SCRIPT_WEB_APP_URL` por esa URL.

## Publicación
Publicar el frontend en Netlify y conectar `personal.nexusadmincr.com`.

## Importante
Nunca subir PIN, token, PIN_HASH, PIN_SALT ni credenciales al repositorio.
