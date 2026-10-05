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
- Regla de distribución de ingresos: un pago adelantado se asigna a la semana programada de la cuota; un atraso de hasta un mes calendario también actualiza su propia semana; si la cuota tiene **más de un mes calendario** de antigüedad respecto a la fecha real del ingreso, el monto se deriva directamente a `Pago de deudas` en la semana operativa en que se recibió, sin pasar por las demás prioridades. El corte es estricto: exactamente un mes no se considera cartera vieja.
- Uber: calendario vigente, fecha y número, estados PAGADA/CERRADA_PENDIENTE, FIFO antiguo primero y recálculo de semanas posteriores al corregir una previa; restauración de datos si falla la corrección. B1 y la fórmula B6 se preservan.
- OCR: separación de miles/decimales, negativos, etiquetas de efectivo y campos no detectados. Si una captura se lee mal, revisar e ingresar los importes manualmente antes de guardar.
- La antigua llamada HTTP a Central permanece bloqueada. Los aportes autorizados ahora se escriben directamente en el archivo global de Drive cuando `FLOTILLA_GLOBAL_SYNC_ENABLED=TRUE`. Netlify tiene un build que aborta; no se cambió la configuración remota.
- El Apps Script de pruebas está actualizado. El Apps Script de producción sigue siendo el anterior. El proxy bloquea guardados Uber y reversas si el backend no confirma las nuevas capacidades.

## Verificación
Ejecutar npm test o node tests/regression.cjs. Son pruebas aisladas con hojas simuladas; no llaman servicios externos. Cubren calendario, históricos, OCR, historial, FIFO, corrección de semanas previas, reversa específica, B1/B6 y restauración ante fallo.

## Uso local y backend
1. Ejecutar npm test y reiniciar npm start después de actualizar el código local.
2. Actualizar manualmente Code.gs y CentralSync.gs en el proyecto Apps Script y su versión publicada para habilitar los cambios del backend. No publicar ni reactivar Netlify.
3. Prueba visual breve: Semana actual; historial y cargar más; histórico con un solo vehículo pendiente; captura OCR. No guardar pagos de prueba en datos reales.

## Aportes al archivo global de Drive: pruebas del 04/10/2026
- El Apps Script de Flotilla de pruebas (`1XZP-JGri9sQRrksK_YAKi-ocXL0khtpEMVodN9vypgQuXncoCFCgMuQo`) está implementado y usa copias de las tres hojas: Flotilla, plan externo y archivo global (`1K76VFlGivXSUYhfMKBjOzbZeYnMDSm1E`). El archivo global y los scripts de producción no se modificaron.
- Las propiedades de la copia son `FLOTILLA_TEST_MODE=TRUE`, los tres IDs de las copias y `FLOTILLA_GLOBAL_SYNC_ENABLED=TRUE`. En producción, el aporte directo continúa desactivado por defecto. El servidor local en modo prueba usa `FLOTILLA_TEST_APPS_SCRIPT_URL`; no se publicó Netlify.
- La interfaz ofrece una confirmación al cubrir completamente Cuentas casa, Omoda, Coopealianza, U o Seguros. Después del sí, Flotilla suma el aporte en `Cuentas mensuales` del archivo global y registra una operación única en `Historial`. Para U usa `semana_1` a `semana_5` según el martes; Seguros se distribuye por vehículo. Golpes préstamos queda excluido por decisión del dueño. Todo aporte se redondea hacia arriba al siguiente múltiplo de ₡500.
- Si una cuenta quedó completamente cubierta pero el aporte todavía no existe realmente en el `Historial` global (por cancelar/cerrar el diálogo, navegar, recargar o una operación incompleta), la tabla de distribución muestra temporalmente `Pendiente de aplicar en file global`. El botón vuelve a pedir autorización y desaparece solo cuando el movimiento ya está aplicado. Este estado se reconstruye desde el archivo global, así que sobrevive navegación y recarga.
- Una prueba real en la **copia** sumó ₡500 a Cuentas casa, reconoció el ID duplicado sin repetir el abono y luego registró una reversión de prueba. La hoja abierta confirmó saldo inicial y final de ₡25 000 y ambos asientos. La lectura del conector de Drive tardó en reflejar la reversión; para verificar saldos inmediatos se consultó la hoja abierta.
- `npm test` pasó 108 comprobaciones aisladas. Queda pendiente probar el flujo visual completo con un pago de prueba que cubra una cuenta y confirmar que el diálogo y la actualización aparezcan juntos. La semana del 06/10/2026 comienza operativamente el lunes 05/10/2026; un ingreso fechado el domingo 04/10 se asigna a la semana del 29/09/2026.
- Para continuar localmente: verificar que Netlify tenga **Stopped builds**; iniciar el servidor con `FLOTILLA_TEST_MODE=1` y la URL `/exec` de la copia; entrar con el PIN de pruebas; aplicar un pago de prueba y verificar la hoja global copiada. La rama `dev-local` ya incluye reconciliación automática al reversar un pago manual: recalcula únicamente las cuentas que ya tenían aportes autorizados en la semana real del ingreso y, si corresponde, registra un movimiento negativo idempotente en el archivo global. **Esta ruta todavía debe probarse desde la interfaz contra las copias antes de considerarla lista para producción.**
