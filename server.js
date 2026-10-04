const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

app.use(express.text({ type: '*/*', limit: '2mb' }));

const PRODUCTION_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycby5hk0KM34Ts8VNhX9uF5cAbNhzL6ygQLIUJBcM3aPXuQSnXWuNWH1mIA3L5QnW5tea/exec';
const TEST_MODE = process.env.FLOTILLA_TEST_MODE === '1';
const TEST_URL = String(process.env.FLOTILLA_TEST_APPS_SCRIPT_URL || '').trim();
if (TEST_MODE && (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(TEST_URL) || TEST_URL === PRODUCTION_APPS_SCRIPT_URL)) {
  throw new Error('Pruebas: configurá FLOTILLA_TEST_APPS_SCRIPT_URL con el /exec de un Apps Script de prueba distinto del de producción.');
}
const APPS_SCRIPT_URL = TEST_MODE ? TEST_URL : PRODUCTION_APPS_SCRIPT_URL;

app.post('/api', async (req, res) => {
  const started = Date.now();

  let action = 'desconocida';

  try {
    try {
      action = JSON.parse(req.body || '{}').action || 'desconocida';
    } catch (_) {}

    if(action==='syncCentral')return res.json({ok:true,disabled:true,message:'Sincronización pausada.'});
    if(['saveUberWeek','unmarkPayment'].includes(action)){
      const payload=JSON.parse(req.body);
      const check=await fetch(APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action:'bootstrap'}),redirect:'follow',signal:AbortSignal.timeout(45000)});
      const state=await check.json();
      if(!check.ok||!state.ok||!state.capabilities?.safeUber||!state.capabilities?.specificManualReversal)return res.status(409).json({ok:false,message:'El Apps Script activo debe actualizarse con Code.gs antes de guardar Uber o reversar pagos.'});
    }
    console.log(`[API →] ${action}`);

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(45000),
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: req.body,
      redirect: 'follow'
    });

    const text = await response.text();
    const elapsed = Date.now() - started;

    console.log(
      `[API ←] ${action} · ${elapsed} ms · HTTP ${response.status}`
    );

    res
      .status(response.ok ? 200 : 502)
      .type('application/json')
      .send(text);

  } catch (err) {
    console.error(
      `[API ERROR] ${action} · ${Date.now() - started} ms · ${err.message}`
    );

    res.status(502).json({
      ok: false,
      message: 'No se pudo contactar Apps Script',
      detail: err.message
    });
  }
});

// Serve the same explicit script list locally and in the repository.
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

// Archivos JS/CSS/imágenes normales
app.use(express.static(path.join(__dirname)));

app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('==========================================');
  console.log(' Base de Datos Flotilla · LOCAL DEV');
  console.log(` http://localhost:${PORT}`);
  console.log(` Backend: ${TEST_MODE ? 'Apps Script de prueba' : 'Apps Script de producción'}`);
  console.log(' Netlify y Central: deshabilitados');
  console.log('==========================================');
  console.log('');
});
