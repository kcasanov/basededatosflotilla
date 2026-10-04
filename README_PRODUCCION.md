# Flotilla · revisión local del 3 de octubre de 2026

## Fuente y estado
El repositorio local en C:\Users\kenda\Documents\basededatosflotilla contiene la aplicación consolidada. Se preservaron el editor de gastos y la carga diferida del resumen externo. Los cambios en GitHub no despliegan el Apps Script ni reactivan Netlify.

## Inventario original verificado
- index.html: carga app.js y app-v3.js.
- server.js: Express 5.2.1; proxy /api a Apps Script; antes inyectaba seis scripts.
- session-stability.js y performance-v34.js: sesiones, caché y cargas superpuestas.
- central-sync-ui.js: intentaba sincronizar Central después de pagos.
- lazy-plan-local.js: bloqueaba la lectura del resumen externo al arrancar.
- expenses-local-v35.js: editor de gastos con lápiz, arrastre y guardado conjunto.
- uber-local-v37.js: existía localmente, pero llamaba carryFromPreviousWeekLocal y summaryWeek sin definirlos.
- netlify.toml: antes añadía scripts durante el build.
- netlify/functions/api.mjs: proxy /api de Netlify, sin cambios de despliegue.
- Code.gs y CentralSync.gs: fuentes del backend; modificar estos archivos no actualiza el Apps Script desplegado.
- package.json y package-lock.json: Express para el servidor local.
- core-safety-local-v38.js y uber-local-v36.js: no existen en la carpeta local inventariada.

## Consolidación preparada
index.html carga explícitamente app.js, app-v3.js y expenses.js. El servidor ya no inyecta scripts. La sesión y carga progresiva se integraron en app-v3.js; expenses.js conserva el editor local de gastos. Los seis scripts locales antiguos fueron retirados.

## Cambios y límites
- Semana operativa lunes-domingo, identificada por su martes; 03/10/2026 y 04/10/2026 corresponden al 29/09/2026, y 05/10/2026 al 06/10/2026.
- Historial: últimos 10 movimientos, cargar 10 más, reversa por ID de abono manual. Las reversas nuevas conservan auditoría. Los movimientos borrados antes de esta actualización no se pueden recuperar si el historial antiguo no guardó sus datos.
- Históricos: estados explícitos del plan y listado externo de pendientes; Aplicado no fabrica dinero recibido.
- Uber: calendario vigente, fecha y número, estados PAGADA/CERRADA_PENDIENTE, FIFO antiguo primero y recálculo de semanas posteriores al corregir una previa; restauración de datos si falla la corrección. B1 y la fórmula B6 se preservan.
- OCR: separación de miles/decimales, negativos, etiquetas de efectivo y campos no detectados. Si una captura se lee mal, revisar e ingresar los importes manualmente antes de guardar.
- Central queda bloqueado en cliente, proxy local y servidor. Netlify tiene un build que aborta; no se cambió la configuración remota.
- El Apps Script publicado sigue siendo el anterior hasta que se actualice manualmente. El proxy bloquea guardados Uber y reversas si el backend no confirma las nuevas capacidades.

## Verificación
Ejecutar npm test o node tests/regression.cjs. Son pruebas aisladas con hojas simuladas; no llaman servicios externos. Cubren calendario, históricos, OCR, historial, FIFO, corrección de semanas previas, reversa específica, B1/B6 y restauración ante fallo.

## Uso local y backend
1. Ejecutar npm test y reiniciar npm start después de actualizar el código local.
2. Actualizar manualmente Code.gs y CentralSync.gs en el proyecto Apps Script y su versión publicada para habilitar los cambios del backend. No publicar ni reactivar Netlify.
3. Prueba visual breve: Semana actual; historial y cargar más; histórico con un solo vehículo pendiente; captura OCR. No guardar pagos de prueba en datos reales.
